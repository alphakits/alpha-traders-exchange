// Shared by the request gate and the client boundary. These pages contain
// account state; a cookie's presence alone does not authorize their contents.
export const APP_PAGE_PATH_HEADER = "x-alpha-page-path";

export function isProtectedPage(pathname: string) {
  const path = pathname.replace(/^\/(?:ar|en)(?=\/|$)/i, "");
  return /^\/(?:academy|lessons|usdt-exchange|trade-room|trades|dashboard|profile|settings|admin|notifications|onboarding|verify-account)(?:\/|$)/i.test(path);
}
