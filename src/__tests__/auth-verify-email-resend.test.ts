import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
});
