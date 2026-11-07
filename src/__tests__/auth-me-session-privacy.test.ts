import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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

import { GET as readSession } from "@/app/api/auth/me/route";

const GET = (request = new NextRequest("https://www.alphatraders.co.il/api/auth/me")) => readSession(request);

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
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    mocks.clearUserSession.mockReset();
    mocks.cookies.mockReset();
    mocks.expireAuthCookies.mockReset();
    mocks.getCurrentSessionToken.mockReset();
    mocks.getCurrentSessionUser.mockReset();
    mocks.isMarketplacePhoneVerificationDisabled.mockReset();
    mocks.isVerified.mockReset();

    mocks.cookies.mockResolvedValue({ get: vi.fn(), set: vi.fn() });
    mocks.getCurrentSessionToken.mockResolvedValue(null);
    mocks.isMarketplacePhoneVerificationDisabled.mockReturnValue(false);
    mocks.isVerified.mockReturnValue(true);
  });

  it("does not expire a replacement browser cookie when an old session read finishes late", async () => {
    mocks.getCurrentSessionUser.mockResolvedValue(null);
    mocks.getCurrentSessionToken.mockResolvedValue("superseded-session-token");
    const response = await GET();
    expect(await response.json()).toEqual({ user: null });
    expect(mocks.clearUserSession).toHaveBeenCalledWith("superseded-session-token");
    expect(mocks.expireAuthCookies).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
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

  it("does not synthesize a phone-verified cookie for an email-only session", async () => {
    const setCookie = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn(), set: setCookie });
    mocks.getCurrentSessionUser.mockResolvedValue({
      ...rawUser(),
      verifiedPhone: undefined,
      phoneVerifiedAt: undefined,
    });
    mocks.isMarketplacePhoneVerificationDisabled.mockReturnValue(false);
    mocks.isVerified.mockReturnValue(false);

    const response = await GET();
    const payload = await response.json() as { user: { isPhotoVerified: boolean } };

    expect(response.status).toBe(200);
    expect(payload.user.isPhotoVerified).toBe(false);
    expect(setCookie).not.toHaveBeenCalledWith("alpha_exchange_phone_verified", "1", expect.any(Object));
  });

  it("repairs a missing email verification routing cookie from the authenticated account", async () => {
    const setCookie = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn(), set: setCookie });
    mocks.getCurrentSessionUser.mockResolvedValue(rawUser());

    const response = await GET();

    expect(response.status).toBe(200);
    expect(setCookie).toHaveBeenCalledWith("alpha_exchange_verified", "1", expect.objectContaining({
      httpOnly: true, sameSite: "lax", path: "/",
    }));
  });

  it.each([false, undefined])("clears a stale verified-email hint when the account emailVerified is %s", async (emailVerified) => {
    const setCookie = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn(), set: setCookie });
    mocks.getCurrentSessionUser.mockResolvedValue({ ...rawUser(), emailVerified });
    mocks.isVerified.mockReturnValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(setCookie).toHaveBeenCalledWith("alpha_exchange_verified", "", expect.objectContaining({
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 0,
    }));
    expect(setCookie).not.toHaveBeenCalledWith("alpha_exchange_verified", "1", expect.any(Object));
  });

  it("returns a retryable 503 without logging out a user when session storage fails", async () => {
    const failureLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getCurrentSessionToken.mockResolvedValue("existing-session-token");
    mocks.getCurrentSessionUser.mockRejectedValue(new Error("database timeout with private details"));

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(payload).toEqual({ error: "SESSION_TEMPORARILY_UNAVAILABLE" });
    expect(mocks.clearUserSession).not.toHaveBeenCalled();
    expect(mocks.expireAuthCookies).not.toHaveBeenCalled();
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(JSON.stringify(failureLog.mock.calls)).not.toContain("private details");
    failureLog.mockRestore();
  });

  it("preserves a remembered login's existing verified-email cookie and its expiry", async () => {
    const setCookie = vi.fn();
    mocks.cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ name: "alpha_exchange_verified", value: "1" }),
      set: setCookie,
    });
    mocks.getCurrentSessionUser.mockResolvedValue(rawUser());

    expect((await GET()).status).toBe(200);

    expect(setCookie.mock.calls.some(([name]) => name === "alpha_exchange_verified")).toBe(false);
  });

  it.each([false, true])("uses the shared cookie security boundary for loopback and deployed requests (deployed=%s)", async deployed => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");
    vi.stubEnv("AUTH_COOKIE_SECURE", "false");
    for (const key of ["VERCEL_ENV", "SUPABASE_DB_URL", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) vi.stubEnv(key, undefined);
    vi.stubEnv("VERCEL", deployed ? "1" : undefined);
    const setCookie = vi.fn();
    mocks.cookies.mockResolvedValue({ get: vi.fn(), set: setCookie });
    mocks.getCurrentSessionUser.mockResolvedValue(rawUser());

    expect((await GET(new NextRequest("http://localhost:3000/api/auth/me"))).status).toBe(200);

    expect(setCookie).toHaveBeenCalledWith("alpha_exchange_verified", "1", expect.objectContaining({ secure: deployed }));
    expect(setCookie).toHaveBeenCalledWith("alpha_exchange_phone_verified", "1", expect.objectContaining({ secure: deployed }));
  });
});
