// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  beginBuyerVerification: vi.fn(),
  beginProfilePhoneVerification: vi.fn(),
  completeBuyerVerification: vi.fn(),
  confirmProfilePhoneVerification: vi.fn(),
  findUserById: vi.fn(),
  recordBuyerVerificationAttempt: vi.fn(),
  sendPhoneVerificationCode: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  beginBuyerVerification: mocks.beginBuyerVerification,
  beginProfilePhoneVerification: mocks.beginProfilePhoneVerification,
  completeBuyerVerification: mocks.completeBuyerVerification,
  confirmProfilePhoneVerification: mocks.confirmProfilePhoneVerification,
  findUserById: mocks.findUserById,
  recordBuyerVerificationAttempt: mocks.recordBuyerVerificationAttempt,
}));
vi.mock("@/lib/phone-verification-delivery", () => ({
  sendPhoneVerificationCode: mocks.sendPhoneVerificationCode,
}));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { POST as sendOtp } from "@/app/api/auth/onboarding/buyer/send-otp/route";
import { POST as verifyOtp } from "@/app/api/auth/onboarding/buyer/verify-otp/route";

function request(path: "send-otp" | "verify-otp", body: Record<string, unknown>) {
  return new Request(`https://example.test/api/auth/onboarding/buyer/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("buyer phone verification routes in email-only mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED", "false");
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", role: "buyer" },
      unauthorized: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not persist or deliver a buyer phone code", async () => {
    const response = await sendOtp(request("send-otp", {
      firstName: "Buyer",
      lastName: "User",
      phone: "+972541234567",
    }) as never);

    expect(response.status).toBe(503);
    expect(mocks.checkSharedRateLimit).not.toHaveBeenCalled();
    expect(mocks.beginBuyerVerification).not.toHaveBeenCalled();
    expect(mocks.beginProfilePhoneVerification).not.toHaveBeenCalled();
    expect(mocks.sendPhoneVerificationCode).not.toHaveBeenCalled();
  });

  it("does not read, confirm, or complete a buyer phone code", async () => {
    const response = await verifyOtp(request("verify-otp", {
      phone: "+972541234567",
      token: "482901",
    }) as never);

    expect(response.status).toBe(503);
    expect(mocks.checkSharedRateLimit).not.toHaveBeenCalled();
    expect(mocks.findUserById).not.toHaveBeenCalled();
    expect(mocks.confirmProfilePhoneVerification).not.toHaveBeenCalled();
    expect(mocks.completeBuyerVerification).not.toHaveBeenCalled();
    expect(mocks.recordBuyerVerificationAttempt).not.toHaveBeenCalled();
  });
});
