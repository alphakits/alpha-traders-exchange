import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runEnvValidation, validateEnv } from "@/lib/env-validation";
import { getPhoneVerificationChannels } from "@/lib/phone-verification-delivery";
import {
  getWhatsAppAuthenticationReadiness,
  getWhatsAppCloudReadiness,
  WHATSAPP_AUTHENTICATION_TEMPLATE_NAME,
  WHATSAPP_EVENT_TEMPLATES,
} from "@/lib/whatsapp-platform";

const accountSid = `AC${"a".repeat(32)}`;
const contentSid = `HX${"b".repeat(32)}`;
const serviceSid = `MG${"c".repeat(32)}`;
const templateMapping = { en: contentSid, ar: contentSid };

beforeEach(() => {
  for (const key of [
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
    "TWILIO_SMS_FROM", "TWILIO_SMS_MESSAGING_SERVICE_SID",
    "TWILIO_WHATSAPP_FROM", "TWILIO_WHATSAPP_CONTENT_SIDS",
    "ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED",
    "ALPHA_EXCHANGE_TWILIO_SEND_ENABLED", "ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED",
    "ALPHA_EXCHANGE_WHATSAPP_PROVIDER", "ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED",
    "ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED", "ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED",
    "ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED", "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED",
    "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE", "ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET",
    "META_WHATSAPP_WABA_ID", "META_WHATSAPP_PHONE_NUMBER_ID", "META_WHATSAPP_ACCESS_TOKEN",
    "META_WHATSAPP_GRAPH_VERSION", "META_WHATSAPP_APP_SECRET", "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  ]) vi.stubEnv(key, "");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("SUPABASE_DB_URL", "postgresql://test.invalid/test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "disabled");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function configureSms() {
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "twilio");
  vi.stubEnv("ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED", "true");
  vi.stubEnv("TWILIO_ACCOUNT_SID", accountSid);
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
}

function configureWhatsApp(authentication: boolean) {
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PROVIDER", "twilio");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED", "true");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE", "test-written-policy-clearance");
  vi.stubEnv("TWILIO_ACCOUNT_SID", accountSid);
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
  vi.stubEnv("TWILIO_WHATSAPP_FROM", "whatsapp:+15551234567");
  if (authentication) {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "whatsapp");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED", "true");
    vi.stubEnv("TWILIO_WHATSAPP_CONTENT_SIDS", JSON.stringify({
      [WHATSAPP_AUTHENTICATION_TEMPLATE_NAME]: templateMapping,
    }));
  } else {
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET", "f".repeat(32));
    vi.stubEnv("TWILIO_WHATSAPP_CONTENT_SIDS", JSON.stringify(Object.fromEntries(
      Object.values(WHATSAPP_EVENT_TEMPLATES).map(template => [template.name, templateMapping]),
    )));
  }
}

describe("production messaging configuration", () => {
  it.each([
    ["TWILIO_SMS_FROM", "AlphaTrader"],
    ["TWILIO_SMS_FROM", "+15551234567"],
    ["TWILIO_SMS_MESSAGING_SERVICE_SID", serviceSid],
    ["TWILIO_PHONE_NUMBER", "+15551234567"],
  ])("accepts the configured SMS identity in %s", (key, value) => {
    configureSms();
    vi.stubEnv(key, value);
    expect(getPhoneVerificationChannels()).toEqual({ sms: true, whatsapp: false });
    expect(validateEnv().errors).toEqual([]);
  });

  it.each([
    ["TWILIO_SMS_FROM", "123456"],
    ["TWILIO_SMS_FROM", "SenderTooLong"],
    ["TWILIO_SMS_MESSAGING_SERVICE_SID", "MG-invalid"],
  ])("rejects an invalid explicit %s despite a valid legacy sender", (key, value) => {
    configureSms();
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15551234567");
    vi.stubEnv(key, value);
    expect(getPhoneVerificationChannels().sms).toBe(false);
    expect(validateEnv().errors.join("\n")).toContain(key);
  });

  it("accepts Twilio WhatsApp authentication without Meta or Utility configuration", () => {
    configureWhatsApp(true);
    expect(getWhatsAppAuthenticationReadiness().readyToSend).toBe(true);
    expect(getWhatsAppCloudReadiness().readyToSend).toBe(false);
    expect(getPhoneVerificationChannels()).toEqual({ sms: false, whatsapp: true });
    expect(validateEnv().errors).toEqual([]);
  });

  it("starts with both selectable channels without requiring a legacy SMS number", () => {
    configureWhatsApp(true);
    configureSms();
    vi.stubEnv("TWILIO_SMS_FROM", "AlphaTrader");
    expect(getPhoneVerificationChannels()).toEqual({ sms: true, whatsapp: true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => runEnvValidation()).not.toThrow();
  });

  it("accepts Twilio WhatsApp Utility notifications without Meta or authentication configuration", () => {
    configureWhatsApp(false);
    expect(getWhatsAppCloudReadiness().readyToSend).toBe(true);
    expect(getWhatsAppAuthenticationReadiness().readyToSend).toBe(false);
    expect(validateEnv().errors).toEqual([]);
  });

  it.each([
    ["TWILIO_ACCOUNT_SID", "AC-invalid"],
    ["TWILIO_AUTH_TOKEN", ""],
    ["TWILIO_WHATSAPP_FROM", "AlphaTrader"],
    ["TWILIO_WHATSAPP_CONTENT_SIDS", "invalid JSON"],
    ["TWILIO_WHATSAPP_CONTENT_SIDS", JSON.stringify({ alpha_phone_verification: { en: contentSid } })],
  ])("rejects invalid Twilio WhatsApp %s without asking for unrelated Meta settings", (key, value) => {
    configureWhatsApp(true);
    vi.stubEnv(key, value);
    expect(getWhatsAppAuthenticationReadiness().readyToSend).toBe(false);
    const errors = validateEnv().errors.join("\n");
    expect(errors).toContain(key);
    expect(errors).not.toContain("META_WHATSAPP");
  });

  it.each(Object.values(WHATSAPP_EVENT_TEMPLATES).map(template => template.name))(
    "requires both languages of the enabled Utility template %s", templateName => {
      configureWhatsApp(false);
      const templates = JSON.parse(process.env.TWILIO_WHATSAPP_CONTENT_SIDS!);
      delete templates[templateName].ar;
      vi.stubEnv("TWILIO_WHATSAPP_CONTENT_SIDS", JSON.stringify(templates));
      expect(getWhatsAppCloudReadiness().readyToSend).toBe(false);
      expect(validateEnv().errors.join("\n")).toContain("TWILIO_WHATSAPP_CONTENT_SIDS");
    },
  );

  it.each([
    "ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED",
    "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED",
    "ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE",
  ])("preserves the Twilio WhatsApp approval requirement %s", key => {
    configureWhatsApp(true);
    vi.stubEnv(key, "");
    expect(getWhatsAppAuthenticationReadiness().readyToSend).toBe(false);
    expect(validateEnv().errors.join("\n")).toContain(key);
  });

  it.each(["", "too-short"])("requires a dedicated, strong Twilio WhatsApp consent fingerprint secret (%j)", value => {
    configureWhatsApp(false);
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET", value);
    expect(validateEnv().errors.join("\n")).toContain("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET");
  });

  it("does not validate unused Meta configuration for the selected Twilio provider", () => {
    configureWhatsApp(true);
    vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "invalid");
    vi.stubEnv("META_WHATSAPP_WABA_ID", "invalid");
    expect(validateEnv().errors).toEqual([]);
  });

  it("rejects an unknown WhatsApp provider", () => {
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PROVIDER", "automatic");
    expect(validateEnv().errors.join("\n")).toContain("ALPHA_EXCHANGE_WHATSAPP_PROVIDER");
  });
});
