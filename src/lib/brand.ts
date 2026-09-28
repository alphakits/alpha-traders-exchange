export const BRAND_NAME = "Alpha Traders Academy & Exchange";
export const BRAND_NAME_HTML = "Alpha Traders Academy &amp; Exchange";
export const BRAND_PRIMARY_NAME = "Alpha Traders";
export const BRAND_DESCRIPTOR = "Academy & Exchange";
export const BRAND_DESCRIPTOR_AR = "الأكاديمية والسوق";
export const BRAND_SUPPORT_EMAIL = "support@alphatraders.co.il";
export const BRAND_EMAIL_LOGO_CID = "alpha-traders-logo";
export const BRAND_EMAIL_LOGO_SRC = `cid:${BRAND_EMAIL_LOGO_CID}`;
export const BRAND_EMAIL_LOGO_URL =
  "https://www.alphatraders.co.il/images/brand/alpha-traders-logo-192.png?v=c73f7405";
export const BRAND_BIMI_SELECTOR = "v=BIMI1; s=default;";
export const BRAND_OFFICIAL_SOCIALS = [
  "https://www.instagram.com/mark_jozen/",
  "https://www.tiktok.com/@mark_jozen",
] as const;

export function buildBrandedEmailHeaders() {
  return {
    "BIMI-Selector": BRAND_BIMI_SELECTOR,
  };
}

export function buildBrandedEmailLogoAttachment() {
  return {
    path: BRAND_EMAIL_LOGO_URL,
    filename: "alpha-traders-logo.png",
    content_id: BRAND_EMAIL_LOGO_CID,
  };
}

export function getBrandedEmailFrom(configuredFrom: string) {
  const trimmed = configuredFrom.trim();
  if (!trimmed) return "";

  const address = trimmed.match(/<([^<>]+)>$/)?.[1]?.trim();
  return address ? `${BRAND_NAME} <${address}>` : trimmed;
}
