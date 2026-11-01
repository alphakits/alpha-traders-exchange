import { describe, expect, it } from "vitest";
import { hasRole, normalizeRolesForUser, resolvePrimaryRole } from "@/lib/roles";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";

describe("seller role authorization", () => {
  it("preserves owner-approved sellers without an additional identity record", () => {
    const user = {
      email: "approved@example.test",
      role: "approved_seller" as const,
      roles: ["buyer" as const, "approved_seller" as const],
      sellerStatus: "approved_seller" as const,
    };
    const roles = normalizeRolesForUser(user);
    expect(roles).toEqual(["buyer", "approved_seller"]);
    expect(resolvePrimaryRole(roles)).toBe("approved_seller");
    expect(hasRole(user, "approved_seller")).toBe(true);
    expect(hasRole({ ...user, sellerApprovalVerified: false }, "approved_seller")).toBe(true);
  });

  it.each(["buyer", "pending_seller_approval", "rejected", "suspended"] as const)(
    "denies stale approved roles and compatibility flags when status is %s",
    (sellerStatus) => {
      const user = {
        email: "stale@example.test",
        role: "approved_seller" as const,
        roles: ["buyer" as const, "approved_seller" as const],
        sellerStatus,
        sellerApprovalVerified: true,
        sellerApprovalVerification: createTestSellerApprovalVerification(),
      };
      expect(hasRole(user, "approved_seller")).toBe(false);
      expect(normalizeRolesForUser(user)).not.toContain("approved_seller");
    },
  );
});
