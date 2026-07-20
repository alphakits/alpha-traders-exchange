import { Pool } from "pg";

declare global {
  var __alphaTradersRuntimeDbPool: Pool | undefined;
}

export function getRuntimePostgresConnectionString() {
  return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";
}

export function getRuntimePostgresPool() {
  const connectionString = getRuntimePostgresConnectionString();
  if (!connectionString) {
    return null;
  }

  if (!globalThis.__alphaTradersRuntimeDbPool) {
    globalThis.__alphaTradersRuntimeDbPool = new Pool({
      connectionString,
      ssl: process.env.SUPABASE_DB_SSL === "false" ? undefined : { rejectUnauthorized: false },
      max: 10,
    });
  }

  return globalThis.__alphaTradersRuntimeDbPool;
}
