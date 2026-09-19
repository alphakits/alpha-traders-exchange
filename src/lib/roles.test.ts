import { describe, expect, it } from "vitest";

import { hasRole, normalizeRolesForUser, resolvePrimaryRole } from "@/lib/roles";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";

describe("seller role authorization", () => {
  it("removes a legacy Approved Seller role when no attestation exists", () => {
    const roles = normalizeRolesForUser({
      email: "legacy@example.test",
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
    });

    expect(roles).toEqual(["buyer"]);
    expect(resolvePrimaryRole(roles)).toBe("buyer");
  });

  it("retains Approved Seller only with the complete recorded attestation", () => {
    const verification = createTestSellerApprovalVerification();
    const roles = normalizeRolesForUser({
      email: "verified@example.test",
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      sellerApprovalVerification: verification,
    });

    expect(roles).toEqual(["buyer", "approved_seller"]);
    expect(hasRole({
      role: "approved_seller",
      roles,
      sellerStatus: "approved_seller",
      sellerApprovalVerification: verification,
    }, "approved_seller")).toBe(true);
  });

  it("fails closed for old client projections without a verification result", () => {
    expect(hasRole({
      role: "approved_seller",
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
    }, "approved_seller")).toBe(false);
    expect(hasRole({
      role: "approved_seller",
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
      sellerApprovalVerified: true,
    }, "approved_seller")).toBe(true);
  });
});
