import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  clearUserSession: vi.fn(),
  cookies: vi.fn(),
  expireAuthCookies: vi.fn(),
  getCurrentSessionToken: vi.fn(),
  getCurrentSessionUser: vi.fn(),
  isMarketplacePhoneVerificationDisabled: vi.fn(),
  isVerified: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  AUTH_PHONE_VERIFIED_COOKIE_NAME: "alpha_exchange_phone_verified",
  clearUserSession: mocks.clearUserSession,
  expireAuthCookies: mocks.expireAuthCookies,
  getCurrentSessionToken: mocks.getCurrentSessionToken,
  getCurrentSessionUser: mocks.getCurrentSessionUser,
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/phone-verification", () => ({ isMarketplacePhoneVerificationDisabled: mocks.isMarketplacePhoneVerificationDisabled }));
vi.mock("@/lib/verification-bypass", () => ({
  isVerified: mocks.isVerified,
}));

import { GET } from "@/app/api/auth/me/route";

function rawUser(): AlphaExchangeUser {
  return {
    id: "user-1",
    fullName: "Buyer User",
    email: "buyer@example.test",
    passwordHash: "secret-password-hash",
    whatsappNumber: "+972500000000",
    preferredNetworks: ["TRC20"],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    onlineStatus: "offline",
    availabilityStatus: "available",
    role: "buyer",
    sellerStatus: "buyer",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    emailVerified: true,
    emailVerificationTokenHash: "secret-email-token-hash",
    verifiedPhone: "+972522222222",
    phoneVerifiedAt: "2026-01-02T00:00:00.000Z",
    phoneOtpHash: "secret-otp-hash",
    phoneOtpSalt: "secret-otp-salt",
    phoneOtpPhone: "+972511111111",
    sellerBankAccounts: [{
      id: "bank-1",
      sellerId: "user-1",
      accountHolderName: "Buyer User",
      bankName: "Bank",
      branchNumber: "12",
      accountNumber: "secret-account-number",
      accountLast4: "3456",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }],
    notificationPreferences: {
      inApp: true,
      email: false,
      sms: false,
      browserPushSubscriptionHash: "secret-browser-push-subscription-hash",
    },
  };
}

describe("GET /api/auth/me session privacy", () => {
  beforeEach(() => {
    mocks.clearUserSession.mockReset();
    mocks.cookies.mockReset();
    mocks.expireAuthCookies.mockReset();
    mocks.getCurrentSessionToken.mockReset();
    mocks.getCurrentSessionUser.mockReset();
    mocks.isMarketplacePhoneVerificationDisabled.mockReset();
    mocks.isVerified.mockReset();

    mocks.cookies.mockResolvedValue({ set: vi.fn() });
    mocks.getCurrentSessionToken.mockResolvedValue(null);
    mocks.isMarketplacePhoneVerificationDisabled.mockReturnValue(false);
    mocks.isVerified.mockReturnValue(true);
  });

  it("returns the shared safe session DTO rather than persistence-only credential fields", async () => {
    mocks.getCurrentSessionUser.mockResolvedValue(rawUser());

    const response = await GET();
    const payload = await response.json() as { user: Record<string, unknown> | null };
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.user).toMatchObject({
      id: "user-1",
      fullName: "Buyer User",
      email: "buyer@example.test",
      role: "buyer",
      sellerStatus: "buyer",
      emailVerified: true,
      isPhotoVerified: true,
    });
    for (const key of [
      "passwordHash", "emailVerificationTokenHash", "verifiedPhone", "phoneVerifiedAt", "phoneOtpHash", "phoneOtpSalt", "phoneOtpPhone", "sellerBankAccounts", "notificationPreferences",
    ]) {
      expect(payload.user).not.toHaveProperty(key);
    }
    for (const value of [
      "secret-password-hash", "secret-email-token-hash", "+972522222222", "+972511111111", "secret-otp-hash", "secret-otp-salt", "secret-account-number", "secret-browser-push-subscription-hash",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });
});
