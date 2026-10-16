import { Pool } from "pg";

// This adapter is bundled ONLY into the isolated CI harness. Never import it
// from application code. It cannot connect to a customer or hosted database.
const connectionString = process.env.ALPHA_AUDIT_DATABASE_URL ?? "";
const target = new URL(connectionString);
if (!new Set(["localhost", "127.0.0.1"]).has(target.hostname)
  || target.pathname !== "/alpha_exchange_ci" || target.username !== "postgres") {
  throw new Error("Concurrency harness requires the dedicated loopback CI database.");
}
const pool = new Pool({ connectionString, max: 5, application_name: `alpha-audit-worker-${process.env.ALPHA_AUDIT_WORKER_ID}`,
  connectionTimeoutMillis: 5_000, statement_timeout: 15_000, query_timeout: 20_000 });

// No SQL text or bound values leave this controlled harness. Aggregate timings
// identify database waiting versus snapshot work without relaxing production
// diagnostics or security settings.
const queryTimings = new Map<string, { count: number; totalMs: number; maximumMs: number }>();
pool.on("connect", client => {
  const original = client.query.bind(client);
  client.query = ((...args: unknown[]) => {
    const query = args[0];
    const sql = typeof query === "string" ? query : String((query as { text?: unknown })?.text ?? "");
    const operation = /pg_advisory_xact_lock/.test(sql) ? "advisory_lock"
      : /jsonb_agg/.test(sql) ? "snapshot_aggregate"
      : /runtime_meta/.test(sql) ? "runtime_version"
      : /^(begin|commit|rollback)$/i.test(sql.trim()) ? sql.trim().toLowerCase()
      : `${sql.trim().split(/\s+/)[0]?.toLowerCase() ?? "other"}:${sql.match(/alpha_exchange\.([a-z_]+)/)?.[1] ?? "schema"}`;
    const started = performance.now();
    let finished = false;
    const record = () => {
      if (finished) return;
      finished = true;
      const elapsed = performance.now() - started;
      const previous = queryTimings.get(operation) ?? { count: 0, totalMs: 0, maximumMs: 0 };
      previous.count++; previous.totalMs += elapsed; previous.maximumMs = Math.max(previous.maximumMs, elapsed);
      queryTimings.set(operation, previous);
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
export function getRuntimePostgresPool() { return pool; }
export function getRuntimePostgresConnectionString() { return connectionString; }
