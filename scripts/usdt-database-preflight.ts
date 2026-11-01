import { getRuntimePostgresPool } from "../src/lib/postgres-runtime";
import { readUsdtDemandSchemaReadiness } from "../src/lib/usdt-demand-schema-readiness";
import type { Pool } from "pg";

// Explicit operator command. Uses the application's PostgreSQL/TLS settings;
// never bootstrap or migrations. It is safe with either feature-flag value.
async function main() {
  let pool: Pool | null = null;
  try {
    pool = getRuntimePostgresPool();
    if (!pool) throw new Error("Database configuration unavailable");
    const client = await pool.connect();
    try {
      await client.query("begin read only");
      await client.query("set local statement_timeout='10s'");
      const result = await readUsdtDemandSchemaReadiness(client);
      await client.query("rollback");
      console.log(JSON.stringify({ check: "usdt_database_catalog", ...result,
        scope: "Catalog and current database role only. This does not certify staging, concurrency, backup recovery, or provider delivery." }, null, 2));
      if (!result.ready) process.exitCode = 1;
    } finally { client.release(true); }
  } catch {
    // Driver messages can contain host names or credentials. No raw error output.
    console.error(JSON.stringify({ check: "usdt_database_catalog", ready: false, issues: ["database_check_failed"] }));
    process.exitCode = 1;
  } finally {
    try { await pool?.end(); }
    catch {
      console.error(JSON.stringify({ check: "usdt_database_catalog", ready: false, issues: ["database_shutdown_failed"] }));
      process.exitCode = 1;
    }
  }
}
void main();
