import { Pool } from "pg";
import { isProductionSecurityRuntime } from "@/lib/runtime-safety";
import { logEvent } from "@/lib/structured-logging";

declare global {
  var __alphaTradersRuntimeDbPool: Pool | undefined;
}

const POSTGRES_SSL_QUERY_PARAMETERS = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "uselibpqcompat",
] as const;

export function getRuntimePostgresConnectionString() {
  return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "";
}

function withVerifiedTlsConfiguration(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    for (const parameter of POSTGRES_SSL_QUERY_PARAMETERS) {
      parsed.searchParams.delete(parameter);
    }
    return parsed.toString();
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PostgreSQL connection string must be a valid URL in production.");
    }
    return connectionString;
  }
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
    logEvent("error", {
      event: "postgres_runtime_configuration",
      outcome: "failed",
      reason: "supabase_direct_host_configured",
    });
  }
}

export function getRuntimePostgresPool() {
  if (process.env.ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY === "1") {
    if (isProductionSecurityRuntime()) {
      throw new Error("In-memory Alpha Exchange persistence is forbidden in production.");
    }
    return null;
  }

  const configuredConnectionString = getRuntimePostgresConnectionString();
  if (!configuredConnectionString) {
    if (isProductionSecurityRuntime()) {
      throw new Error("PostgreSQL persistence is required in production.");
    }
    return null;
  }

  warnIfDirectSupabaseUrl(configuredConnectionString);
  if (
    process.env.NODE_ENV === "production"
    && process.env.SUPABASE_DB_SSL === "false"
  ) {
    throw new Error("PostgreSQL TLS verification cannot be disabled in production.");
  }
  const connectionString = withVerifiedTlsConfiguration(configuredConnectionString);

  if (!globalThis.__alphaTradersRuntimeDbPool) {
    const ca = process.env.SUPABASE_DB_CA?.trim();
    const pool = new Pool({
      connectionString,
      ssl: process.env.SUPABASE_DB_SSL === "false"
        ? undefined
        : {
            rejectUnauthorized: true,
            ...(ca ? { ca } : {}),
          },
      // Tuned from measured production-like load, not an arbitrary default:
      // - Workload: auth/login + listing/trade flows repeatedly trigger cold snapshot reads.
      // - Pattern: loadSnapshot performs 23 independent SELECTs.
      // - Evidence: max:2 forced ~12 serialized batches (~0.9-1.3s loadSnapshot time).
      // - Result: max:5 reduced this to ~5 batches (~0.35-0.45s), removing ~0.8s contention.
      // Keep at 5 unless new profiling data proves a better trade-off with pooler pressure.
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });

    // Surface misconfigured connection strings early in production logs.
    pool.on("error", (err) => {
      if (err.message.includes("ENOTFOUND") && /db\.[a-z0-9]+\.supabase\.co/.test(connectionString)) {
        logEvent("error", {
          event: "postgres_runtime_pool",
          outcome: "failed",
          reason: "supabase_direct_host_unreachable",
        });
      } else {
        logEvent("error", {
          event: "postgres_runtime_pool",
          outcome: "failed",
          reason: "pool_error",
          metadata: { errorType: err.name },
        });
      }
    });

    globalThis.__alphaTradersRuntimeDbPool = pool;
  }

  return globalThis.__alphaTradersRuntimeDbPool;
}
