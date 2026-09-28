// Shared by the request gate and the client boundary. These pages contain
// account state; a cookie's presence alone does not authorize their contents.
export const APP_PAGE_PATH_HEADER = "x-alpha-page-path";

export function isProtectedPage(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0].replace(/^\/(?:ar|en)(?=\/|$)/i, "");
  return /^\/(?:academy|lessons|prop-firms|news|usdt-exchange|trade-room|trades|dashboard|profile|settings|admin|notifications|onboarding|verify-account)(?:\/|$)/i.test(path);
}

export function isExchangePage(path: string) {
  return /^\/(?:ar\/|en\/)?usdt-exchange(?:[/?#]|$)/i.test(path) && !path.includes("\\");
}

export function getSignedOutPageDestination(path: string) {
  const locale = /^\/ar(?=\/|[?#]|$)/i.test(path) ? "ar" : "en";
  // A protected link still represents the visitor's intended destination.
  // Keep its language and view through sign-in at every access boundary.
  if (!isProtectedPage(path) || path.includes("\\")) return `/${locale}`;
  return `/${locale}/login?redirectTo=${encodeURIComponent(path)}`;
}
