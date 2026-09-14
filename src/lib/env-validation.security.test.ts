import { afterEach, describe, expect, it, vi } from "vitest";

import { validateEnv } from "@/lib/env-validation";

describe("production environment safety validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects bypass, QA, test-support, in-memory, and diagnostic flags in a deployed runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_ENABLE_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");
    vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "1");
    vi.stubEnv("ALPHA_EXCHANGE_QA_MODE", "1");
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "test@example.com");
    vi.stubEnv("AUTH_COOKIE_SECURE", "false");

    const { errors } = validateEnv();
    expect(errors.join("\n")).toContain("ALPHA_ENABLE_TEST_SUPPORT");
    expect(errors.join("\n")).toContain("ALPHA_E2E_TEST_SUPPORT");
    expect(errors.join("\n")).toContain("ALPHA_E2E_LOOPBACK_ONLY");
    expect(errors.join("\n")).toContain("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY");
    expect(errors.join("\n")).toContain("ALPHA_EXCHANGE_QA_MODE");
    expect(errors.join("\n")).toContain("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION");
    expect(errors.join("\n")).toContain("PHOTO_VERIFICATION_BYPASS_EMAILS");
    expect(errors.join("\n")).toContain("AUTH_COOKIE_SECURE=false");
  });

  it("requires marketplace relay credentials as an all-or-none production configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DISCORD_MARKETPLACE_API_KEY", "configured");

    const { errors } = validateEnv();
    expect(errors.join("\n")).toContain("DISCORD_MARKETPLACE_WEBHOOK_URL");
    expect(errors.join("\n")).toContain("DISCORD_MARKETPLACE_WEBHOOK_SECRET");
  });

  it("fails closed when WhatsApp is enabled without written policy clearance and complete server credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED", "false");

    const { errors } = validateEnv();
    const message = errors.join("\n");
    expect(message).toContain("written Meta policy clearance");
    expect(message).toContain("META_WHATSAPP_ACCESS_TOKEN");
    expect(message).toContain("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE");
  });

  it("accepts a complete, explicitly approved WhatsApp configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_CONSENT_UI_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE", "META-CASE-123");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("META_WHATSAPP_WABA_ID", "123456789");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "987654321");
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "server-token");
    vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "v23.0");
    vi.stubEnv("META_WHATSAPP_APP_SECRET", "server-app-secret");
    vi.stubEnv("META_WHATSAPP_WEBHOOK_VERIFY_TOKEN", "server-verify-token");

    const { errors } = validateEnv();
    expect(errors.filter((error) => error.includes("WhatsApp") || error.includes("META_WHATSAPP"))).toEqual([]);
  });

  it("rejects an invalid phone verification provider", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "automatic");

    const { errors } = validateEnv();
    expect(errors.join("\n")).toContain("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER must be disabled, twilio, or whatsapp");
  });

  it("keeps phone verification and Twilio disabled by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "twilio");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "configured-sid");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "configured-token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15550000000");

    const { errors } = validateEnv();
    const phoneOrTwilioErrors = errors.filter((error) => (
      error.includes("Phone verification")
      || error.includes("phone verification")
      || error.includes("Twilio")
      || error.includes("TWILIO_")
    ));
    expect(phoneOrTwilioErrors).toEqual([]);
  });

  it("requires an explicit provider when phone verification is enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "disabled");

    const { errors } = validateEnv();
    expect(errors.join("\n")).toContain("Phone verification requires an explicit twilio or whatsapp provider");
  });

  it("requires the separate exact-true Twilio send gate for Twilio phone verification", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "twilio");
    vi.stubEnv("ALPHA_EXCHANGE_TWILIO_SEND_ENABLED", "1");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "configured-sid");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "configured-token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15550000000");

    const { errors } = validateEnv();
    expect(errors.join("\n")).toContain("Twilio phone verification requires ALPHA_EXCHANGE_TWILIO_SEND_ENABLED=true");
  });

  it("requires complete Twilio credentials only when its send gate is explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_TWILIO_SEND_ENABLED", "true");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "configured-sid");

    const { errors } = validateEnv();
    const message = errors.join("\n");
    expect(message).toContain("TWILIO_AUTH_TOKEN");
    expect(message).toContain("TWILIO_PHONE_NUMBER");
  });

  it("keeps WhatsApp authentication independent from Utility notification sending", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "whatsapp");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED", "false");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE", "META-CASE-OTP-123");
    vi.stubEnv("META_WHATSAPP_WABA_ID", "123456789");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "987654321");
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "server-token");
    vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "v23.0");

    const { errors } = validateEnv();
    expect(errors.filter((error) => error.includes("WhatsApp") || error.includes("META_WHATSAPP") || error.includes("PHONE_VERIFICATION_PROVIDER"))).toEqual([]);
  });

  it("rejects malformed Meta WhatsApp account identifiers", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "whatsapp");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_POLICY_APPROVAL_REFERENCE", "META-CASE-OTP-123");
    vi.stubEnv("META_WHATSAPP_WABA_ID", "not-a-number");
    vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "123-invalid");
    vi.stubEnv("META_WHATSAPP_ACCESS_TOKEN", "server-token");
    vi.stubEnv("META_WHATSAPP_GRAPH_VERSION", "v23.0");

    const { errors } = validateEnv();
    const message = errors.join("\n");
    expect(message).toContain("META_WHATSAPP_WABA_ID must contain digits only");
    expect(message).toContain("META_WHATSAPP_PHONE_NUMBER_ID must contain digits only");
  });

  it("refuses WhatsApp phone verification until its send and template gates are explicit", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "whatsapp");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED", "false");
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED", "false");

    const { errors } = validateEnv();
    const message = errors.join("\n");
    expect(message).toContain("ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED=true");
    expect(message).toContain("ALPHA_EXCHANGE_WHATSAPP_AUTH_TEMPLATE_APPROVED=true");
  });
});
