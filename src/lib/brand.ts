export const BRAND_NAME = "Alpha Traders Academy & Exchange";
export const BRAND_NAME_HTML = "Alpha Traders Academy &amp; Exchange";
export const BRAND_PRIMARY_NAME = "Alpha Traders";
export const BRAND_DESCRIPTOR = "Academy & Exchange";
export const BRAND_DESCRIPTOR_AR = "الأكاديمية والسوق";
export const BRAND_SUPPORT_EMAIL = "support@alphatraders.co.il";
export const BRAND_OFFICIAL_SOCIALS = [
  "https://www.instagram.com/mark_jozen/",
  "https://www.tiktok.com/@mark_jozen",
] as const;

export function getBrandedEmailFrom(configuredFrom: string) {
  const trimmed = configuredFrom.trim();
  if (!trimmed) return "";

  const address = trimmed.match(/<([^<>]+)>$/)?.[1]?.trim();
  return address ? `${BRAND_NAME} <${address}>` : trimmed;
}
