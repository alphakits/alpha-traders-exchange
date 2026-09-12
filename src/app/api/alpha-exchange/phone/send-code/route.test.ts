import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  beginProfilePhoneVerification: vi.fn(),
  sendPhoneVerificationCode: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  beginProfilePhoneVerification: mocks.beginProfilePhoneVerification,
}));
vi.mock("@/lib/phone-verification-delivery", () => ({
  sendPhoneVerificationCode: mocks.sendPhoneVerificationCode,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  createRateLimitResponse: mocks.createRateLimitResponse,
}));

import { POST } from "./route";

describe("profile phone verification code delivery", () => {
  beforeEach(() => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    mocks.requireApiUser.mockReset().mockResolvedValue({
      user: { id: "user-1", role: "buyer" },
      unauthorized: null,
    });
    mocks.checkSharedRateLimit.mockReset().mockResolvedValue({ allowed: true });
    mocks.beginProfilePhoneVerification.mockReset().mockResolvedValue({
      phone: "+972541234567",
      code: "482901",
    });
    mocks.sendPhoneVerificationCode.mockReset().mockResolvedValue({
      ok: true,
      provider: "whatsapp",
      channel: "whatsapp",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns email-only mode without rate limiting, persisting, or sending a code", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "false");
    const request = new Request("https://example.test/api/alpha-exchange/phone/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+972541234567" }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Phone verification is disabled. Email verification is the active verification method.",
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    });
    expect(mocks.checkSharedRateLimit).not.toHaveBeenCalled();
    expect(mocks.beginProfilePhoneVerification).not.toHaveBeenCalled();
    expect(mocks.sendPhoneVerificationCode).not.toHaveBeenCalled();
  });

  it("passes the persisted code to the selected provider without returning it", async () => {
    const request = new Request("https://example.test/api/alpha-exchange/phone/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Locale": "ar" },
      body: JSON.stringify({ phone: "+972541234567" }),
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.sendPhoneVerificationCode).toHaveBeenCalledWith({
      phone: "+972541234567",
      code: "482901",
      locale: "ar",
    });
    expect(payload).toEqual(expect.objectContaining({ ok: true, channel: "whatsapp" }));
    expect(JSON.stringify(payload)).not.toContain("482901");
  });

  it("returns a controlled unavailable response when the selected provider gate is closed", async () => {
    mocks.sendPhoneVerificationCode.mockResolvedValue({
      ok: false,
      provider: "whatsapp",
      retryable: false,
      supportCode: "OTP_PROVIDER_CONFIGURATION",
      error: "Phone verification delivery is temporarily unavailable.",
    });
    const request = new Request("https://example.test/api/alpha-exchange/phone/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+972541234567" }),
    });

    const response = await POST(request as never);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: "Phone verification delivery is temporarily unavailable.",
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    });
    expect(JSON.stringify(payload)).not.toContain("482901");
  });
});
