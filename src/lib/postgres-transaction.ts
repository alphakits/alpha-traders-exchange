import type { PoolClient } from "pg";

/** A client-side timeout does not prove that PostgreSQL stopped the query. */
export function isUncertainPostgresConnection(error: unknown) {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  // Worker errors can wrap a failed persistence attempt. Bound traversal and
  // retain the original error without logging messages or driver parameters.
  while (pending.length && seen.size < 32) {
    const current = pending.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const code = typeof current === "object" && current !== null ? (current as { code?: unknown }).code : undefined;
    if (typeof code === "string" && ["08000", "08003", "08006", "57P01", "57P02", "57P03"].includes(code)) return true;
    if (current instanceof Error) {
      if (/query read timeout|timeout exceeded when trying to connect|connection terminated|connection closed|ECONNRESET|EPIPE|ETIMEDOUT/i.test(current.message)) return true;
      if (current.cause) pending.push(current.cause);
      if (current instanceof AggregateError) pending.push(...current.errors.slice(0, 32));
    }
  }
  return false;
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
