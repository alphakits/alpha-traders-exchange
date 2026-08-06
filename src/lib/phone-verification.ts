export function isMarketplacePhoneVerificationDisabled() {
  return process.env.ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION === "1";
}

export function isMarketplacePhoneVerificationEnabled() {
  return !isMarketplacePhoneVerificationDisabled();
}
