import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  resolveClientIp: vi.fn(),
  inferLocaleFromRequest: vi.fn(),
  getSupabaseEmailRedirectUrl: vi.fn(),
  signUp: vi.fn(),
  resend: vi.fn(),
  adminCreateUser: vi.fn(),
  upsertUserProfileForAuth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  resolveClientIp: mocks.resolveClientIp,
}));

vi.mock("@/lib/supabase-auth-provider", () => ({
  inferLocaleFromRequest: mocks.inferLocaleFromRequest,
  getSupabaseEmailRedirectUrl: mocks.getSupabaseEmailRedirectUrl,
  createSupabaseAuthClient: vi.fn(() => ({
    auth: {
      signUp: mocks.signUp,
      resend: mocks.resend,
    },
  })),
  createSupabaseAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: mocks.adminCreateUser,
      },
    },
  })),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  upsertUserProfileForAuth: mocks.upsertUserProfileForAuth,
}));

import { POST } from "@/app/api/auth/register/route";

describe("auth register rate-limit hotfix", () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockReset();
    mocks.resolveClientIp.mockReset();
    mocks.inferLocaleFromRequest.mockReset();
    mocks.getSupabaseEmailRedirectUrl.mockReset();
    mocks.signUp.mockReset();
    mocks.resend.mockReset();
    mocks.adminCreateUser.mockReset();
    mocks.upsertUserProfileForAuth.mockReset();

    mocks.resolveClientIp.mockReturnValue("198.51.100.23");
    mocks.inferLocaleFromRequest.mockReturnValue("en");
    mocks.getSupabaseEmailRedirectUrl.mockReturnValue("https://www.alphatraders.co.il/en/login");
    mocks.checkRateLimit
      .mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null });
    mocks.signUp.mockResolvedValue({
      data: { user: { identities: [{ id: "id-1" }] } },
      error: null,
    });
    mocks.resend.mockResolvedValue({ error: null });
    mocks.adminCreateUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.upsertUserProfileForAuth.mockResolvedValue({});
  });

  function makeRequest(email: string, locale = "en") {
    return new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Locale": locale,
      },
      body: JSON.stringify({
        fullName: "Test User",
        email,
        password: "password123",
        confirmPassword: "password123",
        whatsappNumber: "+972500000000",
        agreedToTerms: true,
      }),
    });
  }

  it("returns localized arabic message when ip limiter blocks", async () => {
    mocks.inferLocaleFromRequest.mockReturnValue("ar");
    mocks.checkRateLimit.mockReset();
    mocks.checkRateLimit.mockReturnValue({ allowed: false, retryAfterSeconds: 42, reason: "limit_reached" });
    const response = await POST(makeRequest("new-user@example.com", "ar"));
    const payload = await response.json() as { error?: string };
    expect(response.status).toBe(429);
    expect(payload.error).toBe("تم تقييد التسجيل مؤقتًا. يُرجى المحاولة مرة أخرى خلال بضع دقائق.");
  });

  it("falls back to admin creation when provider sign-up is rate-limited", async () => {
    mocks.signUp.mockResolvedValue({
      data: null,
      error: { message: "rate limit exceeded" },
    });
    const response = await POST(makeRequest("fresh@example.com", "en"));
    const payload = await response.json() as { ok?: boolean; message?: string };
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(mocks.adminCreateUser).toHaveBeenCalled();
  });

  it("uses composite ip+email key for retry-friendly legitimate registrations", async () => {
    await POST(makeRequest("first@example.com", "en"));
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: "auth:register:ip-email",
        identifier: "198.51.100.23:first@example.com",
      }),
    );
  });
});
