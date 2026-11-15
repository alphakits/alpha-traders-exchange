import { afterEach, describe, expect, it, vi } from "vitest";
import { requireMarketplaceVerificationForTrading, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import {
  isMarketplacePhoneVerificationEmailFallbackActive,
  isMarketplacePhoneVerificationEnabled,
  isMarketplacePhoneVerificationRequired,
  marketplacePhoneVerificationEmailFallbackUntilDate,
} from "@/lib/phone-verification";

describe("marketplace phone verification flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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

  it("allows only the bounded production email fallback without marking phones verified", async () => {
    const now = Date.parse("2026-11-15T13:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_EMAIL_FALLBACK_UNTIL", "2026-11-22T13:00:00.000Z");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED", "true");
    const adultConfirmedBuyer = {
      ...buyer,
      emailVerified: true,
      ageEligibility: { method: "self_attestation_v1", confirmedAt: "2026-11-15T12:00:00.000Z" },
    };

    expect(isMarketplacePhoneVerificationEmailFallbackActive()).toBe(true);
    expect(marketplacePhoneVerificationEmailFallbackUntilDate()).toBe("2026-11-22");
    expect(isMarketplacePhoneVerificationEnabled()).toBe(false);
    expect(isMarketplacePhoneVerificationRequired()).toBe(false);
    expect(requirePhoneVerificationForTrading(adultConfirmedBuyer)).toBeNull();
    const unconfirmedEmail = requireMarketplaceVerificationForTrading({
      ...adultConfirmedBuyer,
      emailVerified: false,
    });
    expect(unconfirmedEmail?.status).toBe(403);
    expect(await unconfirmedEmail?.json()).toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
    expect(buyer).not.toHaveProperty("verifiedPhone");
    expect(buyer).not.toHaveProperty("phoneVerifiedAt");
  });

  it.each([
    "2026-11-15T12:59:59.999Z",
    "2026-11-22T13:00:00.001Z",
    "2026-11-22T13:00:00.000+00:00",
    "2026-02-30T13:00:00.000Z",
    "not-a-date",
  ])("fails closed for expired, overlong, or invalid fallback deadline %s", deadline => {
    const now = Date.parse("2026-11-15T13:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_EMAIL_FALLBACK_UNTIL", deadline);

    expect(isMarketplacePhoneVerificationEmailFallbackActive()).toBe(false);
    expect(isMarketplacePhoneVerificationEnabled()).toBe(true);
    expect(isMarketplacePhoneVerificationRequired()).toBe(true);
    expect(requirePhoneVerificationForTrading(buyer)?.status).toBe(403);
  });
});
