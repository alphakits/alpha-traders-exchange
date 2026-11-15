import { allowsTestOnlyRuntime, isProductionSecurityRuntime } from "@/lib/runtime-safety";
import { isVerified } from "@/lib/verification-bypass";
import { phoneVerificationDestinationForPage } from "@/lib/phone-verification-page";
import { needsAdultConfirmation } from "@/lib/age-eligibility";

function isExplicitlyEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Controls whether the OTP capability is exposed to the application.
 * Production keeps the capability path available; whether verification is
 * required for access is decided separately by
 * isMarketplacePhoneVerificationRequired().
 */
export function isMarketplacePhoneVerificationEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (isProductionSecurityRuntime()) return true;
  if (isMarketplacePhoneVerificationDisabled(env)) return false;
  return isExplicitlyEnabled(env.ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED);
}

export function isMarketplacePhoneVerificationDisabled(env: NodeJS.ProcessEnv = process.env) {
  return allowsTestOnlyRuntime() && env.ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION === "1";
}

/** Explicit production outage policy; isolated local fixtures keep their existing rules. */
export function isMarketplacePhoneVerificationOutageActive(env: NodeJS.ProcessEnv = process.env) {
  return isProductionSecurityRuntime()
    && env.ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED?.trim().toLowerCase() === "false";
}

/**
 * Production keeps phone verification required by default. An explicit
 * `false` is the owner-controlled temporary SMS-outage mode; no missing,
 * malformed, test-only, or client-controlled value can disable the gate.
 */
export function isMarketplacePhoneVerificationRequired(env: NodeJS.ProcessEnv = process.env) {
  if (isProductionSecurityRuntime()) return !isMarketplacePhoneVerificationOutageActive(env);
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
  if (!user) return null;
  const needsEmailVerification = isMarketplacePhoneVerificationOutageActive() && user.emailVerified !== true;
  if (!needsEmailVerification && !needsMarketplacePhoneVerification(user) && !needsAdultConfirmation(user)) return null;
  return phoneVerificationDestinationForPage(user, pagePath, locale);
}
