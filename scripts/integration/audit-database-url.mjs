/** @param {string} value @param {string} [databaseName] */
export function requireAuditDatabaseUrl(value, databaseName = "alpha_exchange_ci") {
  let target;
  try { target = new URL(value); } catch {
    // URL parser errors can include credentials from the original input.
    throw new Error("Dedicated loopback CI database required");
  }
  // pg-connection-string gives query parameters precedence over the URL's
  // authority (including host/user/password/port) and accepts file-based TLS
  // options. This fixture has no use for either; reject them before pg parses
  // anything. Checking URL.hostname alone does not isolate a database harness.
  if (!["alpha_exchange_ci", "alpha_exchange_restore_ci"].includes(databaseName)
    || !["postgres:", "postgresql:"].includes(target.protocol)
    || !["localhost", "127.0.0.1"].includes(target.hostname)
    || target.pathname !== `/${databaseName}` || target.username !== "postgres"
    || target.search || target.hash) {
    throw new Error("Dedicated loopback CI database required");
  }
  return target;
}
