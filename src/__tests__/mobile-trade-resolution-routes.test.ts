// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkSharedRateLimit: vi.fn(),
  getTradeRoomData: vi.fn(),
  logEvent: vi.fn(),
  openTradeDispute: vi.fn(),
  requireMobileApiUser: vi.fn(),
  submitBuyerTradeReview: vi.fn(),
  submitSellerReviewResponse: vi.fn(),
}));

vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomData: mocks.getTradeRoomData,
  openTradeDispute: mocks.openTradeDispute,
  submitBuyerTradeReview: mocks.submitBuyerTradeReview,
  submitSellerReviewResponse: mocks.submitSellerReviewResponse,
}));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { POST as openDispute } from "@/app/api/mobile/v1/trades/[requestId]/dispute/route";
import { POST as submitReview } from "@/app/api/mobile/v1/trades/[requestId]/review/route";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";

function request(path: "dispute" | "review", body: Record<string, unknown>, locale = "en") {
  return new NextRequest(`https://www.alphatraders.co.il/api/mobile/v1/trades/purchase-1/${path}`, {
    method: "POST",
    headers: {
      "accept-language": locale,
      "authorization": "Bearer token",
      "content-type": "application/json",
      "x-app-version": "1.0.0",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-platform": "ios",
      "x-request-id": "trade-resolution-request",
    },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ requestId: "purchase-1" }) };
}

function room(
  requestOverrides: Record<string, unknown> = {},
  roomOverrides: Record<string, unknown> = {},
) {
  return {
    request: {
      id: "purchase-1",
      displayNumber: 44,
      buyerId: "buyer-1",
      sellerId: "private-seller-id",
      listingId: "private-listing-id",
      buyerName: "Buyer",
      usdtAmount: "500",
      fiatAmount: "1650.00",
      pricePerUsdt: "3.30",
      listingPriceAtRequest: "3.30",
      priceMode: "listing_price",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      timeline: [],
      status: "payment_sent",
      createdAt: "2026-09-06T11:00:00.000Z",
      updatedAt: "2026-09-06T12:00:00.000Z",
      ...requestOverrides,
    },
    listing: null,
    counterpart: { buyerName: "Buyer", sellerName: "Verified Seller" },
    messages: [],
    poke: {},
    deadlineAt: null,
    timeRemainingSeconds: null,
    releaseDeadlineActive: false,
    releaseDeadlineOverdue: false,
    hasOpenDispute: false,
    canOpenDispute: true,
    isOverdue: false,
    sellerCommissionDueAmount: 0,
    sellerCommissionDueCount: 0,
    ...roomOverrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user: { id: "buyer-1", role: "buyer" },
    accessToken: "access",
    unauthorized: null,
  });
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.openTradeDispute.mockResolvedValue({ id: "private-dispute-id", reason: "Funds are missing" });
  mocks.submitBuyerTradeReview.mockResolvedValue({ review: {}, sellerProgress: {} });
  mocks.submitSellerReviewResponse.mockResolvedValue({});
});

describe("mobile trade disputes", () => {
  it("derives the buyer identity and returns only the refreshed trade projection", async () => {
    mocks.getTradeRoomData
      .mockResolvedValueOnce(room())
      .mockResolvedValueOnce(room({}, { hasOpenDispute: true, canOpenDispute: false }));

    const response = await openDispute(request("dispute", {
      reason: "Funds are missing",
      openedByUserId: "private-seller-id",
      purchaseRequestId: "another-trade",
    }), context());
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(mocks.openTradeDispute).toHaveBeenCalledWith({
      purchaseRequestId: "purchase-1",
      openedByUserId: "buyer-1",
      reason: "Funds are missing",
    });
    expect(payload.trade).toMatchObject({ id: "purchase-1", hasOpenDispute: true });
    expect(serialized).not.toContain("private-dispute-id");
    expect(serialized).not.toContain("Funds are missing");
    expect(serialized).not.toContain("private-seller-id");
  });

  it("does not let a seller or privileged non-participant open the buyer dispute flow", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: { id: "private-seller-id", role: "approved_seller" },
      accessToken: "access",
      unauthorized: null,
    });
    mocks.getTradeRoomData.mockResolvedValueOnce(room());
    const sellerResponse = await openDispute(request("dispute", { reason: "A valid reason" }), context());
    expect(sellerResponse.status).toBe(409);

    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: { id: "owner-1", role: "owner" },
      accessToken: "access",
      unauthorized: null,
    });
    mocks.getTradeRoomData.mockResolvedValueOnce(room());
    const ownerResponse = await openDispute(request("dispute", { reason: "A valid reason" }), context());
    expect(ownerResponse.status).toBe(404);
    expect(mocks.openTradeDispute).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized reason before the canonical mutation", async () => {
    mocks.getTradeRoomData.mockResolvedValue(room());

    const response = await openDispute(request("dispute", { reason: " " }), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "DISPUTE_INVALID" } });
    expect(mocks.openTradeDispute).not.toHaveBeenCalled();
  });
});

describe("mobile verified trade reviews", () => {
  it("submits a buyer review with server-owned identity and excludes private review identifiers", async () => {
    mocks.getTradeRoomData
      .mockResolvedValueOnce(room({ status: "review_open" }, { canOpenDispute: false }))
      .mockResolvedValueOnce(room({
        status: "review_open",
        buyerReview: {
          reviewerUserId: "buyer-1",
          rating: 5,
          comment: "Clear and fast",
          createdAt: "2026-09-06T13:00:00.000Z",
        },
      }, { canOpenDispute: false }));

    const response = await submitReview(request("review", {
      rating: 5,
      comment: "Clear and fast",
      buyerUserId: "private-seller-id",
      mode: "seller_response",
    }), context());
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(mocks.submitBuyerTradeReview).toHaveBeenCalledWith({
      requestId: "purchase-1",
      buyerUserId: "buyer-1",
      rating: 5,
      comment: "Clear and fast",
    });
    expect(mocks.submitSellerReviewResponse).not.toHaveBeenCalled();
    expect(payload.trade.buyerReview).toEqual({
      rating: 5,
      comment: "Clear and fast",
      createdAt: "2026-09-06T13:00:00.000Z",
    });
    expect(serialized).not.toContain("reviewerUserId");
    expect(serialized).not.toContain("private-seller-id");
  });

  it("derives a seller response from the authenticated side instead of a client mode", async () => {
    mocks.requireMobileApiUser.mockResolvedValue({
      user: { id: "private-seller-id", role: "approved_seller" },
      accessToken: "access",
      unauthorized: null,
    });
    const buyerReview = {
      reviewerUserId: "buyer-1",
      rating: 4,
      comment: "Good trade",
      createdAt: "2026-09-06T13:00:00.000Z",
    };
    mocks.getTradeRoomData
      .mockResolvedValueOnce(room({ status: "review_open", buyerReview }, { canOpenDispute: false }))
      .mockResolvedValueOnce(room({
        status: "review_open",
        buyerReview,
        sellerResponse: {
          responderUserId: "private-seller-id",
          message: "Thank you",
          createdAt: "2026-09-06T14:00:00.000Z",
        },
      }, { canOpenDispute: false }));

    const response = await submitReview(request("review", {
      message: "Thank you",
      mode: "buyer_review",
      rating: 1,
      comment: "forged",
    }), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.submitSellerReviewResponse).toHaveBeenCalledWith({
      requestId: "purchase-1",
      sellerUserId: "private-seller-id",
      message: "Thank you",
    });
    expect(mocks.submitBuyerTradeReview).not.toHaveBeenCalled();
    expect(payload.trade.buyerReview.sellerResponse).toEqual({
      message: "Thank you",
      createdAt: "2026-09-06T14:00:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("responderUserId");
  });

  it("validates ratings and preserves direct-contact blocking", async () => {
    mocks.getTradeRoomData.mockResolvedValue(room({ status: "review_open" }, { canOpenDispute: false }));
    const invalid = await submitReview(request("review", { rating: 6, comment: "No" }), context());
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: "REVIEW_INVALID" } });

    mocks.getTradeRoomData.mockResolvedValueOnce(room({ status: "review_open" }, { canOpenDispute: false }));
    mocks.submitBuyerTradeReview.mockRejectedValueOnce(new Error(DIRECT_CONTACT_CONTENT_ERROR));
    const blocked = await submitReview(request("review", { rating: 3, comment: "Call me" }, "ar"), context());
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toMatchObject({ error: { code: "DIRECT_CONTACT_BLOCKED" } });
  });
});
