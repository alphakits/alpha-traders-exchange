import { allowsTestOnlyRuntime } from "@/lib/runtime-safety";
import { isVerified } from "@/lib/verification-bypass";

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
  const roles = [user.role, ...(user.roles ?? [])];
  if (roles.includes("owner") || roles.includes("admin")) return false;
  return !isVerified(user);
}

/** Uses canonical account data rather than an unsigned verification cookie. */
export function marketplacePhoneVerificationDestination(
  user: MarketplaceVerificationUser | null | undefined,
  pagePath: string,
  locale: "en" | "ar",
) {
  if (!user || !needsMarketplacePhoneVerification(user) || !pagePath.startsWith("/") || pagePath.includes("\\")) return null;
  const path = pagePath.split(/[?#]/, 1)[0].replace(/^\/(?:ar|en)(?=\/|$)/, "");
  // Keep verification, recovery, sign-out support, and legal pages reachable.
  if (/^\/(?:verify-account|verify-email|login|register|forgot-password|reset-password|auth|account-deletion|support|help-center|privacy-policy|terms|contact|safety-trust|report-abuse)(?:\/|$)/.test(path)) return null;
  const roles = [user.role, ...(user.roles ?? [])];
  const participant = roles.some(role => ["buyer", "approved_seller", "pending_seller_approval"].includes(role))
    || ["approved_seller", "pending_seller_approval", "suspended"].includes(user.sellerStatus ?? "");
  const exchangePage = /^\/(?:usdt-exchange|trade-room|trades|dashboard\/(?:buyer|seller))(?:\/|$)/.test(path);
  if (!participant && !exchangePage) return null;
  return `/${locale}/verify-account?redirectTo=${encodeURIComponent(pagePath)}`;
}
