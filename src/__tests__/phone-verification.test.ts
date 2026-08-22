import { afterEach, describe, expect, it, vi } from "vitest";
import { requirePhoneVerificationForTrading } from "@/lib/api-auth";

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

  it("requires phone verification when the bypass is disabled", () => {
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "0");
    expect(requirePhoneVerificationForTrading(buyer)?.status).toBe(403);
  });

  it("allows marketplace actions while the temporary bypass is enabled without marking the phone verified", () => {
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    expect(requirePhoneVerificationForTrading(buyer)).toBeNull();
    expect(buyer).not.toHaveProperty("verifiedPhone");
    expect(buyer).not.toHaveProperty("phoneVerifiedAt");
  });

  it("does not permit either phone-verification bypass in deployed production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "buyer@example.com");

    expect(requirePhoneVerificationForTrading(buyer)?.status).toBe(403);
  });
});
