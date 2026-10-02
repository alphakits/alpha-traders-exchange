import { allowsTestOnlyRuntime } from "@/lib/runtime-safety";
import { isVerified } from "@/lib/verification-bypass";
import { isMarketplacePhoneVerificationExempt } from "@/lib/phone-verification-exemptions";
import { phoneVerificationDestinationForPage } from "@/lib/phone-verification-page";

function isExplicitlyEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Phone verification is opt-in. Email verification remains the only account
 * verification requirement unless an operator deliberately enables this
 * feature in a reviewed deployment.
 */
export function isMarketplacePhoneVerificationEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (isMarketplacePhoneVerificationDisabled(env)) return false;
  return isExplicitlyEnabled(env.ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED);
}

export function isMarketplacePhoneVerificationDisabled(env: NodeJS.ProcessEnv = process.env) {
  return allowsTestOnlyRuntime() && env.ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION === "1";
}

/** Delivery can be tested before making verification mandatory. */
export function isMarketplacePhoneVerificationRequired(env: NodeJS.ProcessEnv = process.env) {
  return isMarketplacePhoneVerificationEnabled(env)
    && isExplicitlyEnabled(env.ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED);
}

type MarketplaceVerificationUser = {
  role: string;
  roles?: string[];
  sellerStatus?: string;
  email?: string | null;
  verifiedPhone?: string | null;
  phoneVerifiedAt?: string | null;
};

export function needsMarketplacePhoneVerification(user: MarketplaceVerificationUser | null | undefined) {
  if (!user || !isMarketplacePhoneVerificationRequired()) return false;
  if (isMarketplacePhoneVerificationExempt(user)) return false;
  return !isVerified(user);
}

/** Uses canonical account data rather than an unsigned verification cookie. */
export function marketplacePhoneVerificationDestination(
  user: MarketplaceVerificationUser | null | undefined,
  pagePath: string,
  locale: "en" | "ar",
) {
  if (!user || !needsMarketplacePhoneVerification(user)) return null;
  return phoneVerificationDestinationForPage(user, pagePath, locale);
}
