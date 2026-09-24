// Shared by the request gate and the client boundary. These pages contain
// account state; a cookie's presence alone does not authorize their contents.
export const APP_PAGE_PATH_HEADER = "x-alpha-page-path";

export function isProtectedPage(pathname: string) {
  const path = pathname.split(/[?#]/, 1)[0].replace(/^\/(?:ar|en)(?=\/|$)/i, "");
  return /^\/(?:academy|lessons|usdt-exchange|trade-room|trades|dashboard|profile|settings|admin|notifications|onboarding|verify-account)(?:\/|$)/i.test(path);
}

export function isExchangePage(path: string) {
  return /^\/(?:ar\/|en\/)?usdt-exchange(?:[/?#]|$)/i.test(path) && !path.includes("\\");
}

export function getSignedOutPageDestination(path: string) {
  // Exchange links are public entry points. Explain the sign-in requirement
  // and retain the requested marketplace view across every access boundary.
  if (!isExchangePage(path)) return "/en";
  const locale = /^\/ar\//i.test(path) ? "ar" : "en";
  return `/${locale}/login?redirectTo=${encodeURIComponent(path)}`;
}
