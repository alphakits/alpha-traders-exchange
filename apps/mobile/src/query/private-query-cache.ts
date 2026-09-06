const PRIVATE_QUERY_ROOTS = new Set([
  "mobile-notifications",
  "mobile-trade",
  "mobile-trades",
]);

export function isPrivateMobileQueryKey(queryKey: readonly unknown[]) {
  return PRIVATE_QUERY_ROOTS.has(String(queryKey[0] ?? ""));
}
