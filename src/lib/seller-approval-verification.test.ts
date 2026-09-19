import { describe, expect, it } from "vitest";
import {
  COMPLETE_SELLER_APPROVAL_CHECKLIST,
  createSellerApprovalVerification,
  isSellerApprovalChecklistComplete,
} from "@/lib/seller-approval-verification";

describe("approved-seller identity verification gate", () => {
  it("accepts only the complete four-part manual verification checklist", () => {
    expect(isSellerApprovalChecklistComplete(COMPLETE_SELLER_APPROVAL_CHECKLIST)).toBe(true);
    expect(isSellerApprovalChecklistComplete({
      ...COMPLETE_SELLER_APPROVAL_CHECKLIST,
      liveIdentityVideoReviewed: false,
    })).toBe(false);
    expect(isSellerApprovalChecklistComplete(null)).toBe(false);
  });

  it("creates server-owned verification metadata without raw identity material", () => {
    expect(createSellerApprovalVerification(
      COMPLETE_SELLER_APPROVAL_CHECKLIST,
      "owner-1",
      "2026-09-19T20:00:00.000Z",
    )).toEqual({
      method: "manual_authorized_reviewer_v1",
      ...COMPLETE_SELLER_APPROVAL_CHECKLIST,
      verifiedAt: "2026-09-19T20:00:00.000Z",
      verifiedByUserId: "owner-1",
    });
  });

  it("rejects an incomplete attestation", () => {
    expect(() => createSellerApprovalVerification({
      ...COMPLETE_SELLER_APPROVAL_CHECKLIST,
      identityDocumentReviewed: false,
    }, "owner-1", "2026-09-19T20:00:00.000Z")).toThrow(
      "Seller identity verification checklist is incomplete.",
    );
  });
});
