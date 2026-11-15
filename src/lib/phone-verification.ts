import { allowsTestOnlyRuntime, isProductionSecurityRuntime } from "@/lib/runtime-safety";
import { isVerified } from "@/lib/verification-bypass";
import { phoneVerificationDestinationForPage } from "@/lib/phone-verification-page";
import { needsAdultConfirmation } from "@/lib/age-eligibility";

function isExplicitlyEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

const MAX_PHONE_VERIFICATION_EMAIL_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000;
const PHONE_VERIFICATION_EMAIL_FALLBACK_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A deliberately separate, short-lived production switch for an SMS outage.
 * It never marks a phone as verified; email verification remains mandatory.
 */
export function isMarketplacePhoneVerificationEmailFallbackActive(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (!isProductionSecurityRuntime()) return false;
  const configuredUntil = env.ALPHA_EXCHANGE_PHONE_VERIFICATION_EMAIL_FALLBACK_UNTIL?.trim();
  if (!configuredUntil || !PHONE_VERIFICATION_EMAIL_FALLBACK_TIMESTAMP.test(configuredUntil)) return false;
  const until = Date.parse(configuredUntil);
  return Number.isFinite(until)
    && new Date(until).toISOString() === configuredUntil
    && until > now
    && until - now <= MAX_PHONE_VERIFICATION_EMAIL_FALLBACK_MS;
}

export function marketplacePhoneVerificationEmailFallbackUntilDate(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (!isMarketplacePhoneVerificationEmailFallbackActive(env, now)) return null;
  const until = Date.parse(env.ALPHA_EXCHANGE_PHONE_VERIFICATION_EMAIL_FALLBACK_UNTIL!.trim());
  return new Date(until).toISOString().slice(0, 10);
}

/**
 * Production participants verify their phone or match an exact owner-authorized account. Feature
 * switches are retained only for isolated local development and test fixtures.
 */
export function isMarketplacePhoneVerificationEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (isProductionSecurityRuntime()) return !isMarketplacePhoneVerificationEmailFallbackActive(env);
  if (isMarketplacePhoneVerificationDisabled(env)) return false;
  return isExplicitlyEnabled(env.ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED);
}

export function isMarketplacePhoneVerificationDisabled(env: NodeJS.ProcessEnv = process.env) {
  return allowsTestOnlyRuntime() && env.ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION === "1";
}

/** Production access fails closed regardless of delivery configuration. */
export function isMarketplacePhoneVerificationRequired(env: NodeJS.ProcessEnv = process.env) {
  if (isProductionSecurityRuntime()) return !isMarketplacePhoneVerificationEmailFallbackActive(env);
  return isMarketplacePhoneVerificationEnabled(env)
    && isExplicitlyEnabled(env.ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED);
}

type MarketplaceVerificationUser = {
  id?: string | null;
  disabled?: boolean;
  role: string;
  roles?: string[];
  sellerStatus?: string;
  email?: string | null;
  emailVerified?: boolean;
  verifiedPhone?: string | null;
  phoneVerifiedAt?: string | null;
  ageEligibility?: unknown;
};

export function needsMarketplacePhoneVerification(user: MarketplaceVerificationUser | null | undefined) {
  if (!user || !isMarketplacePhoneVerificationRequired()) return false;
  return !isVerified(user);
}

/** Uses canonical account data rather than an unsigned verification cookie. */
export function marketplacePhoneVerificationDestination(
  user: MarketplaceVerificationUser | null | undefined,
  pagePath: string,
  locale: "en" | "ar",
) {
  const needsEmailFallback = Boolean(
    user
    && isMarketplacePhoneVerificationEmailFallbackActive()
    && user.emailVerified !== true,
  );
  if (!user || (!needsEmailFallback && !needsMarketplacePhoneVerification(user) && !needsAdultConfirmation(user))) return null;
  return phoneVerificationDestinationForPage(user, pagePath, locale);
}
