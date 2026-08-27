import { describe, expect, it } from "vitest";
import { toAdminSellerSummary, toAdminUserSummary, toClientSessionUser } from "@/lib/client-session-user";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

describe("toClientSessionUser", () => {
  it("runtime-allowlists the client session and excludes present and future persistence-only fields", () => {
    const user = {
      id: "user-1", fullName: "Buyer", email: "buyer@example.test", passwordHash: "secret-password-hash", whatsappNumber: "+972500000000",
      preferredNetworks: ["TRC20"], profilePhotoUrl: "/profile.png", languages: ["English"], preferredLocale: "en", bio: "Bio", onlineStatus: "offline", availabilityStatus: "available",
      role: "buyer", sellerStatus: "buyer", createdAt: "2026-01-01", updatedAt: "2026-01-01", phoneOtpHash: "secret-otp-hash", phoneOtpSalt: "secret-otp-salt",
      phoneOtpPhone: "+972511111111", phoneOtpExpiresAt: "2026-02-01", phoneOtpAttempts: 2, verifiedPhone: "+972522222222", phoneVerifiedAt: "2026-01-02",
      emailVerificationTokenHash: "secret-email-token-hash", emailVerificationTokenExpiresAt: "2026-02-01", emailVerificationSentAt: "2026-01-01",
      sellerBankAccounts: [{ accountNumber: "secret-account-number", id: "bank-1" }], ownerSettings: { future: "secret-owner-setting" },
      notificationPreferences: { inApp: true, email: false, sms: false, browserPushSubscriptionHash: "secret-browser-push-subscription-hash" },
      passwordResetTokenHash: "future-password-reset-secret", futureSecret: "future-secret-value",
    } as unknown as AlphaExchangeUser;

    const clientUser = toClientSessionUser(user) as Record<string, unknown>;
    const serialized = JSON.stringify(clientUser);

    expect(clientUser).toMatchObject({
      id: "user-1",
      fullName: "Buyer",
      email: "buyer@example.test",
      role: "buyer",
      sellerStatus: "buyer",
      preferredNetworks: ["TRC20"],
      preferredLocale: "en",
      emailVerified: false,
    });
    for (const key of [
      "passwordHash", "passwordResetTokenHash", "phoneOtpHash", "phoneOtpSalt", "phoneOtpPhone", "phoneOtpExpiresAt", "phoneOtpAttempts",
      "emailVerificationTokenHash", "emailVerificationTokenExpiresAt", "emailVerificationSentAt", "sellerBankAccounts", "verifiedPhone", "phoneVerifiedAt",
      "ownerSettings", "notificationPreferences", "futureSecret",
    ]) {
      expect(clientUser).not.toHaveProperty(key);
    }
    for (const value of [
      "secret-password-hash", "future-password-reset-secret", "secret-otp-hash", "secret-otp-salt", "+972511111111", "+972522222222",
      "secret-email-token-hash", "secret-account-number", "secret-owner-setting", "secret-browser-push-subscription-hash", "future-secret-value",
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(clientUser.isPhotoVerified).toBe(true);
  });

  it("runtime-allowlists the admin dashboard user summary", () => {
    const user = {
      id: "admin-user", fullName: "Admin User", email: "admin@example.test", passwordHash: "secret-password-hash", whatsappNumber: "+972500000000",
      preferredNetworks: [], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "offline", availabilityStatus: "available",
      role: "admin", roles: ["admin"], sellerStatus: "buyer", createdAt: "2026-01-01", updatedAt: "2026-01-01",
      phoneOtpHash: "secret-otp-hash", emailVerificationTokenHash: "secret-email-token-hash", verifiedPhone: "+972522222222",
      sellerBankAccounts: [{ accountNumber: "secret-account-number", id: "bank-1" }], futureSecret: "future-secret-value",
    } as unknown as AlphaExchangeUser;

    const summary = toAdminUserSummary(user) as Record<string, unknown>;
    expect(summary).toEqual({
      id: "admin-user",
      fullName: "Admin User",
      email: "admin@example.test",
      role: "admin",
      roles: ["admin"],
      disabled: false,
      createdAt: "2026-01-01",
    });
    expect(JSON.stringify(summary)).not.toContain("secret-");
    expect(summary).not.toHaveProperty("verifiedPhone");
    expect(summary).not.toHaveProperty("sellerBankAccounts");
  });

  it("runtime-allowlists admin seller-management records", () => {
    const user = {
      id: "seller-1", fullName: "Seller User", email: "seller@example.test", passwordHash: "secret-password-hash", whatsappNumber: "+972500000000",
      preferredNetworks: ["TRC20"], profilePhotoUrl: "", languages: [], bio: "", onlineStatus: "online", availabilityStatus: "available",
      role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller", createdAt: "2026-01-01", updatedAt: "2026-01-02",
      lifetimeCompletedVolumeUsdt: 2500, sellerPrestigeRank: "gold", sellerRankOverride: { rank: "gold", reason: "Manual review", setAt: "2026-01-02", setByUserId: "admin-1" },
      phoneOtpHash: "secret-otp-hash", phoneOtpSalt: "secret-otp-salt", verifiedPhone: "+972522222222", phoneVerifiedAt: "2026-01-02",
      emailVerificationTokenHash: "secret-email-token-hash", sellerBankAccounts: [{ accountNumber: "secret-account-number", id: "bank-1" }],
      notificationPreferences: { inApp: true, email: false, sms: false, browserPushSubscriptionHash: "secret-browser-push-subscription-hash" },
      ownerSettings: { future: "secret-owner-setting" }, futureSecret: "future-secret-value",
    } as unknown as AlphaExchangeUser;

    const summary = toAdminSellerSummary(user) as Record<string, unknown>;
    const serialized = JSON.stringify(summary);

    expect(summary).toMatchObject({
      id: "seller-1",
      fullName: "Seller User",
      email: "seller@example.test",
      whatsappNumber: "+972500000000",
      role: "approved_seller",
      roles: ["buyer", "approved_seller"],
      sellerStatus: "approved_seller",
      availabilityStatus: "available",
      sellerPrestigeRank: "gold",
    });
    for (const key of [
      "passwordHash", "phoneOtpHash", "phoneOtpSalt", "verifiedPhone", "phoneVerifiedAt", "emailVerificationTokenHash",
      "sellerBankAccounts", "notificationPreferences", "ownerSettings", "futureSecret",
    ]) {
      expect(summary).not.toHaveProperty(key);
    }
    for (const value of [
      "secret-password-hash", "secret-otp-hash", "secret-otp-salt", "+972522222222", "secret-email-token-hash",
      "secret-account-number", "secret-browser-push-subscription-hash", "secret-owner-setting", "future-secret-value",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });
});
