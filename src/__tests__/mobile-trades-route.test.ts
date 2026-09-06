// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  createPurchaseRequest: vi.fn(),
  getMyPurchaseRequests: vi.fn(),
  hasRole: vi.fn(),
  prepareTradeEventEmails: vi.fn(),
  requireMobileApiUser: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  createPurchaseRequest: mocks.createPurchaseRequest,
  getMyPurchaseRequests: mocks.getMyPurchaseRequests,
}));
vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeEventEmails: mocks.prepareTradeEventEmails,
}));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/roles", () => ({ hasRole: mocks.hasRole }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { GET, POST } from "@/app/api/mobile/v1/trades/route";

function mobileRequest(method: "GET" | "POST", body?: Record<string, unknown>) {
  return new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/trades", {
    method,
    headers: {
      "authorization": "Bearer atr_at_v1.test-access-token-value-that-is-long-enough",
      "content-type": "application/json",
      "x-app-version": "1.0.0",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-platform": "android",
      "x-request-id": "mobile-trades-request",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function trade(overrides: Record<string, unknown> = {}) {
  return {
    id: "purchase-own",
    displayNumber: 77,
    buyerId: "buyer-1",
    sellerId: "private-seller-id",
    listingId: "private-listing-id",
    buyerName: "Buyer One",
    buyerWhatsapp: "+972500000000",
    buyerNotes: "private note",
    buyerReceivingWalletAddress: "private-wallet",
    usdtAmount: "500",
    fiatAmount: "1650.00",
    pricePerUsdt: "3.30",
    listingPriceAtRequest: "3.30",
    priceMode: "listing_price",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    timeline: [],
    status: "pending",
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user: {
      id: "buyer-1",
      email: "buyer@example.test",
      fullName: "Buyer One",
      role: "buyer",
      roles: ["buyer"],
      sellerStatus: "buyer",
    },
    accessToken: "access",
    unauthorized: null,
  });
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.hasRole.mockReturnValue(true);
  mocks.prepareTradeEventEmails.mockResolvedValue(async () => undefined);
  mocks.createPurchaseRequest.mockResolvedValue({
    request: trade(),
    metrics: { totalMs: 1 },
  });
});

describe("mobile trades collection route", () => {
  it("keeps the native trade list participant-only even for privileged roles", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: {
        id: "buyer-1",
        email: "owner@example.test",
        fullName: "Owner",
        role: "owner",
        roles: ["owner", "admin"],
        sellerStatus: "buyer",
      },
      accessToken: "access",
      unauthorized: null,
    });
    mocks.getMyPurchaseRequests.mockResolvedValue([
      trade(),
      trade({ id: "purchase-foreign", buyerId: "other-buyer", sellerId: "other-seller" }),
    ]);

    const response = await GET(mobileRequest("GET"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.trades).toHaveLength(1);
    expect(payload.trades[0]).toMatchObject({ id: "purchase-own", side: "buyer", usdtAmount: "500" });
    for (const value of [
      "purchase-foreign",
      "private-seller-id",
      "private-listing-id",
      "+972500000000",
      "private note",
      "private-wallet",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("creates a request from the authenticated identity and ignores forged contact fields", async () => {
    const response = await POST(mobileRequest("POST", {
      listingId: "listing-1",
      usdtAmount: "500",
      receivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      paymentMethod: "Bank Transfer",
      priceMode: "listing_price",
      safetyAcknowledged: false,
      buyerName: "Forged Buyer",
      buyerWhatsapp: "+972599999999",
      buyerNotes: "contact me elsewhere",
    }));

    expect(response.status).toBe(201);
    expect(mocks.createPurchaseRequest).toHaveBeenCalledWith(expect.objectContaining({
      buyerId: "buyer-1",
      buyerName: "Buyer One",
      listingId: "listing-1",
      priceMode: "listing_price",
      offeredPrice: undefined,
    }));
    const input = mocks.createPurchaseRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input).not.toHaveProperty("buyerWhatsapp");
    expect(input).not.toHaveProperty("buyerNotes");
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("rejects an account without a canonical display name before creating a trade", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: {
        id: "buyer-1",
        email: "buyer@example.test",
        fullName: "   ",
        role: "buyer",
        roles: ["buyer"],
        sellerStatus: "buyer",
      },
      accessToken: "access",
      unauthorized: null,
    });

    const response = await POST(mobileRequest("POST", {
      listingId: "listing-1",
      usdtAmount: "500",
      receivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      paymentMethod: "Bank Transfer",
      priceMode: "listing_price",
      safetyAcknowledged: false,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(mocks.createPurchaseRequest).not.toHaveBeenCalled();
  });

  it("rejects accounts without a buyer or approved-seller role before mutation", async () => {
    mocks.hasRole.mockReturnValue(false);

    const response = await POST(mobileRequest("POST", {
      listingId: "listing-1",
      usdtAmount: "500",
      receivingWalletAddress: "wallet-value",
      paymentMethod: "Bank Transfer",
      priceMode: "listing_price",
      safetyAcknowledged: false,
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "BUYER_ROLE_REQUIRED" } });
    expect(mocks.createPurchaseRequest).not.toHaveBeenCalled();
  });

  it("maps wallet validation failures to a stable localized mobile error", async () => {
    mocks.createPurchaseRequest.mockRejectedValue(new Error("TRC20 requires a valid 34-character Tron address beginning with T."));

    const response = await POST(mobileRequest("POST", {
      listingId: "listing-1",
      usdtAmount: "500",
      receivingWalletAddress: "invalid-wallet",
      paymentMethod: "Bank Transfer",
      priceMode: "listing_price",
      safetyAcknowledged: false,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "WALLET_ADDRESS_INVALID" } });
  });
});
