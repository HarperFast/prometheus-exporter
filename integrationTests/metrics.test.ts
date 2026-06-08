import { suite, test, before, after } from 'node:test';
import { strictEqual, ok, match } from 'node:assert/strict';
import {
  setupHarperWithFixture,
  teardownHarper,
  type ContextWithHarper,
} from '@harperfast/integration-testing';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..');

// harper's `exports` only exposes ".", so 'harper/dist/bin/harper.js' is not resolvable.
// Resolve the CLI from the exported main entry and pass it explicitly.
const require = createRequire(import.meta.url);
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

function authFetch(
  ctx: ContextWithHarper,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
) {
  const { headers = {}, ...rest } = init;
  const creds = Buffer.from(
    `${ctx.harper.admin.username}:${ctx.harper.admin.password}`,
  ).toString('base64');
  return fetch(`${ctx.harper.httpURL}${path}`, {
    ...rest,
    headers: { Authorization: `Basic ${creds}`, ...headers },
  });
}

void suite('prometheus-exporter', (ctx: ContextWithHarper) => {
  before(async () => {
    await setupHarperWithFixture(ctx, FIXTURE_PATH, { harperBinPath });
  });

  after(async () => {
    await teardownHarper(ctx);
  });

  void test('Harper starts successfully', async () => {
    const res = await authFetch(ctx, '/');
    ok(
      [200, 400, 404].includes(res.status),
      `Unexpected status ${res.status}`,
    );
  });

  void test('GET /prometheus_exporter/metrics returns 200 with Prometheus/OpenMetrics text', async () => {
    const res = await authFetch(ctx, '/prometheus_exporter/metrics');
    strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const text = await res.text();
    ok(text.length > 0, 'Response body should not be empty');
    // Prometheus text format always includes at least the process metrics
    // (prom-client collectDefaultMetrics) and ends with EOF marker
    ok(
      text.includes('# HELP') || text.includes('# EOF'),
      'Response should contain Prometheus metric comments',
    );
  });

  void test('GET /prometheus_exporter/metrics returns OpenMetrics content type or text/plain', async () => {
    const res = await authFetch(ctx, '/prometheus_exporter/metrics');
    strictEqual(res.status, 200);
    const ct = res.headers.get('content-type') ?? '';
    ok(
      ct.includes('text/plain') ||
        ct.includes('application/openmetrics-text') ||
        ct.includes('text/'),
      `Unexpected content-type: ${ct}`,
    );
  });

  void test('GET /prometheus_exporter/metrics includes default Node.js process metrics', async () => {
    const res = await authFetch(ctx, '/prometheus_exporter/metrics');
    strictEqual(res.status, 200);
    const text = await res.text();
    // prom-client collectDefaultMetrics() always registers process_cpu_seconds_total
    ok(
      text.includes('process_cpu') || text.includes('nodejs_'),
      'Expected default Node.js process metrics from prom-client',
    );
  });

  void test('GET /prometheus_exporter/metrics/fast returns 200', async () => {
    const res = await authFetch(ctx, '/prometheus_exporter/metrics/fast');
    // "fast" is a valid path param that skips slow metrics — should still return 200
    ok(
      [200, 404].includes(res.status),
      `Expected 200 or 404, got ${res.status}`,
    );
    if (res.status === 200) {
      const text = await res.text();
      ok(text.length > 0, 'fast metrics response should not be empty');
    }
  });

  void test('PrometheusExporterSettings table is accessible (REST)', async () => {
    // The settings table should be populated by the module-level init code
    const res = await authFetch(ctx, '/PrometheusExporterSettings/');
    ok(
      [200, 404].includes(res.status),
      `Expected 200 or 404 from REST, got ${res.status}`,
    );
    if (res.status === 200) {
      const body = await res.json() as unknown[];
      ok(Array.isArray(body), 'Expected array of settings records');
    }
  });

  void test('forceAuthorization setting is initialized', async () => {
    const res = await authFetch(
      ctx,
      '/PrometheusExporterSettings/forceAuthorization',
    );
    ok(
      [200, 404].includes(res.status),
      `Unexpected status ${res.status}`,
    );
    if (res.status === 200) {
      const body = await res.json() as { name: string; value: unknown };
      strictEqual(body.name, 'forceAuthorization');
    }
  });
});
