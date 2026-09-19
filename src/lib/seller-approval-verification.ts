import type { SellerApprovalVerification } from "@/types/alpha-exchange";

export type SellerApprovalChecklist = Pick<
  SellerApprovalVerification,
  | "identityDocumentReviewed"
  | "liveIdentityVideoReviewed"
  | "contactOwnershipConfirmed"
  | "marketplaceRulesAccepted"
>;

export const COMPLETE_SELLER_APPROVAL_CHECKLIST: SellerApprovalChecklist = {
  identityDocumentReviewed: true,
  liveIdentityVideoReviewed: true,
  contactOwnershipConfirmed: true,
  marketplaceRulesAccepted: true,
};

export function isSellerApprovalChecklistComplete(value: unknown): value is SellerApprovalChecklist {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const checklist = value as Partial<Record<keyof SellerApprovalChecklist, unknown>>;
  return checklist.identityDocumentReviewed === true
    && checklist.liveIdentityVideoReviewed === true
    && checklist.contactOwnershipConfirmed === true
    && checklist.marketplaceRulesAccepted === true;
}

export function createSellerApprovalVerification(
  checklist: unknown,
  verifiedByUserId: string,
  verifiedAt: string,
): SellerApprovalVerification {
  if (!isSellerApprovalChecklistComplete(checklist)) {
    throw new Error("Seller identity verification checklist is incomplete.");
  }
  return {
    method: "manual_authorized_reviewer_v1",
    ...COMPLETE_SELLER_APPROVAL_CHECKLIST,
    verifiedAt,
    verifiedByUserId,
  };
}
