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

  it("does not permit either phone-verification bypass in deployed production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "buyer@example.com");

    expect(requirePhoneVerificationForTrading(buyer)?.status).toBe(403);
  });

  it.each([undefined, "false", "", "1"])("requires production verification despite a disabled or missing feature switch %j", flag => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", flag);
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", flag);
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");
    expect(isMarketplacePhoneVerificationEnabled()).toBe(true);
    expect(requirePhoneVerificationForTrading(buyer)?.status).toBe(403);
  });
});
