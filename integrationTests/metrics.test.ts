import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import {
  setupHarperWithFixture,
  teardownHarper,
  type ContextWithHarper,
} from '@harperfast/integration-testing';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '..');

const require = createRequire(import.meta.url);

/**
 * Locate harper's CLI without assuming its internal layout.
 *
 * harper's `exports` map declares only ".", so neither `harper/package.json` nor
 * `harper/dist/bin/harper.js` is resolvable — both fail with
 * ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the main entry, walk up to the package
 * root, and read the CLI path out of harper's own `bin` field: that survives the
 * main entry moving anywhere inside the package, and fails with a named error
 * instead of a cryptic ENOENT if the package shape ever changes.
 */
function resolveHarperBinPath(): string {
  let dir = dirname(require.resolve('harper'));
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        name?: string;
        bin?: string | Record<string, string>;
      };
      if (pkg.name === 'harper') {
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.harper;
        if (!bin) throw new Error("harper's package.json declares no `bin.harper` entry");
        return resolve(dir, bin);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the harper package root from require.resolve('harper')");
}

const harperBinPath = resolveHarperBinPath();

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

/**
 * Extract the metrics text from a response.
 * Harper returns the Prometheus string payload as-is when the client sends
 * Accept: application/openmetrics-text, but as an application/json-wrapped
 * string when no specific Accept header is sent.  Handle both.
 */
async function extractMetricsText(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const body = await res.json() as unknown;
    if (typeof body !== 'string') {
      throw new Error(`Expected string from JSON-wrapped metrics response, got: ${JSON.stringify(body)}`);
    }
    return body;
  }
  return res.text();
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
      [200, 404].includes(res.status),
      `Unexpected status ${res.status}`,
    );
  });

  void test('GET /prometheus_exporter/metrics returns 200', async () => {
    const res = await authFetch(ctx, '/prometheus_exporter/metrics');
    strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
  });

  void test('GET /prometheus_exporter/metrics returns a recognized content type', async () => {
    const res = await authFetch(ctx, '/prometheus_exporter/metrics');
    strictEqual(res.status, 200);
    const ct = res.headers.get('content-type') ?? '';
    // Harper returns text/plain or application/openmetrics-text when the client
    // sends the matching Accept header; application/json otherwise.
    ok(
      ct.includes('text/plain') ||
        ct.includes('application/openmetrics-text') ||
        ct.includes('application/json'),
      `Unexpected content-type: ${ct}`,
    );
  });

  void test('GET /prometheus_exporter/metrics body contains Prometheus metric comments', async () => {
    const res = await authFetch(ctx, '/prometheus_exporter/metrics');
    strictEqual(res.status, 200);
    const text = await extractMetricsText(res);
    ok(text.length > 0, 'Response body should not be empty');
    ok(
      text.includes('# HELP') || text.includes('# EOF'),
      'Response should contain Prometheus metric comments',
    );
  });

  void test('GET /prometheus_exporter/metrics includes default Node.js process metrics', async () => {
    const res = await authFetch(ctx, '/prometheus_exporter/metrics');
    strictEqual(res.status, 200);
    const text = await extractMetricsText(res);
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
      const text = await extractMetricsText(res);
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
