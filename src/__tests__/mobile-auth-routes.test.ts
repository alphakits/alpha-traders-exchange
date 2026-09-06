// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  authenticateMobileCredentials: vi.fn(),
  issueSession: vi.fn(),
  rotateRefreshToken: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  revokeDevice: vi.fn(),
  requireMobileApiUser: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/mobile-credentials", () => ({
  authenticateMobileCredentials: mocks.authenticateMobileCredentials,
}));

vi.mock("@/lib/mobile-auth", () => ({
  hashMobileSecret: (value: string) => `hashed:${value}`,
  mobileAuthService: {
    issueSession: mocks.issueSession,
    rotateRefreshToken: mocks.rotateRefreshToken,
    revokeAllUserSessions: mocks.revokeAllUserSessions,
    revokeDevice: mocks.revokeDevice,
  },
}));

vi.mock("@/lib/mobile-api-auth", () => ({
  requireMobileApiUser: mocks.requireMobileApiUser,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  resolveClientIp: () => "203.0.113.10",
}));

vi.mock("@/lib/structured-logging", () => ({
  logEvent: mocks.logEvent,
}));

import { POST as login } from "@/app/api/mobile/v1/auth/login/route";
import { POST as refresh } from "@/app/api/mobile/v1/auth/refresh/route";
import { GET as me } from "@/app/api/mobile/v1/auth/me/route";
import { DELETE as logout } from "@/app/api/mobile/v1/auth/session/route";

const user = {
  id: "user-1",
  fullName: "Mobile Buyer",
  email: "buyer@example.test",
  passwordHash: "never-return-this-hash",
  whatsappNumber: "+972500000000",
  preferredNetworks: ["TRC20"],
  profilePhotoUrl: "",
  languages: ["Arabic", "English"],
  preferredLocale: "ar",
  bio: "",
  onlineStatus: "offline",
  availabilityStatus: "available",
  role: "buyer",
  roles: ["buyer"],
  sellerStatus: "buyer",
  emailVerified: true,
  emailVerificationTokenHash: "never-return-this-token",
  isFoundingMember: true,
  isFoundingSeller: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies AlphaExchangeUser;

const tokens = {
  accessToken: `atr_at_v1.${"a".repeat(44)}`,
  refreshToken: `atr_rt_v1.${"b".repeat(66)}`,
  tokenType: "Bearer" as const,
  expiresIn: 900,
  accessTokenExpiresAt: "2026-09-06T01:15:00.000Z",
  refreshTokenExpiresAt: "2026-10-06T01:00:00.000Z",
};

function headers(extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "accept-language": "ar",
    "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
    "x-app-version": "1.0.0",
    "x-platform": "ios",
    "x-request-id": "request-123",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkSharedRateLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    reason: null,
  });
  mocks.authenticateMobileCredentials.mockResolvedValue({ status: "authenticated", user });
  mocks.issueSession.mockResolvedValue({ tokens, session: { userId: user.id } });
  mocks.rotateRefreshToken.mockResolvedValue({ status: "rotated", tokens, session: { userId: user.id } });
  mocks.requireMobileApiUser.mockResolvedValue({
    user,
    accessToken: tokens.accessToken,
    unauthorized: null,
  });
  mocks.revokeDevice.mockResolvedValue(true);
  mocks.revokeAllUserSessions.mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mobile v1 authentication routes", () => {
  it("rejects login before credential work when native client headers are missing", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "valid-password" }),
    });

    const response = await login(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "DEVICE_HEADERS_REQUIRED" },
    });
    expect(mocks.authenticateMobileCredentials).not.toHaveBeenCalled();
  });

  it("rejects an unsupported app version before credential work", async () => {
    vi.stubEnv("MOBILE_MIN_IOS_VERSION", "2.0.0");
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/auth/login", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ email: user.email, password: "valid-password" }),
    });

    const response = await login(request);
    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "APP_UPDATE_REQUIRED",
        message: "يجب تحديث تطبيق ألفا تريدرز للمتابعة بأمان.",
      },
    });
    expect(mocks.authenticateMobileCredentials).not.toHaveBeenCalled();
  });

  it("issues native tokens without setting or exposing browser credentials", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/auth/login", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ email: user.email, password: "valid-password" }),
    });

    const response = await login(request);
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(payload).toMatchObject({
      user: {
        id: user.id,
        preferredLocale: "ar",
        emailVerified: true,
      },
      tokens,
      requestId: "request-123",
    });
    for (const secret of [user.passwordHash, user.emailVerificationTokenHash, user.whatsappNumber]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    ["invalid", "INVALID_CREDENTIALS", 401],
    ["email_unverified", "EMAIL_VERIFICATION_REQUIRED", 403],
    ["disabled", "ACCOUNT_DISABLED", 403],
  ])("maps %s credential failures to stable API errors", async (status, code, expectedStatus) => {
    mocks.authenticateMobileCredentials.mockResolvedValue({ status });
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/auth/login", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ email: user.email, password: "valid-password" }),
    });

    const response = await login(request);
    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(mocks.issueSession).not.toHaveBeenCalled();
  });

  it("rotates refresh tokens and reports replay detection with a stable code", async () => {
    mocks.rotateRefreshToken.mockResolvedValueOnce({ status: "reused" });
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/auth/refresh", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });

    const response = await refresh(request);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REFRESH_TOKEN_REUSED" },
    });
  });

  it("returns the native session projection from the bearer-authenticated me route", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/auth/me", {
      headers: headers({ authorization: `Bearer ${tokens.accessToken}` }),
    });

    const response = await me(request);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.user).toMatchObject({ id: user.id, role: "buyer" });
    expect(JSON.stringify(payload)).not.toContain(user.passwordHash);
  });

  it("supports explicit account-wide logout without trusting a user-id header", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/auth/session?scope=all", {
      method: "DELETE",
      headers: headers({ authorization: `Bearer ${tokens.accessToken}` }),
    });

    const response = await logout(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ revoked: true, scope: "all" });
    expect(mocks.revokeAllUserSessions).toHaveBeenCalledWith(user.id);
    expect(mocks.revokeDevice).not.toHaveBeenCalled();
  });
});
