import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  findUserByEmail: vi.fn(),
  updateUserPassword: vi.fn(),
  deleteSessionsForUser: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkRateLimit,
  resolveClientIp: mocks.resolveClientIp,
}));

vi.mock("@/lib/site-url", () => ({
  getSiteUrl: mocks.getSiteUrl,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  findUserByEmail: mocks.findUserByEmail,
  updateUserPassword: mocks.updateUserPassword,
  deleteSessionsForUser: mocks.deleteSessionsForUser,
}));
vi.mock("@/lib/mobile-auth", () => ({ mobileAuthService: { revokeAllUserSessions: mocks.revokeAllUserSessions } }));

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
        createUser: mocks.createUser,
      },
    },
  }),
}));

import { POST as requestReset } from "@/app/api/auth/reset/request/route";
import { POST as confirmReset } from "@/app/api/auth/reset/confirm/route";

describe("auth reset routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
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
    mocks.findUserByEmail.mockReset();
    mocks.updateUserPassword.mockReset();
    mocks.deleteSessionsForUser.mockReset();
    mocks.revokeAllUserSessions.mockReset();
    mocks.createUser.mockReset();
    mocks.findUserByEmail.mockResolvedValue(null);
    mocks.updateUserPassword.mockResolvedValue(undefined);
    mocks.deleteSessionsForUser.mockResolvedValue(undefined);
    mocks.revokeAllUserSessions.mockResolvedValue(1);
    mocks.createUser.mockResolvedValue({ data: { user: { id: "provider-user" } }, error: null });

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
    mocks.setSession.mockResolvedValue({ data: { user: { email: "buyer@example.com" } }, error: null });
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
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "notifications@example.com");
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

  it("shows a retryable error when local limiter is exceeded", async () => {
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
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    await expect(response.json()).resolves.toEqual({ error: "Too many requests. Please try again shortly." });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it.each(["en", "ar"])("does not claim a reset email was sent after fallback delivery fails in %s", async locale => {
    mocks.inferLocaleFromRequest.mockReturnValue(locale);
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { message: "email rate limit exceeded" } });
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "notifications@example.com");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("internal smtp connection")));
    const response = await requestReset(new NextRequest("http://localhost/api/auth/reset/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "buyer@example.com" }),
    }));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.ok).toBeUndefined();
    expect(payload.error).toContain(locale === "ar" ? "تعذر إرسال" : "We could not send");
    expect(JSON.stringify(payload)).not.toContain("internal smtp");
  });

  it("preserves unknown-account privacy when fallback link generation finds no user", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ error: { message: "email rate limit exceeded" } });
    mocks.generateLink.mockResolvedValue({ data: null, error: { code: "user_not_found" } });
    const response = await requestReset(new NextRequest("http://localhost/api/auth/reset/request", {
      method: "POST", body: JSON.stringify({ email: "unknown@example.com" }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("allows a stronger password retry after a one-use recovery token was exchanged", async () => {
    mocks.updateUser.mockResolvedValueOnce({ error: { code: "weak_password", message: "Password is weak" } })
      .mockResolvedValueOnce({ error: null });
    const first = await confirmReset(new NextRequest("http://localhost/api/auth/reset/confirm", {
      method: "POST", body: JSON.stringify({ tokenHash: "one-use-token", password: "password123", confirmPassword: "password123" }),
    }));
    expect(first.status).toBe(422);
    const rejected = await first.json();
    expect(rejected.code).toBe("WEAK_PASSWORD");
    expect(first.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.signOut).not.toHaveBeenCalled();
    const retry = await confirmReset(new NextRequest("http://localhost/api/auth/reset/confirm", {
      method: "POST", body: JSON.stringify({ ...rejected.recoverySession, password: "Strong-unique-test-456!", confirmPassword: "Strong-unique-test-456!" }),
    }));
    expect(retry.status).toBe(200);
    expect(mocks.verifyOtp).toHaveBeenCalledTimes(1);
    expect(mocks.updateUser).toHaveBeenCalledTimes(2);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("revokes web and native sessions and removes an older password only after a successful reset", async () => {
    mocks.findUserByEmail.mockResolvedValue({ id: "legacy-user", passwordHash: "test-old-hash" });
    const response = await confirmReset(new NextRequest("http://localhost/api/auth/reset/confirm", {
      method: "POST", body: JSON.stringify({ tokenHash: "reset-token", password: "Strong-unique-password-567!", confirmPassword: "Strong-unique-password-567!" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.updateUserPassword).toHaveBeenCalledWith("legacy-user", "");
    expect(mocks.deleteSessionsForUser).toHaveBeenCalledWith("legacy-user");
    expect(mocks.revokeAllUserSessions).toHaveBeenCalledWith("legacy-user", "password_reset");
  });

  it("does not revoke sessions or touch the old password when the replacement is rejected", async () => {
    mocks.updateUser.mockResolvedValue({ error: { code: "weak_password" } });
    const response = await confirmReset(new NextRequest("http://localhost/api/auth/reset/confirm", {
      method: "POST", body: JSON.stringify({ tokenHash: "reset-token", password: "password123", confirmPassword: "password123" }),
    }));
    expect(response.status).toBe(422);
    expect(mocks.updateUserPassword).not.toHaveBeenCalled();
    expect(mocks.deleteSessionsForUser).not.toHaveBeenCalled();
    expect(mocks.revokeAllUserSessions).not.toHaveBeenCalled();
  });

  it("prepares a verified legacy account missing from the provider for normal recovery", async () => {
    mocks.findUserByEmail.mockResolvedValue({ fullName: "Legacy User", passwordHash: "test-old-hash", emailVerified: true });
    mocks.generateLink.mockResolvedValue({ data: null, error: { code: "user_not_found", message: "User not found" } });
    const response = await requestReset(new NextRequest("http://localhost/api/auth/reset/request", {
      method: "POST", body: JSON.stringify({ email: "legacy@example.com" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "legacy@example.com", email_confirm: true }));
    expect(mocks.createUser.mock.calls[0][0].password.length).toBeGreaterThanOrEqual(40);
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("legacy@example.com", expect.any(Object));
    expect(mocks.updateUserPassword).not.toHaveBeenCalled();
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
