const PRIVATE_QUERY_ROOTS = new Set([
  "mobile-academy",
  "mobile-academy-lesson",
  "mobile-notifications",
  "mobile-seller-listings",
  "mobile-trade",
  "mobile-trades",
]);

const OPTIONAL_SESSION_QUERY_ROOTS = new Set([
  "mobile-marketplace",
  "mobile-marketplace-listing",
  "mobile-seller-profile",
]);

export function isPrivateMobileQueryKey(queryKey: readonly unknown[]) {
  const root = String(queryKey[0] ?? "");
  if (PRIVATE_QUERY_ROOTS.has(root)) return true;
  return OPTIONAL_SESSION_QUERY_ROOTS.has(root) && queryKey[1] !== "public";
}
