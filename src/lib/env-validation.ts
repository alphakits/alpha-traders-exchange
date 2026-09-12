/**
 * Environment variable validation.
 * Called once at module load time in production to fail fast on missing config.
 */
import { isProductionSecurityRuntime } from "@/lib/runtime-safety";

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
  { key: "MOBILE_MIN_IOS_VERSION", required: false, description: "Minimum signed iOS app version accepted by mobile endpoints" },
  { key: "MOBILE_LATEST_IOS_VERSION", required: false, description: "Latest recommended signed iOS app version" },
  { key: "MOBILE_MIN_ANDROID_VERSION", required: false, description: "Minimum signed Android app version accepted by mobile endpoints" },
  { key: "MOBILE_LATEST_ANDROID_VERSION", required: false, description: "Latest recommended signed Android app version" },
  { key: "EXPO_ACCESS_TOKEN", required: false, description: "Server-only Expo Push access token when enhanced push security is enabled" },
  { key: "NEXT_PUBLIC_SITE_URL", required: false, description: "Canonical production site URL, e.g. https://www.alphatraders.co.il" },
  { key: "NEXT_PUBLIC_ALPHA_OWNER_WHATSAPP_URL", required: false, description: "Optional official owner WhatsApp HTTPS URL used by website and Discord contact buttons" },
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
  { key: "DISCORD_MARKETPLACE_API_KEY", required: false, description: "Internal credential authorizing marketplace Discord event relay requests" },
  { key: "DISCORD_MARKETPLACE_WEBHOOK_URL", required: false, description: "Discord webhook URL for marketplace event delivery" },
  { key: "DISCORD_MARKETPLACE_WEBHOOK_SECRET", required: false, description: "HMAC secret protecting marketplace event relay requests" },
  { key: "ALPHA_EXCHANGE_LARGE_TRADE_THRESHOLD", required: false, description: "Min USDT amount considered a large trade" },
  { key: "ALPHA_EXCHANGE_EVIDENCE_MAX_SIZE_MB", required: false, description: "Max evidence upload size in MB" },
  { key: "CRON_SECRET", required: false, description: "Bearer secret protecting scheduled Trade Room reminder jobs" },
  { key: "ALPHA_EXCHANGE_EXPOSE_RESET_TOKEN", required: false, description: "Dev-only: expose reset token in API response (never set in production)" },
  { key: "TWILIO_ACCOUNT_SID", required: false, description: "Twilio account SID for server-side SMS delivery" },
  { key: "TWILIO_AUTH_TOKEN", required: false, description: "Twilio auth token for server-side SMS delivery and callback validation" },
  { key: "TWILIO_PHONE_NUMBER", required: false, description: "Twilio E.164 sender number for server-side SMS delivery" },
  { key: "ALPHA_EXCHANGE_TWILIO_SEND_ENABLED", required: false, description: "Explicitly enable all outbound Twilio SMS" },
  { key: "ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", required: false, description: "Explicitly enable optional phone verification" },
  { key: "ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", required: false, description: "Phone verification transport: disabled, twilio, or whatsapp" },
  { key: "ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED", required: false, description: "Expose explicit WhatsApp notification consent controls after Meta policy clearance" },
  { key: "ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED", required: false, description: "Enable approved WhatsApp Cloud API template delivery" },
  { key: "ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED", required: false, description: "Enable direct Meta WhatsApp authentication-template phone verification" },
  { key: "ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED", required: false, description: "Confirm Meta approved the fixed WhatsApp authentication template" },
  { key: "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED", required: false, description: "Explicit operator acknowledgement that Meta provided written policy clearance" },
  { key: "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE", required: false, description: "Internal reference for Meta's written WhatsApp policy clearance" },
  { key: "ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET", required: false, description: "Server-only HMAC secret binding consent to the verified phone without storing it" },
  { key: "META_WHATSAPP_WABA_ID", required: false, description: "Server-only Meta WhatsApp Business Account identifier" },
  { key: "META_WHATSAPP_PHONE_NUMBER_ID", required: false, description: "Server-only Meta WhatsApp sender phone-number identifier" },
  { key: "META_WHATSAPP_ACCESS_TOKEN", required: false, description: "Server-only Meta WhatsApp Cloud API access token" },
  { key: "META_WHATSAPP_GRAPH_VERSION", required: false, description: "Pinned Meta Graph API version, for example v23.0" },
  { key: "META_WHATSAPP_APP_SECRET", required: false, description: "Server-only Meta app secret used to validate webhook signatures" },
  { key: "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN", required: false, description: "Server-only random token used for webhook verification" },
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
  "ALPHA_ENABLE_TEST_SUPPORT",
  "ALPHA_E2E_TEST_SUPPORT",
  "ALPHA_E2E_LOOPBACK_ONLY",
  "ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY",
  "ALPHA_EXCHANGE_QA_MODE",
  "ALPHA_EXCHANGE_QA_COMMISSION_MODE",
  "ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION",
  "PHOTO_VERIFICATION_BYPASS_EMAILS",
  "ALPHA_AUTH_DEBUG",
  "ALPHA_EXCHANGE_DEBUG_TRADE_ROOM",
  "NEXT_PUBLIC_ALPHA_EXCHANGE_DEBUG_TRADE_ROOM",
  "ALPHA_EXCHANGE_REPO_TRACE",
  "ALPHA_EXCHANGE_PERF",
  "ALPHA_EXCHANGE_PROFILE_LISTING_CREATE",
];

const DISCORD_MARKETPLACE_RELAY_ENV_VARS = [
  "DISCORD_MARKETPLACE_API_KEY",
  "DISCORD_MARKETPLACE_WEBHOOK_URL",
  "DISCORD_MARKETPLACE_WEBHOOK_SECRET",
] as const;

const WHATSAPP_OUTBOUND_REQUIRED_ENV_VARS = [
  "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE",
  "META_WHATSAPP_WABA_ID",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_GRAPH_VERSION",
] as const;

const WHATSAPP_NOTIFICATION_REQUIRED_ENV_VARS = [
  ...WHATSAPP_OUTBOUND_REQUIRED_ENV_VARS,
  "ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
] as const;

function isExplicitlyEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

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

    if (process.env.AUTH_COOKIE_SECURE === "false") {
      errors.push(
        "SECURITY: AUTH_COOKIE_SECURE=false is forbidden in production because authentication cookies must remain Secure.",
      );
    }

    for (const forbidden of PRODUCTION_FORBIDDEN) {
      if (isProductionSecurityRuntime() && process.env[forbidden]) {
        errors.push(
          `SECURITY: Environment variable ${forbidden} must NOT be set in production. Remove it immediately.`,
        );
      }
    }

    const configuredMarketplaceRelayVars = DISCORD_MARKETPLACE_RELAY_ENV_VARS
      .filter((key) => Boolean(process.env[key]?.trim()));
    if (configuredMarketplaceRelayVars.length > 0 && configuredMarketplaceRelayVars.length !== DISCORD_MARKETPLACE_RELAY_ENV_VARS.length) {
      const missing = DISCORD_MARKETPLACE_RELAY_ENV_VARS
        .filter((key) => !process.env[key]?.trim());
      errors.push(
        `Missing required marketplace Discord relay environment variable(s): ${missing.join(", ")}.`,
      );
    }

    const whatsappConsentUiEnabled = isExplicitlyEnabled(process.env.ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED);
    const whatsappSendEnabled = isExplicitlyEnabled(process.env.ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED);
    const whatsappAuthSendEnabled = isExplicitlyEnabled(process.env.ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED);
    const whatsappAuthTemplateApproved = isExplicitlyEnabled(process.env.ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED);
    const whatsappPolicyApproved = isExplicitlyEnabled(process.env.ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED);
    const twilioSendEnabled = isExplicitlyEnabled(process.env.ALPHA_EXCHANGE_TWILIO_SEND_ENABLED);
    const phoneVerificationEnabled = isExplicitlyEnabled(process.env.ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED);
    const phoneVerificationProvider = process.env.ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER?.trim().toLowerCase() || "disabled";
    const whatsappPhoneVerificationSelected = phoneVerificationProvider === "whatsapp";
    if (!["disabled", "twilio", "whatsapp"].includes(phoneVerificationProvider)) {
      errors.push("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER must be disabled, twilio, or whatsapp.");
    }
    if (twilioSendEnabled) {
      const missingTwilio = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"]
        .filter((key) => !process.env[key]?.trim());
      if (missingTwilio.length > 0) {
        errors.push(`Missing required Twilio environment variable(s): ${missingTwilio.join(", ")}.`);
      }
    }
    if (phoneVerificationEnabled && phoneVerificationProvider === "disabled") {
      errors.push("Phone verification requires an explicit twilio or whatsapp provider.");
    }
    if (phoneVerificationEnabled && phoneVerificationProvider === "twilio" && !twilioSendEnabled) {
      errors.push("Twilio phone verification requires ALPHA_EXCHANGE_TWILIO_SEND_ENABLED=true.");
    }
    if (phoneVerificationEnabled && whatsappPhoneVerificationSelected && !whatsappAuthSendEnabled) {
      errors.push(
        "WhatsApp phone verification requires ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED=true after the authentication template is approved.",
      );
    }
    const whatsappNotificationConfigured = whatsappConsentUiEnabled || whatsappSendEnabled;
    const whatsappAuthenticationConfigured = whatsappAuthSendEnabled || (phoneVerificationEnabled && whatsappPhoneVerificationSelected);
    if (whatsappAuthenticationConfigured && !whatsappAuthTemplateApproved) {
      errors.push(
        "WhatsApp phone verification requires ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED=true after Meta approves alpha_phone_verification.",
      );
    }
    if (whatsappNotificationConfigured || whatsappAuthenticationConfigured) {
      const required = new Set<string>();
      if (whatsappNotificationConfigured) {
        for (const key of WHATSAPP_NOTIFICATION_REQUIRED_ENV_VARS) required.add(key);
      }
      if (whatsappAuthenticationConfigured) {
        for (const key of WHATSAPP_OUTBOUND_REQUIRED_ENV_VARS) required.add(key);
      }
      const missing = [...required].filter((key) => !process.env[key]?.trim());
      if (!whatsappPolicyApproved) {
        errors.push(
          "WhatsApp delivery cannot be enabled until ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED=true confirms written Meta policy clearance.",
        );
      }
      if (missing.length > 0) {
        errors.push(
          `Missing required WhatsApp Cloud API environment variable(s): ${missing.join(", ")}.`,
        );
      }
      const graphVersion = process.env.META_WHATSAPP_GRAPH_VERSION?.trim() ?? "";
      if (graphVersion && !/^v\d+\.\d+$/.test(graphVersion)) {
        errors.push("META_WHATSAPP_GRAPH_VERSION must be pinned in vNN.N format.");
      }
      for (const key of ["META_WHATSAPP_WABA_ID", "META_WHATSAPP_PHONE_NUMBER_ID"] as const) {
        const value = process.env[key]?.trim() ?? "";
        if (value && !/^\d+$/.test(value)) {
          errors.push(`${key} must contain digits only.`);
        }
      }
      const fingerprintSecret = process.env.ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET?.trim() ?? "";
      if (whatsappNotificationConfigured && fingerprintSecret && fingerprintSecret.length < 32) {
        errors.push("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET must contain at least 32 characters.");
      }
    }
  }

  return { warnings, errors };
}

/**
 * Validates environment variables and logs results.
 * Throws in a deployed production runtime if required variables are missing or
 * a prohibited test/debug flag is configured. Local builds retain the existing
 * relaxed behavior when they are not a deployed production runtime.
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
    const isLocalBuild = process.env.NEXT_PHASE === "phase-production-build"
      && !process.env.VERCEL
      && !process.env.VERCEL_ENV;
    if (isProductionSecurityRuntime() && !isLocalBuild) {
      throw new Error(
        `Environment validation failed with ${errors.length} error(s). See logs above.`,
      );
    }
  }
}
