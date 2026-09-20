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
  it("fails closed for an approved seller without a recorded attestation", () => {
    expect(canUseSellerTools(user({
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      sellerApprovalVerified: false,
    }))).toBe(false);
  });

  it("allows attested sellers and explicit admin/owner roles", () => {
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
