import type { PoolClient } from "pg";

const guarded = new WeakSet<PoolClient>();
type Callback = (...args: unknown[]) => unknown;

function isReadTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "message" in error && error.message === "Query read timeout";
}

/**
 * pg's client-side query_timeout rejects a call without necessarily closing a
 * checked-out connection. A ROLLBACK queued behind that stalled response can
 * then stall too. Retire that client before handing the timeout to its caller.
 * pool.query already releases failed clients; this also covers pool.connect.
 *
 * No SQL is changed, canceled through another connection, replayed or retried.
 * A COMMIT timeout still has an unknown outcome and must not become a retry.
 * Server SQL errors (including 57014) keep normal transaction rollback behavior.
 */
export function installPostgresTimeoutGuard(client: PoolClient): void {
  // PoolClient declarations omit end(); verify the actual driver capability.
  // Do not assume a custom pool implementation exposes a shutdown method.
  if (guarded.has(client) || !("end" in client) || typeof client.end !== "function") return;
  const end = client.end;
  guarded.add(client);
  const original = client.query;
  let closing = false;

  const retire = (error: unknown) => {
    if (!isReadTimeout(error) || closing) return;
    closing = true;
    try {
      // Public pg API: end() destroys the stream when a query is still active.
      // Never wait for shutdown before returning the original timeout error.
      void Promise.resolve(Reflect.apply(end, client, [])).catch(() => undefined);
    } catch {
      // Preserve the original query error, not a secondary shutdown failure.
    }
  };
  const wrap = (callback: Callback): Callback => function (this: unknown, ...args: unknown[]) {
    retire(args[0]);
    return Reflect.apply(callback, this, args);
  };

  client.query = function (...input: unknown[]) {
    const args = [...input];
    const config = args[0];
    // Custom Submittable objects/cursors have their own lifecycle. Leave those
    // extension APIs untouched; application calls use ordinary SQL/configs.
    if (typeof config === "object" && config !== null
      && "submit" in config && typeof config.submit === "function") {
      return Reflect.apply(original, client, args);
    }
    if (typeof args[2] === "function") args[2] = wrap(args[2] as Callback);
    else if (typeof args[1] === "function") args[1] = wrap(args[1] as Callback);
    else if (typeof config === "object" && config !== null
      && "callback" in config && typeof config.callback === "function") {
      args[0] = { ...config, callback: wrap(config.callback as Callback) };
    }
    const result: unknown = Reflect.apply(original, client, args);
    if (typeof result === "object" && result !== null
      && "then" in result && typeof result.then === "function"
      && "catch" in result && typeof result.catch === "function") {
      return result.catch((error: unknown) => { retire(error); throw error; });
    }
    return result;
  } as PoolClient["query"];
}
