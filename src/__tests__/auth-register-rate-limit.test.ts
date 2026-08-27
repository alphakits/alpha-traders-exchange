import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  resolveClientIp: vi.fn(),
  inferLocaleFromRequest: vi.fn(),
  getSupabaseEmailRedirectUrl: vi.fn(),
  signUp: vi.fn(),
  findUserByEmail: vi.fn(),
  upsertUserProfileForAuth: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkRateLimit,
  resolveClientIp: mocks.resolveClientIp,
}));

vi.mock("@/lib/supabase-auth-provider", () => ({
  inferLocaleFromRequest: mocks.inferLocaleFromRequest,
  getSupabaseEmailRedirectUrl: mocks.getSupabaseEmailRedirectUrl,
  createSupabaseAuthClient: vi.fn(() => ({
    auth: {
      signUp: mocks.signUp,
    },
  })),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  findUserByEmail: mocks.findUserByEmail,
  upsertUserProfileForAuth: mocks.upsertUserProfileForAuth,
}));

import { POST } from "@/app/api/auth/register/route";

describe("auth register route", () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockReset();
    mocks.resolveClientIp.mockReset();
    mocks.inferLocaleFromRequest.mockReset();
    mocks.getSupabaseEmailRedirectUrl.mockReset();
    mocks.signUp.mockReset();
    mocks.findUserByEmail.mockReset();
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
    mocks.findUserByEmail.mockResolvedValue(null);
    mocks.upsertUserProfileForAuth.mockResolvedValue({});
  });

  function makeRequest(email: string, locale = "en", overrides: Record<string, unknown> = {}) {
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
        ...overrides,
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

  it("returns stable codes and Arabic validation copy", async () => {
    mocks.inferLocaleFromRequest.mockReturnValue("ar");
    const response = await POST(makeRequest("invalid-email", "ar"));
    const payload = await response.json() as { code?: string; error?: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      code: "INVALID_EMAIL",
      error: "صيغة البريد الإلكتروني غير صحيحة.",
    });
  });

  it.each([
    { locale: "en" as const, message: "If this email can be registered, you will receive a confirmation message. If you already have an account, sign in or reset your password." },
    { locale: "ar" as const, message: "إذا كان البريد صالحًا للتسجيل، فستصلك رسالة تأكيد. إذا كان لديك حساب بالفعل، فسجّل الدخول أو أعد تعيين كلمة المرور." },
  ])("normalizes unexpected provider errors in $locale", async ({ locale, message }) => {
    mocks.inferLocaleFromRequest.mockReturnValue(locale);
    mocks.signUp.mockRejectedValue(new Error("internal provider connection details"));
    const response = await POST(makeRequest("provider-error@example.com", locale));
    const payload = await response.json() as { ok?: boolean; message?: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      message,
    });
  });

  it("calls supabase signup and returns success", async () => {
    const response = await POST(makeRequest("fresh@example.com", "en"));
    const payload = await response.json() as { ok?: boolean; message?: string };
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "fresh@example.com",
      options: expect.objectContaining({
        emailRedirectTo: "https://www.alphatraders.co.il/en/login",
        data: expect.objectContaining({ preferred_locale: "en" }),
      }),
    }));
  });

  it("allows registration without a phone number and keeps the optional value out of auth metadata", async () => {
    const response = await POST(makeRequest("no-phone@example.com", "en", { whatsappNumber: "" }));

    expect(response.status).toBe(200);
    expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "no-phone@example.com",
      options: expect.objectContaining({
        data: { full_name: "Test User", preferred_locale: "en" },
      }),
    }));
    expect(mocks.upsertUserProfileForAuth).toHaveBeenCalledWith(expect.objectContaining({
      whatsappNumber: "",
      preferredLocale: "en",
    }));
  });

  it("normalizes provider rate limits so they cannot reveal an unknown address", async () => {
    mocks.signUp.mockResolvedValue({
      data: null,
      error: { message: "email rate limit exceeded" },
    });
    const response = await POST(makeRequest("ratelimited@example.com", "en"));
    const payload = await response.json() as { ok?: boolean; message?: string };
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.message).toContain("If this email can be registered");
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

  it("uses the same provider path for a local account without disclosing or overwriting it", async () => {
    mocks.findUserByEmail.mockResolvedValue({
      id: "existing-user",
      fullName: "Existing User",
      whatsappNumber: "+972511111111",
    });
    const response = await POST(makeRequest("existing@example.com", "en"));
    const payload = await response.json() as { ok?: boolean; message?: string };
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.message).not.toMatch(/already registered/i);
    expect(mocks.checkRateLimit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ identifier: "198.51.100.23:existing@example.com" }),
    );
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.upsertUserProfileForAuth).not.toHaveBeenCalled();
  });

  it("never starts provider signup while a local-account lookup is unresolved", async () => {
    let resolveLookup: ((value: { id: string }) => void) | undefined;
    mocks.findUserByEmail.mockReturnValue(new Promise((resolve) => {
      resolveLookup = resolve;
    }));

    const responsePromise = POST(makeRequest("existing@example.com", "en"));
    await vi.waitFor(() => expect(mocks.findUserByEmail).toHaveBeenCalledTimes(1));
    expect(mocks.signUp).not.toHaveBeenCalled();
    resolveLookup?.({ id: "existing-user" });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("returns the same provider failure for existing and unknown valid emails", async () => {
    mocks.signUp.mockResolvedValue({
      data: null,
      error: { message: "provider unavailable" },
    });
    mocks.findUserByEmail.mockResolvedValue({ id: "existing-user" });

    const existingResponse = await POST(makeRequest("existing@example.com", "en"));
    const existingPayload = await existingResponse.json();

    mocks.checkRateLimit.mockReset();
    mocks.checkRateLimit
      .mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockReturnValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null });
    mocks.findUserByEmail.mockResolvedValue(null);
    const unknownResponse = await POST(makeRequest("unknown@example.com", "en"));
    const unknownPayload = await unknownResponse.json();

    expect({ status: existingResponse.status, payload: existingPayload }).toEqual({
      status: unknownResponse.status,
      payload: unknownPayload,
    });
    expect(existingPayload).toEqual({
      ok: true,
      message: "If this email can be registered, you will receive a confirmation message. If you already have an account, sign in or reset your password.",
    });
  });
});
