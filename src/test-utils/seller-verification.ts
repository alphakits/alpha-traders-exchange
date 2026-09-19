import type { SellerApprovalVerification } from "@/types/alpha-exchange";

export function createTestSellerApprovalVerification(
  verifiedAt = "2026-01-01T00:00:00.000Z",
  verifiedByUserId = "test-authorized-reviewer",
): SellerApprovalVerification {
  return {
    method: "manual_authorized_reviewer_v1",
    identityDocumentReviewed: true,
    liveIdentityVideoReviewed: true,
    contactOwnershipConfirmed: true,
    marketplaceRulesAccepted: true,
    verifiedAt,
    verifiedByUserId,
  };
}
