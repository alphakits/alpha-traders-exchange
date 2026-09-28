import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getWhatsAppAuthenticationReadiness: vi.fn(),
  sendWhatsAppAuthenticationCodeWithRetry: vi.fn(),
  sendTwilioMessageWithRetry: vi.fn(),
  getBilingualOtpSms: vi.fn((code: string) => `verification:${code}`),
}));

vi.mock("@/lib/notification-platform", () => ({
  getBilingualOtpSms: mocks.getBilingualOtpSms,
  isTwilioSendEnabled: (env: NodeJS.ProcessEnv = process.env) => (
    env.ALPHA_EXCHANGE_TWILIO_SEND_ENABLED?.trim().toLowerCase() === "true"
  ),
  normalizeE164: (phone: string) => /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null,
  sendTwilioMessageWithRetry: mocks.sendTwilioMessageWithRetry,
}));

vi.mock("@/lib/whatsapp-platform", () => ({
  getWhatsAppAuthenticationReadiness: mocks.getWhatsAppAuthenticationReadiness,
  sendWhatsAppAuthenticationCodeWithRetry: mocks.sendWhatsAppAuthenticationCodeWithRetry,
}));

import {
  getPhoneVerificationProvider,
  sendPhoneVerificationCode,
} from "@/lib/phone-verification-delivery";

describe("phone verification delivery selection", () => {
  beforeEach(() => {
    mocks.getWhatsAppAuthenticationReadiness.mockReset().mockReturnValue({ readyToSend: false });
    mocks.sendWhatsAppAuthenticationCodeWithRetry.mockReset();
    mocks.sendTwilioMessageWithRetry.mockReset();
    mocks.getBilingualOtpSms.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps phone delivery disabled when Twilio credentials exist without explicit enablement", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");

    expect(getPhoneVerificationProvider()).toBe("disabled");
    await expect(sendPhoneVerificationCode({
      phone: "+15557654321",
      code: "482901",
      locale: "en",
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      provider: "disabled",
      retryable: false,
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    }));

    expect(mocks.sendTwilioMessageWithRetry).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppAuthenticationCodeWithRetry).not.toHaveBeenCalled();
  });

  it("uses Twilio only when phone verification, the provider, and the send gate are all explicitly enabled", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "twilio");
    vi.stubEnv("ALPHA_EXCHANGE_TWILIO_SEND_ENABLED", "true");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
    mocks.sendTwilioMessageWithRetry.mockResolvedValue({ ok: true, sid: "SM1", status: "queued", attempts: 1 });

    expect(getPhoneVerificationProvider()).toBe("twilio");
    await expect(sendPhoneVerificationCode({
      phone: "+15557654321",
      code: "482901",
      locale: "en",
    })).resolves.toEqual({ ok: true, provider: "twilio", channel: "sms" });

    expect(mocks.sendTwilioMessageWithRetry).toHaveBeenCalledWith({
      to: "+15557654321",
      body: "verification:482901",
    });
    expect(mocks.sendWhatsAppAuthenticationCodeWithRetry).not.toHaveBeenCalled();
  });

  it("uses only direct Meta WhatsApp when explicitly selected and ready", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "whatsapp");
    mocks.getWhatsAppAuthenticationReadiness.mockReturnValue({ readyToSend: true });
    mocks.sendWhatsAppAuthenticationCodeWithRetry.mockResolvedValue({
      ok: true,
      messageId: "wamid.otp",
      status: "accepted",
      attempts: 1,
    });

    await expect(sendPhoneVerificationCode({
      phone: "+972541234567",
      code: "482901",
      locale: "ar",
    })).resolves.toEqual({ ok: true, provider: "whatsapp", channel: "whatsapp" });

    expect(mocks.sendWhatsAppAuthenticationCodeWithRetry).toHaveBeenCalledWith({
      to: "+972541234567",
      code: "482901",
      locale: "ar",
      maxAttempts: 1,
    });
    expect(mocks.sendTwilioMessageWithRetry).not.toHaveBeenCalled();
  });

  it("fails closed without falling back when WhatsApp approval is not ready", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "whatsapp");
    mocks.getWhatsAppAuthenticationReadiness.mockReturnValue({ readyToSend: false });

    const result = await sendPhoneVerificationCode({
      phone: "+972541234567",
      code: "482901",
      locale: "en",
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      provider: "whatsapp",
      retryable: false,
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    }));
    expect(mocks.sendWhatsAppAuthenticationCodeWithRetry).not.toHaveBeenCalled();
    expect(mocks.sendTwilioMessageWithRetry).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("482901");
  });

  it("rejects invalid provider configuration and malformed inputs without sending", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "auto");
    expect(getPhoneVerificationProvider()).toBeNull();
    await expect(sendPhoneVerificationCode({
      phone: "+972541234567",
      code: "482901",
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    }));

    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "whatsapp");
    await expect(sendPhoneVerificationCode({
      phone: "+972541234567",
      code: "12345",
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    }));
    await expect(sendPhoneVerificationCode({
      phone: "0541234567",
      code: "482901",
    })).resolves.toEqual(expect.objectContaining({
      ok: false,
      supportCode: "OTP_PHONE_INVALID",
    }));
    expect(mocks.sendWhatsAppAuthenticationCodeWithRetry).not.toHaveBeenCalled();
    expect(mocks.sendTwilioMessageWithRetry).not.toHaveBeenCalled();
  });
});
