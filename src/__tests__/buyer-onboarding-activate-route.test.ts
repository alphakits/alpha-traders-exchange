import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requireEmailVerificationForTrading: vi.fn(),
  activateBuyerOnboardingWithoutPhone: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  activateBuyerOnboardingWithoutPhone: mocks.activateBuyerOnboardingWithoutPhone,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  createRateLimitResponse: mocks.createRateLimitResponse,
}));

import { POST } from "@/app/api/auth/onboarding/buyer/activate/route";

describe("buyer onboarding activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", role: "buyer", emailVerified: true, verifiedPhone: "", phoneVerifiedAt: "" },
      unauthorized: null,
    });
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
    mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.activateBuyerOnboardingWithoutPhone.mockResolvedValue({
      id: "buyer-1",
      role: "buyer",
      roles: ["buyer"],
      onboardingSelection: "buyer",
      onboardingCompletedAt: "2026-08-22T00:00:00.000Z",
    });
  });

  it("activates a verified-email Buyer without a phone or OTP", async () => {
    const response = await POST(new NextRequest("http://localhost/api/auth/onboarding/buyer/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Buyer", lastName: "User", displayName: "Buyer User" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.activateBuyerOnboardingWithoutPhone).toHaveBeenCalledWith({
      userId: "buyer-1",
      firstName: "Buyer",
      lastName: "User",
      displayName: "Buyer User",
    });
  });

  it("rejects an unverified email before changing Buyer onboarding state", async () => {
    mocks.requireEmailVerificationForTrading.mockReturnValueOnce(
      NextResponse.json({ code: "EMAIL_VERIFICATION_REQUIRED" }, { status: 403 }),
    );
    const response = await POST(new NextRequest("http://localhost/api/auth/onboarding/buyer/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Buyer", lastName: "User" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.activateBuyerOnboardingWithoutPhone).not.toHaveBeenCalled();
  });
});
