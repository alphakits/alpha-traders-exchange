import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createEmailVerificationTokenForUser, upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { authenticateLocalUser, createUserSession } from "@/lib/auth";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site-url";
import { buildAuthEmail, sendAuthEmailViaResend } from "@/lib/auth-email-delivery";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: vi.fn(),
  })),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  createEmailVerificationTokenForUser: vi.fn(),
  upsertUserProfileForAuth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  AUTH_COOKIE_NAME: "alpha-auth",
  AUTH_PHONE_VERIFIED_COOKIE_NAME: "alpha-phone-verified",
  AUTH_VERIFIED_COOKIE_NAME: "alpha-verified",
  authenticateLocalUser: vi.fn(),
  createUserSession: vi.fn(),
}));

vi.mock("@/lib/auth-cookie", () => ({
  shouldUseSecureAuthCookie: vi.fn(() => false),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: vi.fn(() => ({ allowed: true })),
  resolveClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/supabase-auth-provider", () => ({
  createSupabaseAuthClient: vi.fn(() => ({
    auth: { signInWithPassword: vi.fn() },
  })),
  inferLocaleFromRequest: vi.fn(() => "en"),
}));

vi.mock("@/lib/phone-verification", () => ({
  isMarketplacePhoneVerificationDisabled: vi.fn(() => true),
}));

vi.mock("@/lib/verification-bypass", () => ({
  isVerified: vi.fn(() => true),
}));

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: vi.fn(() => "https://www.alphatraders.co.il"),
}));

vi.mock("@/lib/auth-email-delivery", () => ({
  buildAuthEmail: vi.fn(() => ({ subject: "Verify", html: "<p>Verify</p>", text: "Verify" })),
  sendAuthEmailViaResend: vi.fn(),
}));

const { POST } = await import("@/app/api/auth/login/route");

const mockCookies = vi.mocked(cookies);
const mockCheckSharedRateLimit = vi.mocked(checkSharedRateLimit);
const mockCreateEmailVerificationTokenForUser = vi.mocked(createEmailVerificationTokenForUser);
const mockUpsertUserProfileForAuth = vi.mocked(upsertUserProfileForAuth);
const mockAuthenticateLocalUser = vi.mocked(authenticateLocalUser);
const mockCreateUserSession = vi.mocked(createUserSession);
const mockGetSiteUrl = vi.mocked(getSiteUrl);
const mockBuildAuthEmail = vi.mocked(buildAuthEmail);
const mockSendAuthEmailViaResend = vi.mocked(sendAuthEmailViaResend);

const verifiedLocalUser = {
  id: "local-user",
  fullName: "Local User",
  email: "local@example.com",
  whatsappNumber: "",
  role: "buyer",
  roles: ["buyer"],
  sellerStatus: "buyer",
  emailVerified: true,
};

let setCookie: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  setCookie = vi.fn();
  mockCookies.mockResolvedValue({ set: setCookie } as never);
  mockCheckSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, reason: null });
  mockAuthenticateLocalUser.mockResolvedValue(null);
  mockCreateEmailVerificationTokenForUser.mockResolvedValue({ token: "a".repeat(64) } as never);
  mockUpsertUserProfileForAuth.mockResolvedValue(verifiedLocalUser as never);
  mockCreateUserSession.mockResolvedValue({ token: "test-session-token", expiresAt: "2030-01-01T00:00:00.000Z" });
  mockGetSiteUrl.mockReturnValue("https://www.alphatraders.co.il");
  mockBuildAuthEmail.mockReturnValue({ subject: "Verify", html: "<p>Verify</p>", text: "Verify" });
  mockSendAuthEmailViaResend.mockResolvedValue({ ok: true });
});

describe("POST /api/auth/login", () => {
  it("returns a friendly error when the JSON body is malformed", async () => {
    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }) as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(400);

    const payload = await response.json();
    expect(payload).toEqual({ error: "Invalid JSON body." });
  });

  it.each([false, undefined])("rejects a local account without an explicit verified-email marker", async (emailVerified) => {
    mockAuthenticateLocalUser.mockResolvedValue({ ...verifiedLocalUser, emailVerified } as never);
    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verifiedLocalUser.email, password: "valid-password" }),
    }) as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ requiresEmailVerification: true });
    expect(mockCreateEmailVerificationTokenForUser).toHaveBeenCalledWith(verifiedLocalUser.id);
    expect(mockSendAuthEmailViaResend).toHaveBeenCalledWith(expect.objectContaining({ to: verifiedLocalUser.email }));
    expect(mockUpsertUserProfileForAuth).not.toHaveBeenCalled();
    expect(mockCreateUserSession).not.toHaveBeenCalled();
    expect(setCookie).toHaveBeenCalledWith("alpha-verified", "", expect.any(Object));
    expect(setCookie).not.toHaveBeenCalledWith("alpha-verified", "1", expect.any(Object));
  });

  it("does not issue a local verification email when the dedicated local recovery limit is exhausted", async () => {
    mockCheckSharedRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60, reason: "limit_reached" });
    mockAuthenticateLocalUser.mockResolvedValue({ ...verifiedLocalUser, emailVerified: false } as never);
    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verifiedLocalUser.email, password: "valid-password" }),
    }) as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mockCreateEmailVerificationTokenForUser).not.toHaveBeenCalled();
    expect(mockSendAuthEmailViaResend).not.toHaveBeenCalled();
    expect(mockUpsertUserProfileForAuth).not.toHaveBeenCalled();
    expect(mockCreateUserSession).not.toHaveBeenCalled();
  });

  it("allows a locally authenticated account with an explicit verified-email marker", async () => {
    mockAuthenticateLocalUser.mockResolvedValue(verifiedLocalUser as never);
    const request = new Request("https://example.com/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verifiedLocalUser.email, password: "valid-password" }),
    }) as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockUpsertUserProfileForAuth).toHaveBeenCalledWith(expect.objectContaining({
      email: verifiedLocalUser.email,
      emailVerified: true,
    }));
    expect(mockCreateUserSession).toHaveBeenCalledWith(verifiedLocalUser.id, 14);
    expect(setCookie).toHaveBeenCalledWith("alpha-verified", "1", expect.any(Object));
  });
});
