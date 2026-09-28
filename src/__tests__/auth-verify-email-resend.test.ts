import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  resolveClientIp: vi.fn(),
  inferLocaleFromRequest: vi.fn(),
  getSupabaseEmailRedirectUrl: vi.fn(),
  resend: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  resolveClientIp: mocks.resolveClientIp,
}));

vi.mock("@/lib/supabase-auth-provider", () => ({
  inferLocaleFromRequest: mocks.inferLocaleFromRequest,
  getSupabaseEmailRedirectUrl: mocks.getSupabaseEmailRedirectUrl,
  createSupabaseAuthClient: vi.fn(() => ({
    auth: {
      resend: mocks.resend,
    },
  })),
}));

import { POST } from "@/app/api/auth/verify-email/resend/route";

describe("verify email resend route", () => {
  beforeEach(() => {
    mocks.checkSharedRateLimit.mockReset();
    mocks.resolveClientIp.mockReset();
    mocks.inferLocaleFromRequest.mockReset();
    mocks.getSupabaseEmailRedirectUrl.mockReset();
    mocks.resend.mockReset();

    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.resolveClientIp.mockReturnValue("198.51.100.10");
    mocks.inferLocaleFromRequest.mockReturnValue("en");
    mocks.getSupabaseEmailRedirectUrl.mockReturnValue("https://www.alphatraders.co.il/en/login");
    mocks.resend.mockResolvedValue({ error: null });
  });

  it("returns success only when supabase resend accepts", async () => {
    const request = new NextRequest("http://localhost/api/auth/verify-email/resend", {
      method: "POST",
      body: JSON.stringify({ email: "buyer@example.com" }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    const payload = await response.json() as { message?: string };
    expect(response.status).toBe(200);
    expect(payload.message).toBe("If the account exists and is unverified, a new verification email has been sent.");
  });

  it("keeps the Arabic page locale ahead of an English browser for email content and links", async () => {
    mocks.inferLocaleFromRequest.mockImplementation((request: NextRequest) => (
      resolveSupportedRequestLocale(request.headers)
    ));
    mocks.getSupabaseEmailRedirectUrl.mockImplementation((locale: "ar" | "en") => (
      `https://www.alphatraders.co.il/${locale}/login`
    ));
    const request = new NextRequest("http://localhost/api/auth/verify-email/resend", {
      method: "POST",
      body: JSON.stringify({ email: "buyer@example.test" }),
      headers: {
        "Content-Type": "application/json",
        Referer: "https://www.alphatraders.co.il/ar/verify-email",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const response = await POST(request);
    const payload = await response.json() as { message?: string };

    expect(payload.message).toContain("إذا كان الحساب موجودًا وغير موثق");
    expect(mocks.getSupabaseEmailRedirectUrl).toHaveBeenCalledWith("ar");
    expect(mocks.resend).toHaveBeenCalledWith(expect.objectContaining({
      options: { emailRedirectTo: "https://www.alphatraders.co.il/ar/login" },
    }));
  });

  it("returns 503 when provider resend fails", async () => {
    mocks.resend.mockResolvedValue({ error: { message: "email rate limit exceeded" } });
    const request = new NextRequest("http://localhost/api/auth/verify-email/resend", {
      method: "POST",
      body: JSON.stringify({ email: "buyer@example.com" }),
      headers: { "Content-Type": "application/json" },
    });
    const response = await POST(request);
    const payload = await response.json() as { error?: string };
    expect(response.status).toBe(503);
    expect(payload.error).toBe("We could not send a verification email right now. Please try again shortly.");
  });

  it("localizes rate-limit and validation errors for Arabic API clients", async () => {
    mocks.inferLocaleFromRequest.mockReturnValue("ar");
    mocks.checkSharedRateLimit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 30 });
    const rateLimited = await POST(new NextRequest("http://localhost/api/auth/verify-email/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      body: JSON.stringify({ email: "buyer@example.test" }),
    }));
    expect(await rateLimited.json()).toMatchObject({
      error: "طلبات كثيرة جدًا. يُرجى المحاولة مرة أخرى بعد قليل.",
    });

    mocks.checkSharedRateLimit.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 });
    const invalid = await POST(new NextRequest("http://localhost/api/auth/verify-email/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      body: JSON.stringify({ email: "invalid" }),
    }));
    expect(await invalid.json()).toMatchObject({ error: "يلزم إدخال بريد إلكتروني صالح." });
  });
});
