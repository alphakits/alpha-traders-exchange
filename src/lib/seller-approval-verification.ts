import type {
  SellerApprovalVerification,
  SellerStatus,
  UserRole,
} from "@/types/alpha-exchange";

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

export function isSellerApprovalVerificationComplete(value: unknown): value is SellerApprovalVerification {
  if (!isSellerApprovalChecklistComplete(value)) return false;
  const verification = value as Partial<SellerApprovalVerification>;
  return verification.method === "manual_authorized_reviewer_v1"
    && typeof verification.verifiedAt === "string"
    && verification.verifiedAt.trim().length > 0
    && Number.isFinite(new Date(verification.verifiedAt).getTime())
    && typeof verification.verifiedByUserId === "string"
    && verification.verifiedByUserId.trim().length > 0;
}

export function normalizeSellerApprovalVerification(value: unknown): SellerApprovalVerification | undefined {
  if (!isSellerApprovalVerificationComplete(value)) return undefined;
  return {
    method: "manual_authorized_reviewer_v1",
    ...COMPLETE_SELLER_APPROVAL_CHECKLIST,
    verifiedAt: value.verifiedAt.trim(),
    verifiedByUserId: value.verifiedByUserId.trim(),
  };
}

export function hasSellerOperationalAccess(user: {
  role: UserRole;
  roles?: UserRole[];
  sellerStatus: SellerStatus;
  sellerApprovalVerification?: SellerApprovalVerification;
}) {
  const roles = user.roles ?? [user.role];
  if (user.role === "admin" || user.role === "owner" || roles.includes("admin") || roles.includes("owner")) {
    return true;
  }
  return user.sellerStatus === "approved_seller";
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
