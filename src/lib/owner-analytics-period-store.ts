import "server-only";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";

/** Activation is explicit. Reads and deployments never create or reset a period. */
export async function readOwnerAnalyticsStart(): Promise<string> {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Analytics storage unavailable");
  const result = await pool.query<{ started_at: string }>(
    `select started_at::text as started_at from alpha_exchange.owner_analytics_periods
     where id = 'unique-visitors-v1' and started_at <= now()`,
  );
  const startedAt = result.rows[0]?.started_at;
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) throw new Error("Analytics period not activated");
  // Keep PostgreSQL's complete timestamp, including microseconds, in filters.
  return startedAt;
}
