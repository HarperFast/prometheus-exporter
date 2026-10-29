// Exactly-once rests on raw report ids committing in id order: Harper's main thread assigns each
// id (getNextMonotonicTime, which continues from the wall clock across restarts) and puts its report
// in one synchronous step.

const RAW_RETENTION_MS = 3600000; // Harper's default analytics.rawRetentionMs
// recordAnalytics doesn't await its put; reading only up to now - SETTLE_MS keeps the high-water
// mark behind any report still being written
export const SETTLE_MS = 5000;
export const MAX_REPORTS_PER_INGEST = 2000;
const ENTRIES_PER_YIELD = 2000;
// Busy threads report about every second, so a report this close to the mark means nothing between
// them was deleted, even when both are older than the retention cutoff
const CONTIGUOUS_MS = 15000;

export const COUNTER_NAMES = [
  "harper_mqtt_connects_total",
  "harper_mqtt_connects_succeeded_total",
  "harper_mqtt_disconnects_total",
  "harper_mqtt_disconnects_clean_total",
  "harper_mqtt_subscribes_total",
  "harper_mqtt_bytes_sent_total",
  "harper_mqtt_bytes_received_total",
];

// Harper keeps raw reports for analytics.rawRetentionMs, but never less than one aggregatePeriod
export function rawRetentionMs(analytics) {
  const aggregatePeriodMs = (analytics?.aggregatePeriod ?? 0) * 1000;
  return Math.max(
    analytics?.rawRetentionMs ?? RAW_RETENTION_MS,
    aggregatePeriodMs,
  );
}

function addEntry(counters, entry) {
  const { metric, path, method, type, count = 0, total = 0, mean = 0 } = entry;
  const add = (name, value) => {
    if (value > 0) counters[name] += value;
  };
  if (metric === "connection" && path === "mqtt") {
    if (method === "connect") {
      add("harper_mqtt_connects_total", count);
      add("harper_mqtt_connects_succeeded_total", total);
    } else if (method === "disconnect") {
      add("harper_mqtt_disconnects_total", count);
      add("harper_mqtt_disconnects_clean_total", total);
    }
  } else if (type === "mqtt") {
    if (metric === "bytes-sent")
      add("harper_mqtt_bytes_sent_total", Math.round(count * mean));
    else if (metric === "bytes-received") {
      add("harper_mqtt_bytes_received_total", Math.round(count * mean));
      if (method?.startsWith("subscribe"))
        add("harper_mqtt_subscribes_total", count);
    }
  }
}

export function emptyState() {
  return {
    highWaterMark: undefined,
    counters: Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])),
    gapSeconds: 0,
  };
}

function startFold(state) {
  return {
    ...state,
    counters: { ...state.counters },
    gapChecked: state.highWaterMark === undefined,
    entriesSinceYield: 0,
    reportsFolded: 0,
  };
}

// The mark moves only once the whole report is folded, so yielding mid-report is safe
function* foldReport(next, report, { now, retentionMs }) {
  if (!report || report.id <= next.highWaterMark) return;
  if (!next.gapChecked) {
    const lostUntil = Math.min(now - retentionMs, report.id);
    if (
      lostUntil > next.highWaterMark &&
      report.id - next.highWaterMark > CONTIGUOUS_MS
    )
      next.gapSeconds += (lostUntil - next.highWaterMark) / 1000;
    next.gapChecked = true;
  }
  for (const entry of report.metrics ?? []) {
    addEntry(next.counters, entry);
    if (++next.entriesSinceYield >= ENTRIES_PER_YIELD) {
      next.entriesSinceYield = 0;
      yield;
    }
  }
  next.highWaterMark = report.id;
  next.reportsFolded++;
}

function finishFold({
  gapChecked,
  entriesSinceYield,
  reportsFolded,
  ...state
}) {
  return state;
}

export function foldReports(state, reports, options) {
  const next = startFold(state);
  const ordered = [...reports].sort((left, right) => left?.id - right?.id);
  for (const report of ordered)
    for (const _ of foldReport(next, report, options));
  return finishFold(next);
}

// Synchronous, so scrapes sharing these collectors can't both add the totals between a reset and an
// inc; never publishes over a newer snapshot, which Prometheus would read as a counter reset
export function rawCounterPublisher({ counters, gap, lag }) {
  let publishedMark;
  return function publish(state, node, now) {
    if (state !== undefined && state.highWaterMark < publishedMark) return;
    for (const counter of Object.values(counters)) counter.reset();
    gap.reset();
    lag.reset();
    if (state === undefined) return;
    publishedMark = state.highWaterMark;
    for (const name of COUNTER_NAMES)
      counters[name].inc({ node }, state.counters[name]);
    gap.inc({ node }, state.gapSeconds);
    lag.set({ node }, (now - state.highWaterMark) / 1000);
  };
}

// JSON text, because Harper 4 decodes nested record objects as tracked objects whose fields
// spreading would drop
export async function readState(stateTable, node) {
  const json = (await stateTable.get(node))?.state;
  if (typeof json !== "string") return undefined;
  let state;
  try {
    state = JSON.parse(json);
  } catch {
    return undefined;
  }
  const valid =
    Number.isFinite(state?.highWaterMark) &&
    state.gapSeconds >= 0 &&
    COUNTER_NAMES.every((name) => state.counters?.[name] >= 0);
  return valid ? state : undefined;
}

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

// The first pass only records where to start: increase() takes a counter's first sample as its
// baseline, so a backlog read then would be wasted
export async function ingest({ rawTable, stateTable, node, now, retentionMs }) {
  const state = await readState(stateTable, node);
  const end = now - SETTLE_MS;
  if (state === undefined) {
    const started = { ...emptyState(), highWaterMark: end };
    await stateTable.put({ node, state: JSON.stringify(started) });
    return started;
  }
  const results = await rawTable.search({
    conditions: [
      {
        attribute: "id",
        comparator: "greater_than",
        value: state.highWaterMark,
      },
      { attribute: "id", comparator: "less_than_equal", value: end },
    ],
    sort: { attribute: "id" },
    limit: MAX_REPORTS_PER_INGEST,
    snapshot: false,
  });
  const next = startFold(state);
  for await (const report of results)
    for (const _ of foldReport(next, report, { now, retentionMs }))
      await yieldToEventLoop();
  const folded = next.reportsFolded > 0;
  const saved = finishFold(next);
  if (!folded) return saved;
  // A retiring worker 0 can still be mid-pass while its replacement saves a newer one
  const latest = await readState(stateTable, node);
  if (latest !== undefined && latest.highWaterMark >= saved.highWaterMark)
    return latest;
  await stateTable.put({ node, state: JSON.stringify(saved) });
  return saved;
}
