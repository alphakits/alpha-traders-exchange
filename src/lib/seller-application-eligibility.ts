import { hasRole } from "@/lib/roles";
import type { AlphaExchangeUser, SellerApplication } from "@/types/alpha-exchange";

export type SellerApplicationEligibility = "loading" | "retry" | "buyer_setup_required" | "application_pending" | "approved_seller" | "application_available";

export function getSellerApplicationEligibility(input: {
  isCanonicalUserLoading: boolean;
  canonicalUserError: boolean;
  canonicalUser: Pick<AlphaExchangeUser, "role" | "roles" | "sellerStatus"> | null;
  application: Pick<SellerApplication, "status"> | null;
  applicationSubmitted: boolean;
}): SellerApplicationEligibility {
  if (input.isCanonicalUserLoading) return "loading";
  if (input.canonicalUserError || !input.canonicalUser) return "retry";
  if (hasRole(input.canonicalUser, "approved_seller")) return "approved_seller";
  if (!hasRole(input.canonicalUser, "buyer")) return "buyer_setup_required";
  if (input.application?.status === "pending" || input.applicationSubmitted) return "application_pending";
  return "application_available";
}
