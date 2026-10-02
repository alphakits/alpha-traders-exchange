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
import { NextRequest } from "next/server";

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

  it("sets the secure verification cookie only after accepting a code", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    mocks.confirmProfilePhoneVerification.mockResolvedValue({ verifiedPhone: "+972541234567" });
    const response = await POST(new NextRequest("https://example.test/api/alpha-exchange/phone/verify-code", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+972541234567", code: "482901" }),
    }));
    expect(response.status).toBe(200);
    expect(response.cookies.get("alpha_exchange_phone_verified")?.value).toBe("1");
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/);
  });
  it("does not set a verification cookie for a rejected code", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "true");
    mocks.confirmProfilePhoneVerification.mockRejectedValue(new Error("Invalid verification code."));
    const response = await POST(new NextRequest("https://example.test/api/alpha-exchange/phone/verify-code", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+972541234567", code: "000000" }),
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
