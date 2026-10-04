import { hasRole } from "@/lib/roles";
import { getInterfaceAccess } from "@alpha-traders/contracts";
import type { AlphaExchangeUser, SellerApplication } from "@/types/alpha-exchange";

export type SellerApplicationEligibility = "loading" | "retry" | "buyer_setup_required" | "application_pending" | "approved_seller" | "application_available";

export function getSellerApplicationEligibility(input: {
  isCanonicalUserLoading: boolean;
  canonicalUserError: boolean;
  canonicalUser: (Pick<AlphaExchangeUser, "role" | "roles" | "sellerStatus">
    & Partial<Pick<AlphaExchangeUser, "sellerApprovalVerification">>
    & { sellerApprovalVerified?: boolean }) | null;
  application: Pick<SellerApplication, "status"> | null;
  applicationSubmitted: boolean;
}): SellerApplicationEligibility {
  if (input.isCanonicalUserLoading) return "loading";
  if (input.canonicalUserError || !input.canonicalUser) return "retry";
  if (hasRole(input.canonicalUser, "approved_seller")) return "approved_seller";
  const access = getInterfaceAccess(input.canonicalUser);
  if (access.pendingSeller || input.application?.status === "pending" || input.applicationSubmitted) return "application_pending";
  if (!access.buyer) return "buyer_setup_required";
  return "application_available";
}
