import { describe, expect, it } from "vitest";
import {
  COMPLETE_SELLER_APPROVAL_CHECKLIST,
  createSellerApprovalVerification,
  hasSellerOperationalAccess,
  isSellerApprovalChecklistComplete,
  isSellerApprovalVerificationComplete,
  normalizeSellerApprovalVerification,
} from "@/lib/seller-approval-verification";

const verification = {
  method: "manual_authorized_reviewer_v1" as const,
  ...COMPLETE_SELLER_APPROVAL_CHECKLIST,
  verifiedAt: "2026-09-19T20:00:00.000Z",
  verifiedByUserId: "owner-1",
};

describe("optional historical identity metadata and seller access", () => {
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

  it("fails closed for malformed, missing, or unverifiable approval metadata", () => {
    expect(isSellerApprovalVerificationComplete(verification)).toBe(true);
    expect(normalizeSellerApprovalVerification(verification)).toEqual(verification);
    expect(isSellerApprovalVerificationComplete({
      ...verification,
      verifiedAt: "not-a-date",
    })).toBe(false);
    expect(isSellerApprovalVerificationComplete({
      ...verification,
      verifiedByUserId: "",
    })).toBe(false);
    expect(normalizeSellerApprovalVerification(undefined)).toBeUndefined();
  });

  it("allows owner-approved sellers without an extra record and retains admin access", () => {
    expect(hasSellerOperationalAccess({
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      sellerApprovalVerification: verification,
    })).toBe(true);
    expect(hasSellerOperationalAccess({
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
    })).toBe(true);
    expect(hasSellerOperationalAccess({
      role: "owner",
      roles: ["owner", "admin"],
      sellerStatus: "buyer",
    })).toBe(true);
  });

  it.each(["buyer", "pending_seller_approval", "rejected", "suspended"] as const)(
    "denies seller operations for %s even with a historical verification record",
    (sellerStatus) => {
      expect(hasSellerOperationalAccess({
        role: "approved_seller",
        roles: ["buyer", "approved_seller"],
        sellerStatus,
        sellerApprovalVerification: verification,
      })).toBe(false);
    },
  );

  it("rejects an incomplete attestation", () => {
    expect(() => createSellerApprovalVerification({
      ...COMPLETE_SELLER_APPROVAL_CHECKLIST,
      identityDocumentReviewed: false,
    }, "owner-1", "2026-09-19T20:00:00.000Z")).toThrow(
      "Seller identity verification checklist is incomplete.",
    );
  });
});
