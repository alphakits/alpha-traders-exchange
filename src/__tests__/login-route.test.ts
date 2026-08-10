import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: vi.fn(),
  })),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
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
  checkRateLimit: vi.fn(() => ({ allowed: true })),
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

const { POST } = await import("@/app/api/auth/login/route");

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
});
