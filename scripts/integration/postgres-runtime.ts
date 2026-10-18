import { Pool } from "pg";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { requireAuditDatabaseUrl } from "./audit-database-url.mjs";

// This adapter is bundled ONLY into the isolated CI harness. Never import it
// from application code. It cannot connect to a customer or hosted database.
const connectionString = requireAuditDatabaseUrl(process.env.ALPHA_AUDIT_DATABASE_URL ?? "").toString();
const pool = new Pool({ connectionString, max: 5, application_name: `alpha-audit-worker-${process.env.ALPHA_AUDIT_WORKER_ID}`,
  connectionTimeoutMillis: 5_000, statement_timeout: 15_000, query_timeout: 20_000 });

// No SQL text or bound values leave this controlled harness. Aggregate timings
// identify database waiting versus snapshot work without relaxing production
// diagnostics or security settings.
const queryTimings = new Map<string, { count: number; totalMs: number; maximumMs: number }>();
const eventLoop = monitorEventLoopDelay({ resolution: 10 });
const diagnosticsEnabled = process.env.ALPHA_AUDIT_WAIT_DIAGNOSTICS === "1";
if (diagnosticsEnabled) eventLoop.enable();
let cpuBaseline = process.cpuUsage();
const slowQueries: { operation: string; startedAt: number; elapsedMs: number; backendPid: number | null }[] = [];
let omittedSlowQueries = 0;
pool.on("connect", client => {
  const backendPid = (client as typeof client & { processID?: number }).processID ?? null;
  const original = client.query.bind(client);
  client.query = ((...args: unknown[]) => {
    const query = args[0];
    const sql = typeof query === "string" ? query : String((query as { text?: unknown })?.text ?? "");
    const operation = /pg_advisory_xact_lock/.test(sql) ? "advisory_lock"
      : /jsonb?_agg/.test(sql) ? "snapshot_aggregate"
      : /runtime_meta/.test(sql) ? "runtime_version"
      : /^(begin|commit|rollback)$/i.test(sql.trim()) ? sql.trim().toLowerCase()
      : `${sql.trim().split(/\s+/)[0]?.toLowerCase() ?? "other"}:${sql.match(/alpha_exchange\.([a-z_]+)/)?.[1] ?? "schema"}`;
    const started = performance.now();
    const startedAt = Date.now();
    let finished = false;
    const record = () => {
      if (finished) return;
      finished = true;
      const elapsed = performance.now() - started;
      const previous = queryTimings.get(operation) ?? { count: 0, totalMs: 0, maximumMs: 0 };
      previous.count++; previous.totalMs += elapsed; previous.maximumMs = Math.max(previous.maximumMs, elapsed);
      queryTimings.set(operation, previous);
      if (diagnosticsEnabled && elapsed >= 40) {
        if (slowQueries.length < 512) slowQueries.push({ operation, startedAt, elapsedMs: elapsed, backendPid });
        else omittedSlowQueries++;
      }
    };
    const last = args[args.length - 1];
    if (typeof last === "function") args[args.length - 1] = (...values: unknown[]) => { record(); return last(...values); };
    try {
      const result = (original as (...values: unknown[]) => unknown)(...args);
      if (result && typeof (result as Promise<unknown>).then === "function") return (result as Promise<unknown>).then(value => { record(); return value; }, error => { record(); throw error; });
      return result;
    } catch (error) { record(); throw error; }
  }) as typeof client.query;
});
export function getAuditQueryTimings() {
  const result = [...queryTimings].map(([operation, metrics]) => ({ operation, ...metrics }));
  queryTimings.clear();
  return result;
}
export function getAuditRuntimeDiagnostics() {
  const cpu = process.cpuUsage(cpuBaseline);
  cpuBaseline = process.cpuUsage();
  const ms = (ns: number) => Number.isFinite(ns) ? ns / 1_000_000 : null;
  const result = { pid: process.pid, workerId: process.env.ALPHA_AUDIT_WORKER_ID,
    capturedAt: Date.now(), cpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 },
    eventLoopDelayMs: { mean: ms(eventLoop.mean), max: ms(eventLoop.max), p99: ms(eventLoop.percentile(99)) },
    slowQueries: slowQueries.splice(0), omittedSlowQueries };
  eventLoop.reset(); omittedSlowQueries = 0;
  return result;
}
export function getRuntimePostgresPool() { return pool; }
export function getRuntimePostgresConnectionString() { return connectionString; }
