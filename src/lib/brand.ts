export const BRAND_NAME = "Alpha Traders Academy & Exchange";
export const BRAND_NAME_HTML = "Alpha Traders Academy &amp; Exchange";

export function getBrandedEmailFrom(configuredFrom: string) {
  const trimmed = configuredFrom.trim();
  if (!trimmed) return "";

  const address = trimmed.match(/<([^<>]+)>$/)?.[1]?.trim();
  return address ? `${BRAND_NAME} <${address}>` : trimmed;
}
