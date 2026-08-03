import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  resolveClientIp: vi.fn(),
  inferLocaleFromRequest: vi.fn(),
  getSupabaseEmailRedirectUrl: vi.fn(),
  adminCreateUser: vi.fn(),
  adminGenerateLink: vi.fn(),
  buildAuthEmail: vi.fn(),
  sendAuthEmailViaResend: vi.fn(),
  findUserByEmail: vi.fn(),
  upsertUserProfileForAuth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  resolveClientIp: mocks.resolveClientIp,
}));

vi.mock("@/lib/supabase-auth-provider", () => ({
  inferLocaleFromRequest: mocks.inferLocaleFromRequest,
  getSupabaseEmailRedirectUrl: mocks.getSupabaseEmailRedirectUrl,
  createSupabaseAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        createUser: mocks.adminCreateUser,
        generateLink: mocks.adminGenerateLink,
      },
    },
  })),
}));

vi.mock("@/lib/auth-email-delivery", () => ({
  buildAuthEmail: mocks.buildAuthEmail,
  sendAuthEmailViaResend: mocks.sendAuthEmailViaResend,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  findUserByEmail: mocks.findUserByEmail,
  upsertUserProfileForAuth: mocks.upsertUserProfileForAuth,
}));

import { POST } from "@/app/api/auth/register/route";

describe("auth register rate-limit hotfix", () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockReset();
    mocks.resolveClientIp.mockReset();
    mocks.inferLocaleFromRequest.mockReset();
    mocks.getSupabaseEmailRedirectUrl.mockReset();
    mocks.adminCreateUser.mockReset();
    mocks.adminGenerateLink.mockReset();
    mocks.buildAuthEmail.mockReset();
    mocks.sendAuthEmailViaResend.mockReset();
    mocks.findUserByEmail.mockReset();
    mocks.upsertUserProfileForAuth.mockReset();

    mocks.resolveClientIp.mockReturnValue("198.51.100.23");
    mocks.inferLocaleFromRequest.mockReturnValue("en");
    mocks.getSupabaseEmailRedirectUrl.mockReturnValue("https://www.alphatraders.co.il/en/login");
    mocks.checkRateLimit
      .mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null });
    mocks.adminCreateUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.adminGenerateLink.mockResolvedValue({
      data: { properties: { action_link: "https://www.alphatraders.co.il/en/verify-email?token_hash=abc&type=signup" } },
      error: null,
    });
    mocks.buildAuthEmail.mockReturnValue({
      subject: "Verify",
      html: "<p>verify</p>",
      text: "verify",
    });
    mocks.sendAuthEmailViaResend.mockResolvedValue({ ok: true });
    mocks.findUserByEmail.mockResolvedValue(null);
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

  it("creates user through admin flow and sends verification email via resend", async () => {
    const response = await POST(makeRequest("fresh@example.com", "en"));
    const payload = await response.json() as { ok?: boolean; message?: string };
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(mocks.adminCreateUser).toHaveBeenCalled();
    expect(mocks.adminGenerateLink).toHaveBeenCalled();
    expect(mocks.sendAuthEmailViaResend).toHaveBeenCalled();
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

  it("returns duplicate immediately before provider call when local profile already exists", async () => {
    mocks.findUserByEmail.mockResolvedValue({ id: "existing-user" });
    const response = await POST(makeRequest("existing@example.com", "en"));
    const payload = await response.json() as { error?: string };
    expect(response.status).toBe(409);
    expect(payload.error).toBe("Email already registered.");
    expect(mocks.adminCreateUser).not.toHaveBeenCalled();
  });
});
