// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  createPurchaseRequest: vi.fn(),
  prepareTradeEventEmails: vi.fn(),
  requireApiUser: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: () => null,
}));
vi.mock("@/lib/roles", () => ({ hasRole: () => true }));
vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeEventEmails: mocks.prepareTradeEventEmails,
}));
vi.mock("@/lib/action-destinations", () => ({
  tradeDestination: () => ({ href: "/en/usdt-exchange/trade/request-1" }),
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  createPurchaseRequest: mocks.createPurchaseRequest,
  getMyPurchaseRequests: vi.fn(),
}));

import { POST } from "@/app/api/alpha-exchange/purchase-requests/route";

function request(payload: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/alpha-exchange/purchase-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const metrics = {
  totalMs: 1,
  readDbMs: 0,
  validationMs: 0,
  businessMs: 1,
  writeDbMs: 0,
  sseMs: 0,
};

describe("purchase request price-offer API contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", fullName: "Verified Buyer", role: "buyer", roles: ["buyer"] },
      unauthorized: null,
    });
    mocks.createPurchaseRequest.mockResolvedValue({
      request: {
        id: "request-1",
        buyerId: "buyer-1",
        sellerId: "seller-1",
        listingId: "listing-1",
        status: "pending",
      },
      metrics,
    });
    mocks.prepareTradeEventEmails.mockResolvedValue(Promise.resolve());
  });

  it("passes a buyer offer and exact price to the server store", async () => {
    const response = await POST(request({
      listingId: "listing-1",
      usdtAmount: "1000",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      priceMode: "buyer_offer",
      offeredPrice: "2.95",
    }));

    expect(response.status).toBe(201);
    expect(mocks.createPurchaseRequest).toHaveBeenCalledWith(expect.objectContaining({
      buyerId: "buyer-1",
      buyerName: "Verified Buyer",
      listingId: "listing-1",
      priceMode: "buyer_offer",
      offeredPrice: "2.95",
    }));
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("rejects an unknown price mode before creating a request", async () => {
    const response = await POST(request({
      listingId: "listing-1",
      usdtAmount: "1000",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      priceMode: "free_price",
      offeredPrice: "0.01",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "PRICE_MODE_INVALID" });
    expect(mocks.createPurchaseRequest).not.toHaveBeenCalled();
  });

  it("does not forward a forged offered price for Buy Now", async () => {
    const response = await POST(request({
      listingId: "listing-1",
      usdtAmount: "1000",
      buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      priceMode: "listing_price",
      offeredPrice: "0.01",
    }));

    expect(response.status).toBe(201);
    expect(mocks.createPurchaseRequest).toHaveBeenCalledWith(expect.objectContaining({
      priceMode: "listing_price",
      offeredPrice: undefined,
    }));
  });
});
