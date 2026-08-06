import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  resolveClientIp: vi.fn(),
  getSiteUrl: vi.fn(),
  inferLocaleFromRequest: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  generateLink: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  resolveClientIp: mocks.resolveClientIp,
}));

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: mocks.getSiteUrl,
}));

vi.mock("@/lib/supabase-auth-provider", () => ({
  inferLocaleFromRequest: mocks.inferLocaleFromRequest,
  createSupabaseAuthClient: () => ({
    auth: {
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      verifyOtp: mocks.verifyOtp,
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      setSession: mocks.setSession,
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        generateLink: mocks.generateLink,
      },
    },
  }),
}));

import { POST as requestReset } from "@/app/api/auth/reset/request/route";
import { POST as confirmReset } from "@/app/api/auth/reset/confirm/route";

describe("auth reset routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.checkRateLimit.mockReset();
    mocks.resolveClientIp.mockReset();
    mocks.getSiteUrl.mockReset();
    mocks.inferLocaleFromRequest.mockReset();
    mocks.resetPasswordForEmail.mockReset();
    mocks.generateLink.mockReset();
    mocks.verifyOtp.mockReset();
    mocks.exchangeCodeForSession.mockReset();
    mocks.setSession.mockReset();
    mocks.updateUser.mockReset();
    mocks.signOut.mockReset();

    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.resolveClientIp.mockReturnValue("198.51.100.23");
    mocks.getSiteUrl.mockReturnValue("https://www.alphatraders.co.il");
    mocks.inferLocaleFromRequest.mockReturnValue("en");
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
    mocks.generateLink.mockResolvedValue({
      data: { properties: { action_link: "https://www.alphatraders.co.il/en/reset-password?token_hash=test-token&type=recovery" } },
      error: null,
    });
    mocks.verifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      },
      error: null,
    });
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        session: {
          access_token: "code-access-token",
          refresh_token: "code-refresh-token",
        },
      },
      error: null,
    });
    mocks.setSession.mockResolvedValue({ error: null });
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("returns the generic success message for valid reset requests", async () => {
    const request = new NextRequest("http://localhost/api/auth/reset/request", {
      method: "POST",
      body: JSON.stringify({ email: "buyer@example.com" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await requestReset(request);
    const payload = await response.json() as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("If an account exists for this email, we've sent password reset instructions.");
  });

  it("uses resend fallback when supabase reset email is rate-limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
      json: async () => ({ id: "mail-id" }),
    }));
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { message: "email rate limit exceeded" },
    });
    const request = new NextRequest("http://localhost/api/auth/reset/request", {
      method: "POST",
      body: JSON.stringify({ email: "fallback@example.com" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await requestReset(request);
    const payload = await response.json() as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("If an account exists for this email, we've sent password reset instructions.");
    expect(mocks.generateLink).toHaveBeenCalled();
  });

  it("does not reveal account existence when provider returns a non-rate-limit error", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found" },
    });
    const request = new NextRequest("http://localhost/api/auth/reset/request", {
      method: "POST",
      body: JSON.stringify({ email: "unknown@example.com" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await requestReset(request);
    const payload = await response.json() as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("If an account exists for this email, we've sent password reset instructions.");
  });

  it("returns generic success when local limiter is exceeded", async () => {
    mocks.checkRateLimit.mockReset();
    mocks.checkRateLimit
      .mockReturnValueOnce({ allowed: false, retryAfterSeconds: 42 })
      .mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    const request = new NextRequest("http://localhost/api/auth/reset/request", {
      method: "POST",
      body: JSON.stringify({ email: "blocked@example.com" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await requestReset(request);
    const payload = await response.json() as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("If an account exists for this email, we've sent password reset instructions.");
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("rejects reset confirmation when passwords do not match", async () => {
    const request = new NextRequest("http://localhost/api/auth/reset/confirm", {
      method: "POST",
      body: JSON.stringify({
        tokenHash: "token-hash",
        type: "recovery",
        password: "new-password-123",
        confirmPassword: "new-password-456",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await confirmReset(request);
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Passwords do not match.");
  });

  it("returns an invalid/expired message when token verification fails", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: null,
      error: { message: "OTP expired" },
    });
    const request = new NextRequest("http://localhost/api/auth/reset/confirm", {
      method: "POST",
      body: JSON.stringify({
        tokenHash: "expired-token",
        type: "recovery",
        password: "new-password-123",
        confirmPassword: "new-password-123",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await confirmReset(request);
    const payload = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("This reset link is invalid or expired. Please request a new one.");
  });

  it("updates password and returns the launch success message", async () => {
    const request = new NextRequest("http://localhost/api/auth/reset/confirm", {
      method: "POST",
      body: JSON.stringify({
        tokenHash: "valid-token",
        type: "recovery",
        password: "new-password-123",
        confirmPassword: "new-password-123",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await confirmReset(request);
    const payload = await response.json() as { message?: string };

    expect(response.status).toBe(200);
    expect(payload.message).toBe("Your password has been updated successfully. Please sign in.");
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
  });

  it("accepts code-based recovery links and updates the password", async () => {
    const request = new NextRequest("http://localhost/api/auth/reset/confirm", {
      method: "POST",
      body: JSON.stringify({
        code: "valid-code",
        password: "new-password-123",
        confirmPassword: "new-password-123",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await confirmReset(request);
    expect(response.status).toBe(200);
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid-code");
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: "new-password-123" });
  });
});
