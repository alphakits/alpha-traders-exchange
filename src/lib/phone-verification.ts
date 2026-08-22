import { allowsTestOnlyRuntime } from "@/lib/runtime-safety";

export function isMarketplacePhoneVerificationDisabled() {
  return allowsTestOnlyRuntime() && process.env.ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION === "1";
}

export function isMarketplacePhoneVerificationEnabled() {
  return !isMarketplacePhoneVerificationDisabled();
}
