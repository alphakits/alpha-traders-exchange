import { parseStagingEmailAllowlist } from "./email-preview-safety";

type Environment = Readonly<Record<string, string | undefined>>;

export function validateUsdtReleaseRuntime(version = process.versions.node): string[] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) !== 24 || Number(match[2]) < 22 || (Number(match[2]) === 22 && Number(match[3]) < 1)) {
    return ["Release preflight requires Node.js >=24.22.1 <25, including its patched built-in fetch runtime."];
  }
  return [];
}

export const USDT_OFFLINE_FLAGS = ["ALPHA_USDT_OFFLINE_PREVIEW", "ALPHA_USDT_OFFLINE_QUOTE_SCENARIOS"] as const;
const SYNTHETIC_CARDLESS_KEYS = new Set([
  "offline-preview-synthetic-credentials-only",
  "alpha-exchange-loopback-e2e-cardless-key-only",
]);

function isReleaseHostname(raw: string) {
  const hostname = raw.toLowerCase().replace(/\.$/, "");
  // Release origins use DNS names. Rejecting IP literals also catches WHATWG
  // normalization of decimal/hex IPv4 and IPv4-mapped IPv6 loopback addresses.
  return hostname.includes(".") && !hostname.includes(":") && !/^\d+(?:\.\d+){3}$/.test(hostname)
    && hostname !== "localhost" && !/\.(invalid|test|localhost|local|internal|example)$/.test(hostname);
}

/** Configuration-only checks: no network, credentials, or environment values are logged. */
export function validateUsdtReleaseConfig(env: Environment): string[] {
  const errors: string[] = [];
  for (const key of ["ALPHA_USDT_REQUESTS_ENABLED", "ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED"] as const) {
    if (env[key] !== undefined && env[key] !== "" && env[key] !== "0" && env[key] !== "1") {
      errors.push(`${key} must be exactly 0 or 1; unset means disabled.`);
    }
  }
  if (env.ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED === "1") {
    for (const key of ["RESEND_API_KEY", "EMAIL_FROM"] as const) {
      if (!env[key]?.trim()) errors.push(`Buy Requests email delivery requires ${key}.`);
    }
    if (env.VERCEL_ENV === "preview" && !parseStagingEmailAllowlist(env.ALPHA_EMAIL_STAGING_ALLOWLIST)) {
      errors.push("Preview email delivery requires ALPHA_EMAIL_STAGING_ALLOWLIST with exact, comma-separated approved email addresses.");
    }
  }
  for (const key of USDT_OFFLINE_FLAGS) {
    if (env[key]) errors.push(`SECURITY: ${key} must not be set in a release environment.`);
  }
  for (const key of ["ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET", "ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_PREVIOUS_SECRET"] as const) {
    if (SYNTHETIC_CARDLESS_KEYS.has(env[key]?.trim() ?? "")) {
      errors.push(`SECURITY: ${key} contains a public test fixture key; configure private release key material.`);
    }
  }
  const endpoint = env.ALPHA_FX_REFERENCE_URL;
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password || url.hash || !isReleaseHostname(url.hostname)) throw new Error("invalid endpoint");
    } catch {
      errors.push("ALPHA_FX_REFERENCE_URL must be an HTTPS provider URL with a public DNS hostname and no embedded credentials or fragments.");
    }
  }
  return errors;
}

/** A deliberate release preflight never accepts the local production-test exemption. */
export function validateUsdtReleaseState(env: Environment, expected: "off" | "on"): string[] {
  const errors = validateUsdtReleaseConfig(env);
  if (env.NODE_ENV !== "production") errors.push("Release preflight requires NODE_ENV=production.");
  for (const key of ["ALPHA_ENABLE_TEST_SUPPORT", "ALPHA_E2E_TEST_SUPPORT", "ALPHA_E2E_LOOPBACK_ONLY", "ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY"]) {
    if (env[key]) errors.push(`SECURITY: ${key} must not be set during a release preflight.`);
  }
  const featureOn = env.ALPHA_USDT_REQUESTS_ENABLED === "1";
  if (featureOn !== (expected === "on")) errors.push(`Buy Requests must be ${expected} for this preflight.`);
  if (expected === "off" && env.ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED === "1") {
    errors.push("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED must be disabled for the feature-off rollout or rollback.");
  }
  if (expected === "on" && (env.ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET?.trim().length ?? 0) < 32) {
    errors.push("Buy Requests release requires a dedicated ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET with at least 32 characters.");
  }
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
    if (site.protocol !== "https:" || site.username || site.password
      || site.pathname !== "/" || site.search || site.hash
      || !isReleaseHostname(site.hostname)) throw new Error("invalid origin");
  } catch { errors.push("Release preflight requires NEXT_PUBLIC_SITE_URL to be a public HTTPS origin."); }
  return errors;
}
