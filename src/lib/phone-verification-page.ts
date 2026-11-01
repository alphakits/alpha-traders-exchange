type MarketplacePageUser = {
  role: string;
  roles?: string[];
  sellerStatus?: string;
};

/** Shared routing policy; callers independently establish the verification requirement. */
export function phoneVerificationDestinationForPage(
  user: MarketplacePageUser,
  pagePath: string,
  locale: "en" | "ar",
) {
  if (!pagePath.startsWith("/") || pagePath.startsWith("//") || pagePath.includes("\\")) return null;
  const path = pagePath.split(/[?#]/, 1)[0].replace(/^\/(?:ar|en)(?=\/|$)/i, "");
  // Verification, recovery, support, and legal pages must remain reachable.
  if (/^\/(?:verify-account|verify-email|login|register|forgot-password|reset-password|auth|account-deletion|support|help-center|privacy-policy|terms|cookies|contact|safety-trust|report-abuse)(?:\/|$)/i.test(path)) return null;
  const roles = [user.role, ...(user.roles ?? [])];
  const participant = roles.some(role => ["buyer", "approved_seller", "pending_seller_approval", "admin", "owner"].includes(role))
    || ["approved_seller", "pending_seller_approval", "suspended"].includes(user.sellerStatus ?? "");
  const exchangePage = /^\/(?:usdt-exchange|trade-room|trades|dashboard\/(?:buyer|seller))(?:\/|$)/i.test(path);
  if (!participant && !exchangePage) return null;
  return `/${locale}/verify-account?redirectTo=${encodeURIComponent(pagePath)}`;
}
