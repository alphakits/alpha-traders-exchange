import type { PoolClient } from "pg";

/** A client-side timeout does not prove that PostgreSQL stopped the query. */
export function isUncertainPostgresConnection(error: unknown) {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && ["08000", "08003", "08006", "57P01", "57P02", "57P03"].includes(code)) return true;
  const message = error instanceof Error ? error.message : "";
  return /query read timeout|timeout exceeded when trying to connect|connection terminated|connection closed|ECONNRESET|EPIPE|ETIMEDOUT/i.test(message);
}

/** Returns whether release(true) is required. Never mask the original error,
 * queue a rollback behind an uncertain query, or reuse a failed transaction. */
export async function rollbackFailedTransaction(client: Pick<PoolClient, "query">, error: unknown): Promise<boolean> {
  if (isUncertainPostgresConnection(error)) return true;
  try {
    await client.query("rollback");
    return false;
  } catch {
    return true;
  }
}
