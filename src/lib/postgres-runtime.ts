import { Pool } from "pg";

declare global {
  var __alphaTradersRuntimeDbPool: Pool | undefined;
}

export function getRuntimePostgresConnectionString() {
  return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";
}

/**
 * Warn in production if the connection string points at the Supabase direct host
 * (db.<ref>.supabase.co) rather than the connection pooler.
 * The direct host is unreachable from Vercel serverless functions.
 * Use the Transaction Mode pooler instead:
 *   postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
 */
function warnIfDirectSupabaseUrl(connectionString: string) {
  if (
    process.env.NODE_ENV === "production" &&
    /db\.[a-z0-9]+\.supabase\.co/.test(connectionString)
  ) {
    console.error(
      "[postgres-runtime] FATAL: SUPABASE_DB_URL points at the Supabase direct host " +
        "(db.<ref>.supabase.co). This is not reachable from Vercel serverless functions. " +
        "Replace it with the Supabase Transaction Mode connection pooler URL: " +
        "postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres",
    );
  }
}

export function getRuntimePostgresPool() {
  const connectionString = getRuntimePostgresConnectionString();
  if (!connectionString) {
    return null;
  }

  warnIfDirectSupabaseUrl(connectionString);

  if (!globalThis.__alphaTradersRuntimeDbPool) {
    const pool = new Pool({
      connectionString,
      ssl: process.env.SUPABASE_DB_SSL === "false" ? undefined : { rejectUnauthorized: false },
      // 5 connections per instance balances parallelism with Supabase pooler limits.
      // loadSnapshot issues 23 parallel queries; with max:2 they serialize into ~12 batches
      // (≈1200ms). With max:5 they batch into ~5 rounds (≈400ms), saving ~800ms per cold load.
      // Each Vercel function instance still holds at most 5 connections concurrently.
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });

    // Surface misconfigured connection strings early in production logs.
    pool.on("error", (err) => {
      if (err.message.includes("ENOTFOUND") && /db\.[a-z0-9]+\.supabase\.co/.test(connectionString)) {
        console.error(
          "[postgres-runtime] FATAL: getaddrinfo ENOTFOUND — SUPABASE_DB_URL is using the " +
            "Supabase DIRECT host (db.<ref>.supabase.co) which Vercel cannot resolve. " +
            "Update SUPABASE_DB_URL to the Transaction Mode POOLER URL:\n" +
            "  postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres\n" +
            "Get this URL: Supabase Dashboard → Project Settings → Database → Connection Pooling tab.",
        );
      } else {
        console.error("[postgres-runtime] Pool error:", err.message);
      }
    });

    globalThis.__alphaTradersRuntimeDbPool = pool;
  }

  return globalThis.__alphaTradersRuntimeDbPool;
}
