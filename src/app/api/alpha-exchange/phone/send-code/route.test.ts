import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  beginProfilePhoneVerification: vi.fn(),
  sendPhoneVerificationCode: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(),
  phoneVerificationDeliveryPreflight: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  beginProfilePhoneVerification: mocks.beginProfilePhoneVerification,
}));
vi.mock("@/lib/phone-verification-delivery", () => ({
  sendPhoneVerificationCode: mocks.sendPhoneVerificationCode,
  phoneVerificationDeliveryPreflight: mocks.phoneVerificationDeliveryPreflight,
  getPhoneVerificationChannels: () => ({ sms: true, whatsapp: true }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  createRateLimitResponse: mocks.createRateLimitResponse,
}));

import { GET, POST } from "./route";

describe("profile phone verification code delivery", () => {
  beforeEach(() => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    mocks.requireApiUser.mockReset().mockResolvedValue({
      user: { id: "user-1", role: "buyer" },
      unauthorized: null,
    });
    mocks.checkSharedRateLimit.mockReset().mockResolvedValue({ allowed: true });
    mocks.phoneVerificationDeliveryPreflight.mockReset().mockReturnValue(null);
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

  it.each(["sms", "whatsapp"])("passes an explicit %s choice to delivery", async channel => {
    const response = await POST(new Request("https://example.test/api/alpha-exchange/phone/send-code", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+972541234567", channel }),
    }) as never);
    expect(response.status).toBe(200);
    expect(mocks.sendPhoneVerificationCode).toHaveBeenCalledWith(expect.objectContaining({ channel }));
  });

  it("rejects an invalid choice before creating an account challenge", async () => {
    const response = await POST(new Request("https://example.test/api/alpha-exchange/phone/send-code", {
      method: "POST", body: JSON.stringify({ phone: "+972541234567", channel: "auto" }),
    }) as never);
    expect(response.status).toBe(400);
    expect(mocks.beginProfilePhoneVerification).not.toHaveBeenCalled();
    expect(mocks.sendPhoneVerificationCode).not.toHaveBeenCalled();
  });

  it("does not replace a challenge or consume its send allowance when a channel is unavailable", async () => {
    mocks.phoneVerificationDeliveryPreflight.mockReturnValue({ ok: false, error: "Unavailable", supportCode: "OTP_PROVIDER_CONFIGURATION" });
    const response = await POST(new Request("https://example.test/api/alpha-exchange/phone/send-code", {
      method: "POST", body: JSON.stringify({ phone: "+972541234567", channel: "whatsapp" }),
    }) as never);
    expect(response.status).toBe(503);
    expect(mocks.beginProfilePhoneVerification).not.toHaveBeenCalled();
    expect(mocks.sendPhoneVerificationCode).not.toHaveBeenCalled();
  });

  it("returns authenticated, uncached channel capabilities", async () => {
    const response = await GET();
    expect(response!.headers.get("cache-control")).toBe("no-store");
    expect(await response!.json()).toEqual({ channels: { sms: true, whatsapp: true } });
    const denied = new Response("Unauthorized", { status: 401 });
    mocks.requireApiUser.mockResolvedValue({ user: null, unauthorized: denied });
    expect(await GET()).toBe(denied);
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
