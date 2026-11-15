import { afterEach, describe, expect, it, vi } from "vitest";
import { requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";

describe("marketplace phone verification flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const buyer = {
    id: "buyer-1",
    role: "buyer",
    roles: ["buyer"],
    email: "buyer@example.com",
    emailVerified: true,
    ageEligibility: { method: "self_attestation_v1", confirmedAt: "2026-10-01T12:00:00.000Z" },
  };

  it("keeps isolated local fixtures opt-in", () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "");

    expect(isMarketplacePhoneVerificationEnabled()).toBe(false);
    expect(requirePhoneVerificationForTrading(buyer)).toBeNull();
    expect(buyer).not.toHaveProperty("verifiedPhone");
    expect(buyer).not.toHaveProperty("phoneVerifiedAt");
  });

  it("requires phone verification only when the feature is explicitly enabled", () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");

    expect(isMarketplacePhoneVerificationEnabled()).toBe(true);
    expect(requirePhoneVerificationForTrading(buyer)?.status).toBe(403);
  });

  it("does not treat legacy truthy values as feature enablement", () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "1");

    expect(isMarketplacePhoneVerificationEnabled()).toBe(false);
    expect(requirePhoneVerificationForTrading(buyer)).toBeNull();
  });

  it("allows the local test bypass without marking the phone verified", () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");

    expect(requirePhoneVerificationForTrading(buyer)).toBeNull();
    expect(buyer).not.toHaveProperty("verifiedPhone");
    expect(buyer).not.toHaveProperty("phoneVerifiedAt");
  });

  it("does not permit either phone-verification bypass in deployed production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "buyer@example.com");

    const blocked = requirePhoneVerificationForTrading(buyer);
    expect(blocked?.status).toBe(403);
    expect(await blocked?.json()).toMatchObject({ code: "PHONE_VERIFICATION_REQUIRED" });
  });

  it.each([undefined, "", "1", "no", "0", "true"])("requires production phone verification for a missing, malformed, or enabled setting %j", async flag => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", flag);
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", flag);
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");
    expect(isMarketplacePhoneVerificationEnabled()).toBe(true);
    const blocked = requirePhoneVerificationForTrading(buyer);
    expect(blocked?.status).toBe(403);
    expect(await blocked?.json()).toMatchObject({ code: "PHONE_VERIFICATION_REQUIRED" });
  });

  it("allows an adult contact-only account during an explicit production SMS outage", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "false");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "false");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER", "disabled");
    vi.stubEnv("ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED", "false");
    vi.stubEnv("ALPHA_EXCHANGE_TWILIO_SEND_ENABLED", "false");

    expect(requirePhoneVerificationForTrading(buyer)).toBeNull();
    expect(buyer).not.toHaveProperty("verifiedPhone");
    expect(buyer).not.toHaveProperty("phoneVerifiedAt");
  });
});
