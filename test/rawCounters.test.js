import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Prometheus from "prom-client";
import {
  COUNTER_NAMES,
  MAX_REPORTS_PER_INGEST,
  SETTLE_MS,
  emptyState,
  foldReports,
  ingest,
  rawCounterPublisher,
  rawRetentionMs,
  readState,
} from "../rawCounters.js";

const T0 = 1761700000000;
const HOUR = 3600000;

function report(id, threadId, { connects = 10, accepted = 9 } = {}) {
  return {
    id,
    time: Math.floor(id),
    period: 1000,
    threadId,
    metrics: [
      {
        metric: "connection",
        path: "mqtt",
        method: "connect",
        total: accepted,
        count: connects,
      },
      {
        metric: "connection",
        path: "mqtt",
        method: "disconnect",
        total: 2,
        count: 3,
      },
      {
        metric: "bytes-sent",
        path: "sV3",
        method: "publish",
        type: "mqtt",
        mean: 2700.5,
        count: 100,
        distribution: [2600, 2800],
      },
      {
        metric: "bytes-sent",
        path: "sV3/match/42",
        method: "puback",
        type: "mqtt",
        mean: 4,
        count: 5,
      },
      {
        metric: "bytes-received",
        method: "connect",
        type: "mqtt",
        mean: 59,
        count: connects,
      },
      {
        metric: "bytes-received",
        path: "sV3",
        method: "subscribe,qos=1",
        type: "mqtt",
        mean: 20,
        count: 4,
      },
      {
        metric: "bytes-sent",
        path: "/status",
        method: "GET",
        mean: 15,
        count: 1,
      },
      { metric: "db-read", path: "Score", mean: 300, count: 7 },
      { metric: "mqtt-connections", connections: 500, byThread: true },
    ],
  };
}

function stream(from, seconds, options) {
  const reports = [];
  for (let second = 0; second < seconds; second++) {
    reports.push(report(from + second * 1000 + 0.25, 1, options));
    reports.push(report(from + second * 1000 + 0.5, 2, options));
  }
  return reports;
}

function rawTable(rows) {
  return {
    rows,
    async search({ conditions: [{ value: low }, { value: high }], limit }) {
      return rows
        .filter((row) => row.id > low && row.id <= high)
        .sort((left, right) => left.id - right.id)
        .slice(0, limit);
    },
  };
}

function stateTable(startAt) {
  const records = new Map();
  const table = {
    puts: 0,
    records,
    async search({ conditions: [{ value: prefix }] }) {
      return [...records.values()]
        .filter((record) => record.id.startsWith(prefix))
        .map((record) => structuredClone(record));
    },
    async put(record) {
      table.puts++;
      records.set(record.id, structuredClone(record));
    },
    async delete(id) {
      records.delete(id);
    },
  };
  if (startAt !== undefined)
    records.set("node-a/seed", {
      id: "node-a/seed",
      state: JSON.stringify({ ...emptyState(), highWaterMark: startAt }),
    });
  return table;
}

const foldOptions = { now: T0 + HOUR, retentionMs: HOUR };
const ingestArgs = (rows, states, now) => ({
  rawTable: rawTable(rows),
  stateTable: states,
  node: "node-a",
  writer: "w1",
  now,
  retentionMs: HOUR,
});

describe("foldReports", () => {
  it("sums each family from the raw entries' exact counts", () => {
    const { counters, highWaterMark, gapSeconds } = foldReports(
      emptyState(),
      stream(T0, 60),
      foldOptions,
    );
    assert.deepEqual(counters, {
      harper_mqtt_connects_total: 1200,
      harper_mqtt_connects_succeeded_total: 1080,
      harper_mqtt_disconnects_total: 360,
      harper_mqtt_disconnects_clean_total: 240,
      harper_mqtt_subscribes_total: 480,
      harper_mqtt_bytes_sent_total: 120 * (270050 + 20),
      harper_mqtt_bytes_received_total: 120 * (10 * 59 + 4 * 20),
    });
    assert.equal(highWaterMark, T0 + 59000.5);
    assert.equal(gapSeconds, 0);
  });

  it("starts every family at zero", () => {
    const { counters } = emptyState();
    assert.deepEqual(Object.keys(counters), COUNTER_NAMES);
    assert.ok(COUNTER_NAMES.every((name) => counters[name] === 0));
  });

  it("skips reports without a numeric id", () => {
    const reports = stream(T0, 2);
    const state = foldReports(
      emptyState(),
      [null, { metrics: reports[0].metrics }, ...reports],
      foldOptions,
    );
    assert.deepEqual(state, foldReports(emptyState(), reports, foldOptions));
  });

  it("counts every report once however the reads are split or overlap", () => {
    const reports = stream(T0, 120);
    const once = foldReports(emptyState(), reports, foldOptions);
    for (const step of [30, 120, 180]) {
      let state = emptyState();
      for (let index = 0; index < reports.length; index += step)
        state = foldReports(
          state,
          reports.slice(Math.max(0, index - 1), index + step),
          foldOptions,
        );
      assert.deepEqual(state.counters, once.counters);
    }
    assert.deepEqual(
      foldReports(once, reports, foldOptions).counters,
      once.counters,
    );
  });
});

describe("gap accounting", () => {
  it("loses nothing when the gap is shorter than raw retention", () => {
    const first = foldReports(emptyState(), stream(T0, 60), foldOptions);
    const state = foldReports(first, stream(T0 + 60000, 40 * 60), {
      now: T0 + 41 * 60000,
      retentionMs: HOUR,
    });
    assert.equal(state.counters.harper_mqtt_connects_total, (60 + 2400) * 20);
    assert.equal(state.gapSeconds, 0);
  });

  it("reports the span that may have expired when the gap exceeds raw retention", () => {
    const state = foldReports(emptyState(), stream(T0, 60), foldOptions);
    const now = T0 + 3 * HOUR;
    const next = foldReports(state, stream(now - HOUR, 60), {
      now,
      retentionMs: HOUR,
    });
    assert.equal(next.gapSeconds, (now - HOUR - state.highWaterMark) / 1000);
  });

  it("charges a gap once, not again on every empty pass", async () => {
    const states = stateTable(T0);
    const rows = [];
    for (let pass = 0; pass < 4; pass++)
      await ingest(ingestArgs(rows, states, T0 + 3 * HOUR + pass * 15000));
    assert.equal(states.puts, 0);
    rows.push(...stream(T0 + 2.5 * HOUR, 60));
    const state = await ingest(ingestArgs(rows, states, T0 + 3 * HOUR + 60000));
    assert.equal(state.gapSeconds, (2 * HOUR + 60000) / 1000);
    const again = await ingest(ingestArgs(rows, states, T0 + 3 * HOUR + 75000));
    assert.equal(again.gapSeconds, state.gapSeconds);
  });

  it("charges no gap for contiguous reports older than the cutoff but not yet purged", () => {
    const reports = stream(T0, 120);
    const late = { now: T0 + 3 * HOUR, retentionMs: HOUR };
    const first = foldReports(emptyState(), reports.slice(0, 100), late);
    assert.equal(foldReports(first, reports.slice(100), late).gapSeconds, 0);
  });
});

describe("restarts", () => {
  it("continues from the persisted high-water mark after an exporter restart", async () => {
    const rows = stream(T0, 600);
    const states = stateTable(T0 - 1);
    await ingest(ingestArgs(rows, states, T0 + 200000));
    const restarted = await ingest(ingestArgs(rows, states, T0 + 700000));
    assert.deepEqual(
      restarted.counters,
      foldReports(emptyState(), rows, foldOptions).counters,
    );
  });

  it("keeps counting after a Harper restart, whose report ids continue from the wall clock", () => {
    const before = foldReports(emptyState(), stream(T0, 60), foldOptions);
    const state = foldReports(before, stream(T0 + 360000, 60), {
      now: T0 + 420000 + SETTLE_MS,
      retentionMs: HOUR,
    });
    assert.equal(state.counters.harper_mqtt_connects_total, 2400);
    assert.equal(state.gapSeconds, 0);
  });

  it("never double counts or goes backwards when ids restart below the mark", () => {
    const before = foldReports(emptyState(), stream(T0, 60), foldOptions);
    const stepped = foldReports(before, stream(T0 - 600000, 60), foldOptions);
    assert.deepEqual(stepped.counters, before.counters);
    const resumed = foldReports(stepped, stream(T0 + 61000, 1), foldOptions);
    assert.equal(resumed.counters.harper_mqtt_connects_total, 1220);
  });
});

describe("ingest", () => {
  it("records where to start on the first pass without reading retained reports", async () => {
    const rows = stream(T0, 600);
    const args = ingestArgs(rows, stateTable(), T0 + 700000);
    let searches = 0;
    const search = args.rawTable.search;
    args.rawTable.search = (query) => (searches++, search(query));
    const first = await ingest(args);
    assert.equal(searches, 0);
    assert.equal(first.highWaterMark, T0 + 700000 - SETTLE_MS);
    rows.push(...stream(T0 + 700000, 10));
    const second = await ingest({ ...args, now: T0 + 720000 });
    assert.equal(second.counters.harper_mqtt_connects_total, 200);
  });

  it("reads at most one bounded id range per pass and drains a backlog over passes", async () => {
    const rows = stream(T0, MAX_REPORTS_PER_INGEST);
    const now = T0 + MAX_REPORTS_PER_INGEST * 1000 + SETTLE_MS;
    const args = {
      ...ingestArgs(rows, stateTable(T0 - 1), now),
      retentionMs: 10 * HOUR,
    };
    const first = await ingest(args);
    assert.equal(first.highWaterMark, rows[MAX_REPORTS_PER_INGEST - 1].id);
    const second = await ingest(args);
    assert.deepEqual(
      second.counters,
      foldReports(emptyState(), rows, foldOptions).counters,
    );
  });

  it("leaves reports newer than the settle window for the next pass", async () => {
    const state = await ingest(
      ingestArgs(stream(T0, 10), stateTable(T0 - 1), T0 + 7000),
    );
    assert.equal(state.highWaterMark, T0 + 1000.5);
  });

  it("never lets a retiring worker 0 roll back a newer pass during a rolling restart", async () => {
    const rows = stream(T0, 30);
    const states = stateTable(T0 - 1);
    const seed = await states.search({ conditions: [{ value: "node-a/" }] });
    const newer = await ingest(ingestArgs(rows, states, T0 + 40000));
    const search = states.search;
    let reads = 0;
    states.search = async (query) => (reads++ === 0 ? seed : search(query));
    await ingest({
      ...ingestArgs(rows.slice(0, 20), states, T0 + 20000),
      writer: "w0",
    });
    states.search = search;
    assert.deepEqual(await readState(states, "node-a"), newer);
    await ingest(ingestArgs(stream(T0 + 30000, 5), states, T0 + 45000));
    assert.deepEqual([...states.records.keys()].sort(), [
      "node-a/w0",
      "node-a/w1",
    ]);
    await ingest(ingestArgs(stream(T0 + HOUR, 5), states, T0 + HOUR + 50000));
    assert.deepEqual([...states.records.keys()], ["node-a/w1"]);
  });

  it("never deletes a row another worker 0 may still be advancing", async () => {
    const rows = stream(T0, 30);
    const states = stateTable(T0 - 1);
    await ingest(ingestArgs(rows.slice(0, 10), states, T0 + 10000));
    const before = await states.search({ conditions: [{ value: "node-a/" }] });
    const newer = await ingest(ingestArgs(rows, states, T0 + 40000));
    const search = states.search;
    let reads = 0;
    states.search = async (query) => (reads++ === 0 ? before : search(query));
    await ingest({
      ...ingestArgs(rows.slice(0, 30), states, T0 + 20000),
      writer: "w0",
    });
    states.search = search;
    assert.deepEqual(await readState(states, "node-a"), newer);
  });

  it("yields to the event loop inside one wide report", async () => {
    const entries = Array.from({ length: 10000 }, () => ({
      metric: "bytes-sent",
      type: "mqtt",
      mean: 1,
      count: 1,
    }));
    const realSetImmediate = globalThis.setImmediate;
    let yields = 0;
    globalThis.setImmediate = (callback) => (
      yields++, realSetImmediate(callback)
    );
    try {
      await ingest(
        ingestArgs(
          [{ id: T0, threadId: 1, metrics: entries }],
          stateTable(T0 - 1),
          T0 + 20000,
        ),
      );
    } finally {
      globalThis.setImmediate = realSetImmediate;
    }
    assert.equal(yields, 5);
  });
});

describe("persisted state", () => {
  it("keeps the larger gap when two writers saved the same mark", async () => {
    const saved = (gapSeconds) =>
      JSON.stringify({ ...emptyState(), highWaterMark: T0, gapSeconds });
    for (const gaps of [
      [5, 9],
      [9, 5],
    ]) {
      const states = stateTable();
      await states.put({ id: "node-a/w0", state: saved(gaps[0]) });
      await states.put({ id: "node-a/w1", state: saved(gaps[1]) });
      assert.equal((await readState(states, "node-a")).gapSeconds, 9);
    }
  });

  it("is stored as JSON text, so Harper 4's tracked records can't hide its fields", async () => {
    const states = stateTable(T0 - 1);
    await ingest(ingestArgs(stream(T0, 5), states, T0 + 20000));
    assert.equal(typeof states.records.get("node-a/w1").state, "string");
    const restored = await readState(states, "node-a");
    assert.equal(restored.counters.harper_mqtt_connects_total, 100);
  });

  for (const [label, json] of [
    ["unparseable", "{not json"],
    [
      "negative",
      JSON.stringify({
        ...emptyState(),
        highWaterMark: T0,
        counters: { ...emptyState().counters, harper_mqtt_connects_total: -1 },
      }),
    ],
    [
      "not numeric",
      JSON.stringify({
        ...emptyState(),
        highWaterMark: T0,
        counters: { ...emptyState().counters, harper_mqtt_connects_total: "7" },
      }),
    ],
    [
      "missing a family",
      JSON.stringify({ highWaterMark: T0, gapSeconds: 0, counters: {} }),
    ],
  ]) {
    it(`starts over when the saved row is ${label}`, async () => {
      const states = stateTable();
      await states.put({ id: "node-a/w0", state: json });
      assert.equal(await readState(states, "node-a"), undefined);
      const state = await ingest(ingestArgs(stream(T0, 5), states, T0 + 20000));
      assert.equal(state.highWaterMark, T0 + 20000 - SETTLE_MS);
      assert.deepEqual([...states.records.keys()], ["node-a/w1"]);
    });
  }
});

describe("rawCounterPublisher", () => {
  function collectors() {
    const registers = [new Prometheus.Registry()];
    const labelNames = ["node"];
    return {
      counters: Object.fromEntries(
        COUNTER_NAMES.map((name) => [
          name,
          new Prometheus.Counter({ name, help: name, labelNames, registers }),
        ]),
      ),
      gap: new Prometheus.Counter({
        name: "gap",
        help: "gap",
        labelNames,
        registers,
      }),
      lag: new Prometheus.Gauge({
        name: "lag",
        help: "lag",
        labelNames,
        registers,
      }),
    };
  }
  const valueOf = async (metric) =>
    (await metric.get()).values.reduce((sum, { value }) => sum + value, 0);
  const savedState = (connects, highWaterMark) => ({
    ...emptyState(),
    highWaterMark,
    counters: {
      ...emptyState().counters,
      harper_mqtt_connects_total: connects,
    },
  });

  it("publishes the saved totals however many scrapes run, never their sum", async () => {
    const metrics = collectors();
    const publish = rawCounterPublisher(metrics);
    for (let scrape = 0; scrape < 3; scrape++)
      publish(savedState(200, T0), "node-a", T0 + 20000);
    assert.equal(
      await valueOf(metrics.counters.harper_mqtt_connects_total),
      200,
    );
    assert.equal(await valueOf(metrics.lag), 20);
  });

  it("publishes every family from zero, before any traffic", async () => {
    const metrics = collectors();
    rawCounterPublisher(metrics)(savedState(0, T0), "node-a", T0);
    for (const name of COUNTER_NAMES)
      assert.deepEqual(
        (await metrics.counters[name].get()).values.map(({ value }) => value),
        [0],
      );
  });

  it("never replaces a newer snapshot with an older one read by a slower scrape", async () => {
    const metrics = collectors();
    const publish = rawCounterPublisher(metrics);
    publish(savedState(20, T0 + 1000), "node-a", T0 + 2000);
    publish(savedState(10, T0), "node-a", T0 + 2000);
    assert.equal(
      await valueOf(metrics.counters.harper_mqtt_connects_total),
      20,
    );
  });

  it("keeps its floor across a cleared publish, so a slow scrape can't go back", async () => {
    const metrics = collectors();
    const publish = rawCounterPublisher(metrics);
    publish(savedState(20, T0 + 1000), "node-a", T0 + 2000);
    publish(undefined, "node-a", T0 + 2000);
    publish(savedState(10, T0), "node-a", T0 + 2000);
    assert.deepEqual(
      (await metrics.counters.harper_mqtt_connects_total.get()).values,
      [],
    );
  });

  it("clears every series when there is no state to publish", async () => {
    const metrics = collectors();
    const publish = rawCounterPublisher(metrics);
    publish(savedState(5, T0), "node-a", T0);
    publish(undefined, "node-a", T0);
    assert.deepEqual(
      (await metrics.counters.harper_mqtt_connects_total.get()).values,
      [],
    );
    assert.deepEqual((await metrics.lag.get()).values, []);
    publish(savedState(1, T0 + 1), "node-a", T0);
    assert.equal(await valueOf(metrics.counters.harper_mqtt_connects_total), 1);
  });
});

describe("rawRetentionMs", () => {
  it("uses Harper's one-hour default with either roll-up period", () => {
    assert.equal(rawRetentionMs({ aggregatePeriod: 60 }), HOUR);
    assert.equal(rawRetentionMs({ aggregatePeriod: 90 }), HOUR);
    assert.equal(rawRetentionMs(undefined), HOUR);
  });

  it("never drops below one roll-up period, as Harper clamps it", () => {
    assert.equal(
      rawRetentionMs({ aggregatePeriod: 60, rawRetentionMs: 30000 }),
      60000,
    );
    assert.equal(
      rawRetentionMs({ aggregatePeriod: 90, rawRetentionMs: 30000 }),
      90000,
    );
  });
});
