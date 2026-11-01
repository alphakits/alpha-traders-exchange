import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { formatPostgresPerformanceDiagnostics, MAX_DIAGNOSTIC_BYTES } from "./integration/postgres-performance-diagnostics.mjs";

const gateScript = fileURLToPath(new URL("./check-postgres-performance.mjs", import.meta.url));
const prefix = "POSTGRES_PERFORMANCE_DIAGNOSTICS ";
const fixture = () => ({ commit: "synthetic-test", timings: [
  ...Array.from({ length: 240 }, () => ({ ok: true, operation: "status", nextStatus: "accepted", worker: 0,
    actionElapsedMs: 10, elapsedMs: 15, backgroundElapsedMs: 5, startedAt: 1000, finishedAt: 1015, metrics: { readDbMs: 7, writeDbMs: 2 } })),
  ...Array.from({ length: 30 }, () => ({ ok: true, operation: "evidence", worker: 1, elapsedMs: 20, startedAt: 1000, finishedAt: 1020 })),
] });
async function runGate(results, diagnostics) {
  const directory = await mkdtemp(path.join(tmpdir(), "postgres-performance-diagnostics-"));
  try {
    const resultPath = path.join(directory, "results.json");
    await writeFile(resultPath, JSON.stringify(results));
    if (diagnostics) await writeFile(path.join(directory, "wait-diagnostics.json"), diagnostics);
    const processResult = spawnSync(process.execPath, [gateScript, resultPath], { encoding: "utf8", timeout: 20_000 });
    assert.ifError(processResult.error);
    const line = processResult.stdout.split(/\r?\n/).find(value => value.startsWith(prefix));
    return { exit: processResult.status, stdout: processResult.stdout, summary: line && JSON.parse(line.slice(prefix.length)),
      evidence: JSON.parse(await readFile(path.join(directory, "performance-gate.json"), "utf8")) };
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
}

test("a slow receipt prints actionable diagnostics before the unchanged strict gate fails", async () => {
  const results = fixture();
  results.timings[240].elapsedMs = 1408;
  const result = await runGate(results);
  assert.equal(result.exit, 1);
  assert.equal(result.evidence.status, "FAIL");
  assert.equal(result.evidence.measured.count, 270);
  assert.equal(result.evidence.measured.maxMs, 1408);
  assert.equal(result.summary.counts.status.count, 240);
  assert.equal(result.summary.counts.evidence.count, 30);
  assert.equal(result.summary.slowest.evidence[0].durationMs, 1408);
  assert.equal(result.summary.slowest.status[0].metrics.readDbMs, 7);
});

test("missing or malformed optional evidence does not change pass/fail or expose error text", async () => {
  for (const diagnostics of [undefined, "private-secret-not-valid-json"]) {
    const result = await runGate(fixture(), diagnostics);
    assert.equal(result.exit, 0);
    assert.equal(result.evidence.status, "PASS");
    assert.deepEqual(result.summary.available, { waitDiagnostics: false, queryTimings: false });
    assert(!result.stdout.includes("private-secret"));
  }
  const empty = JSON.parse(formatPostgresPerformanceDiagnostics(null, null, null));
  assert.equal(empty.counts.status.count, 0);
  assert.equal(empty.counts.evidence.maxMs, null);
});

test("the 1000 ms boundary, missing actions, and invalid timings still fail closed", async () => {
  const threshold = fixture(); threshold.timings[0].actionElapsedMs = 1000;
  const missing = fixture(); missing.timings.pop();
  const invalid = fixture(); invalid.timings[0].actionElapsedMs = "not-a-duration";
  for (const results of [threshold, missing, invalid]) {
    const result = await runGate(results);
    assert.equal(result.exit, 1);
    assert.equal(result.evidence.status, "FAIL");
    assert.equal(result.evidence.thresholdMs, 1000);
  }
  assert.equal((await runGate(missing)).summary.counts.evidence.count, 29);
});

test("wait observations overlap slow status and receipt call windows without claiming exact wait duration", () => {
  const results = fixture();
  Object.assign(results.timings[0], { actionElapsedMs: 1200, startedAt: 1000, finishedAt: 2300 });
  Object.assign(results.timings[240], { elapsedMs: 1408, startedAt: 5000, finishedAt: 6408 });
  const backend = { wait_event_type: "Lock", wait_event: "advisory", transaction_age_ms: "120.125" };
  const diagnostics = { enabled: true, databaseSamples: [
    { startedAt: 100, finishedAt: 101, backends: [backend] },
    { startedAt: 1200, finishedAt: 1201, backends: [backend] },
    { startedAt: 5500, finishedAt: 5501, backends: [backend] },
  ] };
  const report = JSON.parse(formatPostgresPerformanceDiagnostics(results, diagnostics));
  assert.equal(report.overlappingSlowCallWaits.slowCallWindows, 2);
  assert.equal(report.overlappingSlowCallWaits.overlappingSamples, 2);
  assert.deepEqual(report.overlappingSlowCallWaits.waits, [{ type: "Lock", event: "advisory", observations: 2, maxTransactionAgeMs: 120.125 }]);
});

test("phase diagnostics preserve CPU, event loop, query bottlenecks and WAL counter deltas", () => {
  const initial = { phase: "initial-before-fixtures", capturedAt: 1000, wal: { stats_reset: "same", wal_sync: "4", wal_sync_time: 2.5 } };
  const worker = { workerId: "4", cpuMs: { user: 210, system: 20 }, eventLoopDelayMs: { max: 82, p99: 42, mean: 10 },
    slowQueries: [{ operation: "advisory_lock", elapsedMs: 810 }], omittedSlowQueries: 7 };
  const final = { phase: "final", capturedAt: 1500, workers: [worker], wal: { stats_reset: "same", wal_sync: "14", wal_sync_time: 9.5 } };
  const queryPhases = [{ phase: "final", workers: [[{ operation: "commit", count: 4, totalMs: 12, maximumMs: 7 }],
    [{ operation: "commit", count: 3, totalMs: 15, maximumMs: 8 }]] }];
  const wait = { enabled: true, runtimeDiagnostics: [initial, final] };
  for (const queries of [queryPhases, { phases: queryPhases }]) {
    const phase = JSON.parse(formatPostgresPerformanceDiagnostics(fixture(), wait, queries)).phases[1];
    assert.equal(phase.intervalMs, 500);
    assert.equal(phase.workers[0].cpuMs.user, 210);
    assert.equal(phase.workers[0].eventLoopDelayMs.max, 82);
    assert.equal(phase.workers[0].omittedSlowQueries, 7);
    assert.equal(phase.slowQueries[0].elapsedMs, 810);
    assert.deepEqual(phase.queries[0], { operation: "commit", count: 7, totalMs: 27, maximumMs: 8 });
    assert.equal(phase.walDelta.wal_sync, 10);
    assert.equal(phase.walDelta.wal_sync_time, 7);
  }
  final.wal.stats_reset = "different";
  assert.equal(JSON.parse(formatPostgresPerformanceDiagnostics(fixture(), wait, queryPhases)).phases[1].walDelta, null);
});

test("only allowlisted fields and category values reach logs, even from corrupted diagnostic inputs", () => {
  const secret = "synthetic-sensitive-password";
  const results = fixture();
  Object.assign(results.timings[0], { actionElapsedMs: 1400, finishedAt: 2400, requestId: secret, nextStatus: secret, worker: secret,
    metrics: { readDbMs: secret, sql: secret, values: [secret] }, details: secret });
  const queries = [{ phase: secret, workers: [[{ operation: secret, sql: secret, params: [secret], count: 1, maximumMs: 99 }]] }];
  const diagnostics = { enabled: true, samplingErrors: [secret], runtimeDiagnostics: [{ phase: secret,
    workers: [{ workerId: secret, cpuMs: { user: secret }, slowQueries: [{ operation: secret, elapsedMs: 80, sql: secret }], password: secret }] }],
    databaseSamples: [{ startedAt: 1100, finishedAt: 1101, backends: [{ wait_event_type: secret, wait_event: secret, application_name: secret, query: secret }] }] };
  const serialized = formatPostgresPerformanceDiagnostics(results, diagnostics, queries);
  assert(!serialized.includes(secret));
  assert(!serialized.includes('"sql"'));
  assert(!serialized.includes('"params"'));
  assert(!serialized.includes('"requestId"'));
  assert.equal(JSON.parse(serialized).samplingErrorCount, 1);
});

test("large diagnostic inputs stay below the log budget while retaining both worst operations", () => {
  const results = fixture();
  for (const [index, row] of results.timings.entries()) Object.assign(row, { actionElapsedMs: 8_000_000_000_000 + index,
    elapsedMs: 8_000_000_000_000 + index, backgroundElapsedMs: 7_000_000_000_000,
    metrics: Object.fromEntries(["totalMs", "readDbMs", "timelineMs", "chatMs", "notificationMs", "writeDbMs", "sseMs", "trustMs"].map(key => [key, 7_000_000_000_000])) });
  const phases = ["initial-before-fixtures", "acceptance-before-process-restart", "all-payment-methods-and-before-lost-follow-up-restart", "trust-recovery-before-transaction-kill", "final", "unknown"];
  const workers = Array.from({ length: 50 }, (_, workerId) => ({ workerId: String(workerId),
    cpuMs: { user: 7_000_000_000_000, system: 7_000_000_000_000 }, eventLoopDelayMs: { mean: 7_000_000_000_000, max: 7_000_000_000_000, p99: 7_000_000_000_000 },
    omittedSlowQueries: 7_000_000_000_000, slowQueries: Array.from({ length: 100 }, () => ({ operation: "advisory_lock", elapsedMs: 7_000_000_000_000 })) }));
  const diagnostics = { runtimeDiagnostics: phases.map(phase => ({ phase, workers })) };
  const queries = phases.map(phase => ({ phase, workers: [["advisory_lock", "snapshot_aggregate", "runtime_version", "commit"].map(operation => ({ operation, count: 7_000_000_000_000, totalMs: 7_000_000_000_000, maximumMs: 7_000_000_000_000 }))] }));
  const serialized = formatPostgresPerformanceDiagnostics(results, diagnostics, queries);
  assert(Buffer.byteLength(serialized) <= MAX_DIAGNOSTIC_BYTES);
  assert(Buffer.byteLength(prefix + serialized) < 12_000);
  const report = JSON.parse(serialized);
  assert(report.slowest.status.length >= 1);
  assert(report.slowest.evidence.length >= 1);
  assert.equal(report.slowest.status[0].durationMs, 8_000_000_000_239);
  assert.equal(report.slowest.evidence[0].durationMs, 8_000_000_000_269);
  assert.equal(report.phases.length, 6);
  assert.equal(report.counts.status.count, 240);
  assert.equal(report.counts.evidence.count, 30);
});
