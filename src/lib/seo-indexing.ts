/** Search metadata only. Authentication and authorization remain server-enforced. */
export const PRIVATE_SEARCH_ROUTE_NAMES = [
  "admin", "academy", "dashboard", "lessons", "profile", "settings",
  "notifications", "trade-room", "trades", "usdt-exchange", "seller",
  "onboarding", "login", "register", "verify-account", "verify-email",
  "forgot-password", "reset-password",
] as const;

/** Match route segments, not lookalike public slugs such as /seller-disclaimer. */
export function isPrivateSearchPath(path: string): boolean {
  const segments = path.split(/[?#]/, 1)[0].split("/").filter(Boolean);
  if (segments[0] === "en" || segments[0] === "ar") segments.shift();
  const first = segments[0];
  return first === "api" || PRIVATE_SEARCH_ROUTE_NAMES.some((route) => route === first);
}
