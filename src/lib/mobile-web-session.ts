import type { MobileLocale } from "@alpha-traders/contracts";

const WEB_ORIGIN = "https://www.alphatraders.co.il";

export function resolveMobileWebSessionDestination(locale: MobileLocale, returnTo: string | null) {
  const fallback = `/${locale}`;
  if (!returnTo) return fallback;

  try {
    const parsed = new URL(returnTo, WEB_ORIGIN);
    if (parsed.origin !== WEB_ORIGIN) return fallback;
    if (parsed.pathname !== `/${locale}` && !parsed.pathname.startsWith(`/${locale}/`)) return fallback;
    if (parsed.pathname.startsWith(`/${locale}/api/`)) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
