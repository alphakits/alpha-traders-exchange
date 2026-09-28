import { describe, expect, it } from "vitest";
import { getApprovedSellersForAdmin, getAllSellerApplicationsForAdmin } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
import { createTestSellerApprovalVerification } from "@/test-utils/seller-verification";
import { publicAccountId } from "@/lib/public-account-identity";

function sensitiveSeller(): AlphaExchangeUser {
  return {
    id: "seller-1",
    fullName: "Seller User",
    email: "seller@example.test",
    passwordHash: "secret-password-hash",
    whatsappNumber: "+972500000000",
    preferredNetworks: ["TRC20"],
    profilePhotoUrl: "",
    languages: [],
    bio: "",
    onlineStatus: "online",
    availabilityStatus: "available",
    role: "approved_seller",
    roles: ["buyer", "approved_seller"],
    sellerStatus: "approved_seller",
    sellerApprovalVerification: createTestSellerApprovalVerification(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    phoneOtpHash: "secret-otp-hash",
    phoneOtpSalt: "secret-otp-salt",
    verifiedPhone: "+972522222222",
    phoneVerifiedAt: "2026-01-02T00:00:00.000Z",
    emailVerificationTokenHash: "secret-email-token-hash",
    sellerBankAccounts: [{
      id: "bank-1", sellerId: "seller-1", accountHolderName: "Seller User", bankName: "Bank", branchNumber: "12",
      accountNumber: "secret-account-number", accountLast4: "3456", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    notificationPreferences: {
      inApp: true,
      email: false,
      sms: false,
      browserPushSubscriptionHash: "secret-browser-push-subscription-hash",
    },
    ownerSettings: { future: "secret-owner-setting" },
  };
}

describe("getApprovedSellersForAdmin privacy boundary", () => {
  it("projects current application names beside AT IDs only for a server-resolved owner", async () => {
    const db = { users: [sensitiveSeller(), { id: "owner", role: "owner" }, { id: "admin", role: "admin" }],
      sellerApplications: [{ id: "application", userId: "seller-1", fullName: "Old Private Name" }] } as unknown as AlphaExchangeDb;
    expect((await getAllSellerApplicationsForAdmin(db, "owner"))[0].fullName).toBe(`${publicAccountId({ id: "seller-1" })} (Seller User)`);
    for (const viewer of [undefined, "admin", "seller-1", "missing"]) {
      expect((await getAllSellerApplicationsForAdmin(db, viewer))[0].fullName).toBe(publicAccountId({ id: "seller-1" }));
    }
    expect(db.sellerApplications[0].fullName).toBe("Old Private Name");
  });
  it("returns allowlisted seller summaries rather than raw persisted users", async () => {
    const db = { users: [sensitiveSeller(), { id: "owner", role: "owner", fullName: "Owner" }] } as unknown as AlphaExchangeDb;
    const sellers = await getApprovedSellersForAdmin(db, "owner");
    expect((await getApprovedSellersForAdmin(db))[0]).toMatchObject({ email: "", whatsappNumber: "" });
    const seller = sellers[0] as Record<string, unknown>;
    const serialized = JSON.stringify(seller);

    expect(seller).toMatchObject({
      id: "seller-1",
      fullName: `${publicAccountId({ id: "seller-1" })} (Seller User)`,
      role: "approved_seller",
      sellerStatus: "approved_seller",
      sellerPrestigeRank: undefined,
    });
    for (const key of [
      "passwordHash", "phoneOtpHash", "phoneOtpSalt", "verifiedPhone", "phoneVerifiedAt", "emailVerificationTokenHash",
      "sellerBankAccounts", "notificationPreferences", "ownerSettings",
    ]) {
      expect(seller).not.toHaveProperty(key);
    }
    for (const value of [
      "secret-password-hash", "secret-otp-hash", "secret-otp-salt", "+972522222222", "secret-email-token-hash",
      "secret-account-number", "secret-browser-push-subscription-hash", "secret-owner-setting",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });
});
