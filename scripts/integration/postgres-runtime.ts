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
export function getRuntimePostgresPool() { return pool; }
export function getRuntimePostgresConnectionString() { return connectionString; }
