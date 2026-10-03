import { allowsTestOnlyRuntime, isProductionSecurityRuntime } from "@/lib/runtime-safety";
import { isVerified } from "@/lib/verification-bypass";
import { phoneVerificationDestinationForPage } from "@/lib/phone-verification-page";

function isExplicitlyEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

/**
 * Every production exchange participant must verify their phone. Feature
 * switches are retained only for isolated local development and test fixtures.
 */
export function isMarketplacePhoneVerificationEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (isProductionSecurityRuntime()) return true;
  if (isMarketplacePhoneVerificationDisabled(env)) return false;
  return isExplicitlyEnabled(env.ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED);
}

export function isMarketplacePhoneVerificationDisabled(env: NodeJS.ProcessEnv = process.env) {
  return allowsTestOnlyRuntime() && env.ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION === "1";
}

/** Production access fails closed regardless of delivery configuration. */
export function isMarketplacePhoneVerificationRequired(env: NodeJS.ProcessEnv = process.env) {
  if (isProductionSecurityRuntime()) return true;
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
