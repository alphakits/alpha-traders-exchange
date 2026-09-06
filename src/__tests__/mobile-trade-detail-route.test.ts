// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  getTradeRoomData: vi.fn(),
  prepareTradeEventEmails: vi.fn(),
  requireMobileApiUser: vi.fn(),
  tradeEmailEventForStatus: vi.fn(),
  updatePurchaseRequestStatus: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomData: mocks.getTradeRoomData,
  updatePurchaseRequestStatus: mocks.updatePurchaseRequestStatus,
}));
vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeEventEmails: mocks.prepareTradeEventEmails,
  tradeEmailEventForStatus: mocks.tradeEmailEventForStatus,
}));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { GET, PATCH } from "@/app/api/mobile/v1/trades/[requestId]/route";

function request(method: "GET" | "PATCH", body?: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/trades/purchase-1", {
    method,
    headers: {
      "authorization": "Bearer token",
      "content-type": "application/json",
      "x-app-version": "1.0.0",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-platform": "ios",
      "x-request-id": "trade-detail-request",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function room(overrides: Record<string, unknown> = {}) {
  return {
    request: {
      id: "purchase-1",
      displayNumber: 12,
      buyerId: "buyer-1",
      sellerId: "private-seller-id",
      listingId: "private-listing-id",
      buyerName: "Buyer One",
      buyerWhatsapp: "+972500000000",
      buyerNotes: "private note",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      sellerBankAccountId: "private-bank-id",
      usdtAmount: "500",
      fiatAmount: "1650.00",
      pricePerUsdt: "3.30",
      listingPriceAtRequest: "3.30",
      priceMode: "listing_price",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      timeline: [{
        id: "private-timeline-id",
        type: "request_accepted",
        actorUserId: "private-seller-id",
        actorRole: "approved_seller",
        message: "private raw message",
        createdAt: "2026-09-06T12:00:00.000Z",
      }],
      buyerEvidence: { id: "private-evidence-id" },
      status: "accepted",
      createdAt: "2026-09-06T11:00:00.000Z",
      updatedAt: "2026-09-06T12:00:00.000Z",
      ...overrides,
    },
    listing: { id: "private-listing-id", notes: "seller secret" },
    counterpart: { buyerName: "Buyer One", sellerName: "Verified Seller" },
    messages: [{
      id: "private-message-id",
      purchaseRequestId: "purchase-1",
      kind: "user",
      senderUserId: "private-seller-id",
      senderRole: "approved_seller",
      message: "Ready when you are",
      createdAt: "2026-09-06T12:01:00.000Z",
      readByUserIds: ["private-seller-id"],
    }],
    poke: {},
    deadlineAt: null,
    timeRemainingSeconds: null,
    releaseDeadlineActive: false,
    releaseDeadlineOverdue: false,
    hasOpenDispute: false,
    canOpenDispute: false,
    isOverdue: false,
    sellerCommissionDueAmount: 0,
    sellerCommissionDueCount: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user: { id: "buyer-1", role: "buyer" },
    accessToken: "access",
    unauthorized: null,
  });
  mocks.getTradeRoomData.mockResolvedValue(room());
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.tradeEmailEventForStatus.mockReturnValue(null);
  mocks.updatePurchaseRequestStatus.mockResolvedValue({
    request: room({ status: "cancelled" }).request,
    statusChanged: true,
    additionallyDeclinedRequests: [],
  });
});

describe("mobile trade detail route", () => {
  it("returns a whitelist projection without internal party, listing, timeline, evidence, or message identifiers", async () => {
    const response = await GET(request("GET"), { params: Promise.resolve({ requestId: "purchase-1" }) });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.trade).toMatchObject({
      id: "purchase-1",
      side: "buyer",
      counterpartyDisplayName: "Verified Seller",
      actions: { canViewBankDetails: true },
      timeline: [{ type: "request_accepted" }],
      messages: [{ sender: "counterparty", message: "Ready when you are" }],
    });
    for (const value of [
      "private-seller-id",
      "private-listing-id",
      "private-bank-id",
      "private-timeline-id",
      "private raw message",
      "private-evidence-id",
      "private-message-id",
      "+972500000000",
      "private note",
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(mocks.getTradeRoomData).toHaveBeenCalledWith(expect.objectContaining({ markMessagesRead: true }));
  });

  it("conceals non-participant trades from ordinary native sessions", async () => {
    mocks.getTradeRoomData.mockRejectedValueOnce(new Error("You are not allowed to access trade evidence."));

    const response = await GET(request("GET"), { params: Promise.resolve({ requestId: "purchase-1" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "TRADE_NOT_FOUND" } });
  });

  it("conceals non-participant trades from privileged native sessions", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: { id: "owner-1", role: "owner" },
      accessToken: "access",
      unauthorized: null,
    });

    const response = await GET(request("GET"), { params: Promise.resolve({ requestId: "purchase-1" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "TRADE_NOT_FOUND" } });
  });

  it("passes an allowed participant transition to the canonical store", async () => {
    const response = await PATCH(request("PATCH", { status: "cancelled", safetyAcknowledged: false }), {
      params: Promise.resolve({ requestId: "purchase-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updatePurchaseRequestStatus).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "purchase-1",
      actorUserId: "buyer-1",
      actorRole: "buyer",
      nextStatus: "cancelled",
    }));
  });

  it("blocks a non-participant before calling the mutation store", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: { id: "owner-1", role: "owner" },
      accessToken: "access",
      unauthorized: null,
    });

    const response = await PATCH(request("PATCH", { status: "accepted" }), {
      params: Promise.resolve({ requestId: "purchase-1" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.updatePurchaseRequestStatus).not.toHaveBeenCalled();
  });
});
