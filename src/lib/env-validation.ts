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
  { key: "SUPABASE_DB_CA", required: false, description: "Optional PEM certificate authority for verified PostgreSQL TLS" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", required: false, description: "Supabase service role key used for admin media uploads to object storage" },
  { key: "SUPABASE_ADMIN_MEDIA_BUCKET", required: false, description: "Supabase Storage bucket for admin lesson/media uploads" },
  { key: "NEXT_PUBLIC_SITE_URL", required: false, description: "Canonical production site URL, e.g. https://www.alphatraders.co.il" },
  { key: "AUTH_COOKIE_SECURE", required: false, description: "Force cookie secure flag on/off" },
  { key: "ADMIN_ACCESS_KEY", required: false, description: "Extra key required for admin API endpoints" },
  { key: "DISCORD_BOT_TOKEN", required: false, description: "Discord bot credential used by the server-only gateway client" },
  { key: "DISCORD_APPLICATION_ID", required: false, description: "Discord application identifier used to verify the connected bot" },
  { key: "DISCORD_CLIENT_ID", required: false, description: "Website Discord OAuth client identifier" },
  { key: "DISCORD_CLIENT_SECRET", required: false, description: "Website-only Discord OAuth client secret used for account linking" },
  { key: "DISCORD_REDIRECT_URI", required: false, description: "Exact website Discord OAuth callback URI" },
  { key: "DISCORD_GUILD_ID", required: false, description: "Discord guild identifier verified during gateway startup" },
  { key: "DISCORD_WORKER_BASE_URL", required: false, description: "Fixed HTTPS Railway worker origin used by server-side admin diagnostics" },
  { key: "DISCORD_WORKER_HEALTH_SECRET", required: false, description: "Dedicated secret used to authenticate worker readiness probes" },
  { key: "ALPHA_EXCHANGE_LARGE_TRADE_THRESHOLD", required: false, description: "Min USDT amount considered a large trade" },
  { key: "ALPHA_EXCHANGE_EVIDENCE_MAX_SIZE_MB", required: false, description: "Max evidence upload size in MB" },
  { key: "ALPHA_EXCHANGE_STALE_TRADE_TIMEOUT_MINUTES", required: false, description: "Auto-cancel threshold for stale trades in minutes" },
  { key: "ALPHA_EXCHANGE_EXPOSE_RESET_TOKEN", required: false, description: "Dev-only: expose reset token in API response (never set in production)" },
  { key: "TWILIO_ACCOUNT_SID", required: false, description: "Twilio account SID for server-side SMS delivery" },
  { key: "TWILIO_AUTH_TOKEN", required: false, description: "Twilio auth token for server-side SMS delivery and callback validation" },
  { key: "TWILIO_PHONE_NUMBER", required: false, description: "Twilio E.164 sender number for server-side SMS delivery" },
];

const DISCORD_REQUIRED_ENV_VARS = [
  "DISCORD_BOT_TOKEN",
  "DISCORD_APPLICATION_ID",
  "DISCORD_GUILD_ID",
] as const;

const DISCORD_SNOWFLAKE_ENV_VARS = [
  "DISCORD_APPLICATION_ID",
  "DISCORD_GUILD_ID",
] as const;

export type DiscordEnvironmentValidation = {
  errors: string[];
};

export type EnvironmentValues = Readonly<Record<string, string | undefined>>;

/**
 * Discord is an optional subsystem for the web app, but all three values are
 * required whenever the gateway service is explicitly started.
 */
export function validateDiscordEnv(
  env: EnvironmentValues = process.env,
): DiscordEnvironmentValidation {
  const errors: string[] = [];

  for (const key of DISCORD_REQUIRED_ENV_VARS) {
    if (!env[key]?.trim()) {
      errors.push(`Missing required Discord environment variable: ${key}.`);
    }
  }

  for (const key of DISCORD_SNOWFLAKE_ENV_VARS) {
    const value = env[key]?.trim();
    if (value && !/^\d{17,20}$/.test(value)) {
      errors.push(`Invalid Discord environment variable: ${key} must be a Discord snowflake.`);
    }
  }

  return { errors };
}

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
    if (process.env.SUPABASE_DB_SSL === "false") {
      errors.push(
        "SECURITY: SUPABASE_DB_SSL=false is forbidden in production because PostgreSQL TLS identity verification is required.",
      );
    }
    if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
      errors.push(
        "Missing required environment variable: SUPABASE_DB_URL (or DATABASE_URL) — PostgreSQL persistence is required in production.",
      );
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      errors.push(
        "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY — admin media uploads require object storage credentials in production.",
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
 * Validates environment variables and logs results.
 * Throws in production runtime if required vars are missing.
 * Does NOT throw during `next build` (NEXT_PHASE=phase-production-build) so local
 * builds can proceed without a full set of production credentials.
 */
export function runEnvValidation(): void {
  const { warnings, errors } = validateEnv();

  for (const warning of warnings) {
    console.warn("[env-validation]", warning);
  }

  // Skip throwing during the Next.js build phase — env vars may not be present
  // locally. On Vercel the build environment has all vars set, so this guard
  // only relaxes local development builds.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

  if (errors.length > 0) {
    for (const error of errors) {
      console.error("[env-validation] FATAL:", error);
    }
    if (process.env.NODE_ENV === "production" && !isBuildPhase) {
      throw new Error(
        `Environment validation failed with ${errors.length} error(s). See logs above.`,
      );
    }
  }
}
