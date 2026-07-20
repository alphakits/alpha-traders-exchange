/**
 * Environment variable validation.
 * Called once at module load time in production to fail fast on missing config.
 */

type EnvVar = {
  key: string;
  required: boolean;
  description: string;
};

const ENV_VARS: EnvVar[] = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", required: true, description: "Supabase project URL used by the browser and server clients" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, description: "Supabase anon key used by the browser and server clients" },
  { key: "SUPABASE_DB_URL", required: false, description: "PostgreSQL connection string used for Alpha Exchange runtime persistence" },
  { key: "NEXT_PUBLIC_SITE_URL", required: false, description: "Canonical production site URL, e.g. https://alphatraders.academy" },
  { key: "AUTH_COOKIE_SECURE", required: false, description: "Force cookie secure flag on/off" },
  { key: "ADMIN_ACCESS_KEY", required: false, description: "Extra key required for admin API endpoints" },
  { key: "ALPHA_EXCHANGE_LARGE_TRADE_THRESHOLD", required: false, description: "Min USDT amount considered a large trade" },
  { key: "ALPHA_EXCHANGE_EVIDENCE_MAX_SIZE_MB", required: false, description: "Max evidence upload size in MB" },
  { key: "ALPHA_EXCHANGE_STALE_TRADE_TIMEOUT_MINUTES", required: false, description: "Auto-cancel threshold for stale trades in minutes" },
  { key: "ALPHA_EXCHANGE_EXPOSE_RESET_TOKEN", required: false, description: "Dev-only: expose reset token in API response (never set in production)" },
];

const PRODUCTION_FORBIDDEN: string[] = [
  "ALPHA_EXCHANGE_EXPOSE_RESET_TOKEN",
];

/**
 * Validate environment variables and return a list of warnings/errors.
 * Throws in production if a forbidden dev var is set.
 */
export function validateEnv(): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const isProduction = process.env.NODE_ENV === "production";

  for (const envVar of ENV_VARS) {
    const value = process.env[envVar.key];
    if (envVar.required && !value) {
      errors.push(`Missing required environment variable: ${envVar.key} — ${envVar.description}`);
    }
  }

  if (isProduction) {
    if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
      errors.push(
        "Missing required environment variable: SUPABASE_DB_URL (or DATABASE_URL) — PostgreSQL persistence is required in production.",
      );
    }

    if (!process.env.NEXT_PUBLIC_SITE_URL) {
      warnings.push(
        "NEXT_PUBLIC_SITE_URL is not set. Production metadata and sitemap will fall back to Vercel-provided hostnames instead of the custom domain.",
      );
    }

    for (const forbidden of PRODUCTION_FORBIDDEN) {
      if (process.env[forbidden]) {
        errors.push(
          `SECURITY: Environment variable ${forbidden} must NOT be set in production. Remove it immediately.`,
        );
      }
    }
  }

  return { warnings, errors };
}

/**
 * Validates environment at startup and logs results.
 * Call this from a shared module that is imported during server initialisation.
 */
export function runEnvValidation(): void {
  const { warnings, errors } = validateEnv();

  for (const warning of warnings) {
    console.warn("[env-validation]", warning);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error("[env-validation] FATAL:", error);
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `Environment validation failed with ${errors.length} error(s). See logs above.`,
      );
    }
  }
}
