export function createE2eSellerApprovalVerification(
  verifiedAt = new Date().toISOString(),
  verifiedByUserId = "e2e-authorized-reviewer",
) {
  return {
    method: "manual_authorized_reviewer_v1" as const,
    identityDocumentReviewed: true,
    liveIdentityVideoReviewed: true,
    contactOwnershipConfirmed: true,
    marketplaceRulesAccepted: true,
    verifiedAt,
    verifiedByUserId,
  } as const;
}
