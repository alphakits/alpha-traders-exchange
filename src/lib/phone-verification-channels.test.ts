import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ readiness: vi.fn(), whatsapp: vi.fn(), sms: vi.fn() }));
vi.mock("@/lib/whatsapp-platform", () => ({ getWhatsAppAuthenticationReadiness: mocks.readiness, sendWhatsAppAuthenticationCodeWithRetry: mocks.whatsapp }));
vi.mock("@/lib/notification-platform", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/notification-platform")>(), sendTwilioMessageWithRetry: mocks.sms }));
import { getPhoneVerificationChannels, phoneVerificationDeliveryPreflight, sendPhoneVerificationCode } from "./phone-verification-delivery";
import { getTwilioSmsSender } from "./notification-platform";
import { parsePhoneVerificationChannel } from "./phone-verification-channel";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "twilio");
  vi.stubEnv("ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED", "true");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
  mocks.readiness.mockReturnValue({ provider: "meta_whatsapp_cloud", readyToSend: true });
  mocks.sms.mockResolvedValue({ ok: true, attempts: 1 });
  mocks.whatsapp.mockResolvedValue({ ok: true, attempts: 1 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("member-selected phone verification channels", () => {
  it.each([null, true, "email", "auto", {}, []])("rejects a supplied invalid channel %j", value => expect(parsePhoneVerificationChannel(value)).toBeNull());
  it("preserves omitted channels for older clients", () => expect(parsePhoneVerificationChannel(undefined)).toBeUndefined());
  it.each(["sms", "whatsapp"] as const)("sends only the explicitly chosen %s channel", async channel => {
    expect(getPhoneVerificationChannels()).toEqual({ sms: true, whatsapp: true });
    expect(await sendPhoneVerificationCode({ phone: "+972501234567", code: "482901", channel })).toMatchObject({ ok: true, channel });
    expect(mocks.sms).toHaveBeenCalledTimes(channel === "sms" ? 1 : 0);
    expect(mocks.whatsapp).toHaveBeenCalledTimes(channel === "whatsapp" ? 1 : 0);
  });
  it("keeps WhatsApp usable when only the SMS send switch is disabled", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED", "false");
    vi.stubEnv("ALPHA_EXCHANGE_TWILIO_SEND_ENABLED", "false");
    expect(getPhoneVerificationChannels()).toEqual({ sms: false, whatsapp: true });
    expect(await sendPhoneVerificationCode({ phone: "+972501234567", code: "482901", channel: "whatsapp" })).toMatchObject({ ok: true, channel: "whatsapp" });
    expect(mocks.sms).not.toHaveBeenCalled();
  });
  it("never switches channels after an ambiguous send", async () => {
    mocks.whatsapp.mockResolvedValue({ ok: false, reason: "timeout", retryable: true });
    expect(await sendPhoneVerificationCode({ phone: "+972501234567", code: "482901", channel: "whatsapp" })).toMatchObject({ ok: false });
    expect(mocks.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 1 }));
    expect(mocks.sms).not.toHaveBeenCalled();
  });
  it("checks unavailable channels and the self-sender configuration before generating a code", () => {
    mocks.readiness.mockReturnValue({ readyToSend: false });
    expect(phoneVerificationDeliveryPreflight("+972501234567", "whatsapp")).toMatchObject({ ok: false, supportCode: "OTP_PROVIDER_CONFIGURATION" });
    expect(phoneVerificationDeliveryPreflight("+15551234567", "sms")).toMatchObject({ ok: false, supportCode: "OTP_PROVIDER_CONFIGURATION" });
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+972501234567");
    expect(phoneVerificationDeliveryPreflight("050-1234567", "sms")).toMatchObject({ ok: false, supportCode: "OTP_PROVIDER_CONFIGURATION" });
  });
  it("does not allow an explicit channel to bypass the master disable switch", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "false");
    expect(getPhoneVerificationChannels()).toEqual({ sms: false, whatsapp: false });
    expect((await sendPhoneVerificationCode({ phone: "+972501234567", code: "482901", channel: "whatsapp" })).ok).toBe(false);
    expect(mocks.whatsapp).not.toHaveBeenCalled();
  });
  it("selects a deliberately configured SMS identity without changing the personal WhatsApp sender", () => {
    vi.stubEnv("TWILIO_SMS_FROM", "AlphaTrader");
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "+15551234567");
    expect(getTwilioSmsSender()).toEqual({ From: "AlphaTrader" });
    expect(phoneVerificationDeliveryPreflight("+15551234567", "sms")).toBeNull();
    vi.stubEnv("TWILIO_SMS_FROM", "invalid sender exceeding length");
    expect(getTwilioSmsSender()).toBeNull();
    expect(getPhoneVerificationChannels().sms).toBe(false);
    vi.stubEnv("TWILIO_SMS_MESSAGING_SERVICE_SID", `MG${"a".repeat(32)}`);
    expect(getTwilioSmsSender()).toEqual({ MessagingServiceSid: `MG${"a".repeat(32)}` });
  });
  it("passes no destination or code into a public channel capability response", () => {
    expect(JSON.stringify(getPhoneVerificationChannels())).toBe('{"sms":true,"whatsapp":true}');
  });
});
