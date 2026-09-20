import { describe, expect, it } from "vitest";
import type { MobileSessionUser } from "@alpha-traders/contracts";
import { canUseSellerTools } from "./seller-access";

function user(overrides: Partial<MobileSessionUser>): MobileSessionUser {
  return {
    id: "user-1",
    fullName: "Test User",
    email: "test@example.test",
    role: "buyer",
    roles: ["buyer"],
    sellerStatus: "buyer",
    sellerApprovalVerified: false,
    preferredLocale: "en",
    profilePhotoUrl: "",
    emailVerified: true,
    isFoundingMember: false,
    isFoundingSeller: false,
    ...overrides,
  };
}

describe("mobile seller access", () => {
  it("allows an owner-approved seller without an additional verification record", () => {
    expect(canUseSellerTools(user({
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      sellerApprovalVerified: false,
    }))).toBe(true);
  });

  it.each(["buyer", "pending_seller_approval", "rejected", "suspended"] as const)(
    "denies seller tools for %s despite stale roles or a compatibility flag",
    (sellerStatus) => {
      expect(canUseSellerTools(user({
        role: "approved_seller",
        roles: ["approved_seller"],
        sellerStatus,
        sellerApprovalVerified: true,
      }))).toBe(false);
    },
  );

  it("allows approved sellers and explicit admin/owner roles", () => {
    expect(canUseSellerTools(user({
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      sellerApprovalVerified: true,
    }))).toBe(true);
    expect(canUseSellerTools(user({ role: "admin", roles: ["admin"] }))).toBe(true);
    expect(canUseSellerTools(user({ role: "owner", roles: ["owner"] }))).toBe(true);
  });
});
