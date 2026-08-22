import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  requireApiUser: vi.fn(),
  requireEmailVerificationForTrading: vi.fn(),
  checkRateLimit: vi.fn(),
  createPurchaseRequest: vi.fn(),
  getMyPurchaseRequests: vi.fn(),
  hasRole: vi.fn(),
  isVerified: vi.fn(),
  logEvent: vi.fn(),
  prepareTradeEventEmails: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkRateLimit,
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

vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeEventEmails: mocks.prepareTradeEventEmails,
}));

import { POST } from "@/app/api/alpha-exchange/purchase-requests/route";
import { TradeBlockedError } from "@/lib/alpha-exchange-store";

describe("purchase request route", () => {
  beforeEach(() => {
    mocks.requireApiUser.mockReset();
    mocks.requireEmailVerificationForTrading.mockReset();
    mocks.checkRateLimit.mockReset();
    mocks.createPurchaseRequest.mockReset();
    mocks.getMyPurchaseRequests.mockReset();
    mocks.hasRole.mockReset();
    mocks.isVerified.mockReset();
    mocks.logEvent.mockReset();
    mocks.after.mockReset();
    mocks.prepareTradeEventEmails.mockReset();

    mocks.requireApiUser.mockResolvedValue({
      user: {
        id: "buyer-1",
        role: "buyer",
        email: "buyer@example.com",
        fullName: "Buyer One",
        whatsappNumber: "0500000000",
        sellerStatus: "not_seller",
        emailVerified: true,
      },
      unauthorized: null,
    });
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
    mocks.checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
    mocks.hasRole.mockImplementation((_user: unknown, role: string) => role === "buyer");
    mocks.isVerified.mockReturnValue(true);
    mocks.prepareTradeEventEmails.mockResolvedValue(async () => {});
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

  it("allows a verified-email Buyer with no phone and ignores client contact fields", async () => {
    mocks.createPurchaseRequest.mockResolvedValue({
      request: { id: "purchase-1", paymentMethod: "Bank Transfer" },
      metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, businessMs: 0, writeDbMs: 1, sseMs: 0 },
    });
    const request = new NextRequest("http://localhost/api/alpha-exchange/purchase-requests", {
      method: "POST",
      body: JSON.stringify({
        listingId: "listing-1",
        usdtAmount: "500",
        buyerName: "spoofed name@example.test",
        buyerWhatsapp: "+972500000000",
        buyerNotes: "telegram: private-handle",
        buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mocks.createPurchaseRequest).toHaveBeenCalledWith(expect.objectContaining({
      buyerId: "buyer-1",
      buyerName: "Buyer One",
    }));
    const input = mocks.createPurchaseRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).not.toHaveProperty("buyerWhatsapp");
    expect(input).not.toHaveProperty("buyerNotes");
  });

  it("denies an unverified-email session before mutating a purchase request", async () => {
    const denied = new Response(JSON.stringify({ code: "EMAIL_VERIFICATION_REQUIRED" }), { status: 403 });
    mocks.requireEmailVerificationForTrading.mockReturnValueOnce(denied);
    const request = new NextRequest("http://localhost/api/alpha-exchange/purchase-requests", {
      method: "POST",
      body: JSON.stringify({ listingId: "listing-1" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mocks.createPurchaseRequest).not.toHaveBeenCalled();
  });
});
