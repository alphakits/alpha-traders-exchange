import type { Pool, QueryConfig } from "pg";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";

export const DATABASE_HEALTH_TIMEOUT_MS = 4_000;

export type DatabaseHealthResult = {
  status: "ok" | "error";
  durationMs: number;
  reason?: "timeout" | "unavailable";
};

type DatabaseHealthOptions = {
  pool?: Pool | null;
  timeoutMs?: number;
};

// node-postgres supports this per-query option at runtime, but its QueryConfig
// type currently exposes query_timeout only on ClientConfig.
type QueryConfigWithTimeout = QueryConfig & {
  query_timeout: number;
};

/**
 * Runs the smallest possible database readiness probe.
 *
 * This deliberately bypasses AlphaExchangeRepository: repository startup also
 * verifies the application schema and may seed local data, neither of which
 * belongs on the public liveness/readiness hot path.
 */
export async function checkRuntimeDatabaseHealth(
  options: DatabaseHealthOptions = {},
): Promise<DatabaseHealthResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? DATABASE_HEALTH_TIMEOUT_MS;

  try {
    const pool = options.pool === undefined ? getRuntimePostgresPool() : options.pool;
    if (!pool) {
      return {
        status: "ok",
        durationMs: Date.now() - startedAt,
      };
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const query: QueryConfigWithTimeout = {
        text: "select 1",
        query_timeout: timeoutMs,
      };
      await Promise.race([
        pool.query(query),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("database_health_timeout")), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    return {
      status: "ok",
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "error",
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error && error.message === "database_health_timeout"
        ? "timeout"
        : "unavailable",
    };
  }
}
