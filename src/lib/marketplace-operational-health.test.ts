import { describe, expect, it } from "vitest";

import { buildMarketplaceOperationalSnapshot } from "@/lib/marketplace-operational-health";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

const NOW = new Date("2026-09-03T20:00:00.000Z");

function listing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "listing-1",
    sellerId: "seller-1",
    sellerDisplayName: "Seller",
    photos: [],
    originalAmount: "1000",
    availableAmount: "1000",
    price: "3.30",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"],
    minimumTrade: "100",
    maximumTrade: "1000",
    sellerDescription: "Seller",
    responseTime: "5 minutes",
    status: "active",
    createdAt: "2026-09-03T18:00:00.000Z",
    updatedAt: "2026-09-03T19:55:00.000Z",
    ...overrides,
  };
}

function request(overrides: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    id: "request-1",
    tradeId: "trade-1",
    buyerId: "buyer-1",
    listingId: "listing-1",
    sellerId: "seller-1",
    buyerName: "Buyer",
    usdtAmount: "500",
    fiatAmount: "1475",
    pricePerUsdt: "2.95",
    listingPriceAtRequest: "3.30",
    priceMode: "buyer_offer",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    timeline: [],
    status: "pending",
    createdAt: "2026-09-03T19:50:00.000Z",
    updatedAt: "2026-09-03T19:50:00.000Z",
    ...overrides,
  };
}

describe("buildMarketplaceOperationalSnapshot", () => {
  it("returns a healthy snapshot for a fresh pending offer", () => {
    const result = buildMarketplaceOperationalSnapshot({
      marketplaceListings: [listing()],
      purchaseRequests: [request()],
    }, NOW);

    expect(result).toMatchObject({
      status: "healthy",
      pendingPriceOffers: 1,
      stalePriceOffers: 0,
      dataIntegrityIssues: 0,
    });
    expect(result.incidents).toEqual([]);
  });

  it("flags an unanswered price offer after 30 minutes", () => {
    const result = buildMarketplaceOperationalSnapshot({
      marketplaceListings: [listing()],
      purchaseRequests: [request({ createdAt: "2026-09-03T19:29:00.000Z" })],
    }, NOW);

    expect(result.status).toBe("attention");
    expect(result.stalePriceOffers).toBe(1);
    expect(result.incidents[0]).toMatchObject({ kind: "stale_price_offer", severity: "warning", ageMinutes: 31 });
  });

  it("flags an overdue USDT release as critical", () => {
    const activeRequest = request({
      status: "usdt_release_pending",
      usdtReleaseDeadlineAt: "2026-09-03T19:45:00.000Z",
      createdAt: "2026-09-03T18:30:00.000Z",
      updatedAt: "2026-09-03T19:15:00.000Z",
    });
    const result = buildMarketplaceOperationalSnapshot({
      marketplaceListings: [listing({ status: "in_trade", activeTradeRequestId: activeRequest.id, lockedAt: "2026-09-03T18:30:00.000Z" })],
      purchaseRequests: [activeRequest],
    }, NOW);

    expect(result).toMatchObject({ status: "critical", activeTrades: 1, overdueUsdtReleases: 1, dataIntegrityIssues: 0 });
    expect(result.incidents[0]).toMatchObject({ kind: "overdue_usdt_release", ageMinutes: 15 });
  });

  it("detects listing locks without a matching active request", () => {
    const result = buildMarketplaceOperationalSnapshot({
      marketplaceListings: [listing({ status: "matched", activeTradeRequestId: "missing-request", lockedAt: "2026-09-03T19:00:00.000Z" })],
      purchaseRequests: [],
    }, NOW);

    expect(result.status).toBe("critical");
    expect(result.dataIntegrityIssues).toBe(1);
    expect(result.incidents[0]).toMatchObject({ kind: "orphaned_listing_lock", listingId: "listing-1" });
  });

  it("detects active trades that are no longer linked to their listing", () => {
    const activeRequest = request({ status: "payment_sent", priceMode: "listing_price" });
    const result = buildMarketplaceOperationalSnapshot({
      marketplaceListings: [listing({ status: "active" })],
      purchaseRequests: [activeRequest],
    }, NOW);

    expect(result.status).toBe("critical");
    expect(result.dataIntegrityIssues).toBe(1);
    expect(result.incidents[0]).toMatchObject({ kind: "unlinked_active_trade", requestId: "request-1" });
  });

  it("flags an accepted trade that remains idle after its warning", () => {
    const activeRequest = request({
      status: "accepted",
      inactivityWarningSentAt: "2026-09-03T19:40:00.000Z",
      priceOfferAcceptedAt: "2026-09-03T19:00:00.000Z",
    });
    const result = buildMarketplaceOperationalSnapshot({
      marketplaceListings: [listing({ status: "matched", activeTradeRequestId: activeRequest.id, lockedAt: "2026-09-03T19:00:00.000Z" })],
      purchaseRequests: [activeRequest],
    }, NOW);

    expect(result.status).toBe("attention");
    expect(result.stalledTrades).toBe(1);
    expect(result.incidents[0]).toMatchObject({ kind: "stalled_trade", severity: "warning", ageMinutes: 20 });
  });
});
