import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  confirmProfilePhoneVerification: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  confirmProfilePhoneVerification: mocks.confirmProfilePhoneVerification,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  createRateLimitResponse: mocks.createRateLimitResponse,
}));

import { POST } from "./route";

describe("profile phone verification confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "user-1", role: "buyer" },
      unauthorized: null,
    });
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns email-only mode without rate limiting or confirming a code", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "false");
    const request = new Request("https://example.test/api/alpha-exchange/phone/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+972541234567", code: "482901" }),
    });

    const response = await POST(request as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Phone verification is disabled. Email verification is the active verification method.",
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    });
    expect(mocks.checkSharedRateLimit).not.toHaveBeenCalled();
    expect(mocks.confirmProfilePhoneVerification).not.toHaveBeenCalled();
  });
});
