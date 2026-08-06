import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  requirePhoneVerificationForTrading: vi.fn(),
  checkRateLimit: vi.fn(),
  createPurchaseRequest: vi.fn(),
  getMyPurchaseRequests: vi.fn(),
  hasRole: vi.fn(),
  isVerified: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requirePhoneVerificationForTrading: mocks.requirePhoneVerificationForTrading,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/alpha-exchange-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/alpha-exchange-store")>();
  return {
    ...actual,
    createPurchaseRequest: mocks.createPurchaseRequest,
    getMyPurchaseRequests: mocks.getMyPurchaseRequests,
  };
});

vi.mock("@/lib/roles", () => ({
  hasRole: mocks.hasRole,
}));

vi.mock("@/lib/verification-bypass", () => ({
  isVerified: mocks.isVerified,
}));

vi.mock("@/lib/structured-logging", () => ({
  logEvent: mocks.logEvent,
}));

import { POST } from "@/app/api/alpha-exchange/purchase-requests/route";
import { TradeBlockedError } from "@/lib/alpha-exchange-store";

describe("purchase request route", () => {
  beforeEach(() => {
    mocks.requireApiUser.mockReset();
    mocks.requirePhoneVerificationForTrading.mockReset();
    mocks.checkRateLimit.mockReset();
    mocks.createPurchaseRequest.mockReset();
    mocks.getMyPurchaseRequests.mockReset();
    mocks.hasRole.mockReset();
    mocks.isVerified.mockReset();
    mocks.logEvent.mockReset();

    mocks.requireApiUser.mockResolvedValue({
      user: {
        id: "buyer-1",
        role: "buyer",
        email: "buyer@example.com",
        fullName: "Buyer One",
        whatsappNumber: "0500000000",
        sellerStatus: "not_seller",
      },
      unauthorized: null,
    });
    mocks.requirePhoneVerificationForTrading.mockReturnValue(null);
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.hasRole.mockImplementation((_user: unknown, role: string) => role === "buyer");
    mocks.isVerified.mockReturnValue(true);
  });

  it("preserves purchaseRequestId in details for pending buyer feedback blockers", async () => {
    mocks.createPurchaseRequest.mockRejectedValue(
      new TradeBlockedError(
        "PENDING_BUYER_FEEDBACK",
        "Please complete your feedback for your previous trade before starting a new one.",
        "trade-blocker-123",
      ),
    );

    const request = new NextRequest("http://localhost/api/alpha-exchange/purchase-requests", {
      method: "POST",
      body: JSON.stringify({
        listingId: "listing-1",
        usdtAmount: "500",
        buyerName: "Buyer One",
        buyerWhatsapp: "0500000000",
        buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    const payload = await response.json() as {
      code?: string;
      details?: { purchaseRequestId?: string; errorName?: string } | null;
    };

    expect(response.status).toBe(400);
    expect(payload.code).toBe("PENDING_BUYER_FEEDBACK");
    expect(payload.details).toMatchObject({
      purchaseRequestId: "trade-blocker-123",
      errorName: "TradeBlockedError",
    });
  });
});
