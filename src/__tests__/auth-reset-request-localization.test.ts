import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkRateLimit,
  resolveClientIp: () => "198.51.100.24",
}));

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: () => "https://www.alphatraders.co.il",
}));

vi.mock("@/lib/supabase-auth-provider", () => ({
  inferLocaleFromRequest: (request: NextRequest) => resolveSupportedRequestLocale(request.headers),
  createSupabaseAuthClient: () => ({ auth: { resetPasswordForEmail: mocks.resetPasswordForEmail } }),
  createSupabaseAdminClient: () => ({ auth: { admin: { generateLink: vi.fn() } } }),
}));

vi.mock("@/lib/auth-email-delivery", () => ({
  buildAuthEmail: vi.fn(),
  sendAuthEmailViaResend: vi.fn(),
}));

import { POST } from "@/app/api/auth/reset/request/route";

describe("password-reset request localization", () => {
  beforeEach(() => {
    mocks.checkRateLimit.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it("uses the explicit Arabic locale for the response and reset link", async () => {
    const request = new NextRequest("http://localhost/api/auth/reset/request", {
      method: "POST",
      body: JSON.stringify({ email: "buyer@example.test" }),
      headers: {
        "Content-Type": "application/json",
        "X-Locale": "ar",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const response = await POST(request);
    const payload = await response.json() as { message?: string };

    expect(payload.message).toContain("إذا كان هناك حساب مرتبط بهذا البريد الإلكتروني");
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("buyer@example.test", {
      redirectTo: "https://www.alphatraders.co.il/ar/reset-password",
    });
  });
});
