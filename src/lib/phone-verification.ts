import { allowsTestOnlyRuntime } from "@/lib/runtime-safety";

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
