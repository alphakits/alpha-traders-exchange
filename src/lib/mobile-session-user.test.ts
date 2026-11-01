import { describe, expect, it } from "vitest";
import { toMobileSessionUser } from "@/lib/mobile-session-user";
import { canUseSellerTools } from "../../apps/mobile/src/auth/seller-access";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const seller = {
  id: "approved-mobile-seller", email: "seller@example.test", fullName: "Seller",
  role: "approved_seller", roles: ["buyer", "approved_seller"],
  sellerStatus: "approved_seller", preferredLocale: "en", profilePhotoUrl: "",
  emailVerified: true,
} as AlphaExchangeUser;

describe("delivered mobile build approval compatibility", () => {
  it("retains access for an approved seller without manufacturing identity-review metadata", () => {
    const session = toMobileSessionUser(seller);
    expect(session.sellerApprovalVerified).toBe(true);
    expect(canUseSellerTools(session)).toBe(true);
    expect(session).not.toHaveProperty("sellerApprovalVerification");
    expect(seller.sellerApprovalVerification).toBeUndefined();
  });

  it.each(["buyer", "pending_seller_approval", "rejected", "suspended"] as const)(
    "denies delivered-client seller tools when canonical status is %s",
    (sellerStatus) => {
      const session = toMobileSessionUser({ ...seller, sellerStatus });
      expect(session.sellerApprovalVerified).toBe(false);
      expect(session.roles).not.toContain("approved_seller");
      expect(canUseSellerTools(session)).toBe(false);
    },
  );
});
