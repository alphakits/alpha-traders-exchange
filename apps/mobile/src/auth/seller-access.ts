import type { MobileSessionUser } from "@alpha-traders/contracts";

export function canUseSellerTools(user: MobileSessionUser | null | undefined) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "owner" || user.roles.some((role) => role === "admin" || role === "owner")) {
    return true;
  }
  return user.sellerStatus === "approved_seller" && user.sellerApprovalVerified === true;
}
