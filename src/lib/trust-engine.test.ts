import { describe, expect, it } from "vitest";
import type { AlphaExchangeUser, CommissionRecord, MarketplaceEnforcementRecord, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import { calculateSellerTrustSnapshot } from "./trust-engine";

const seller = { id: "seller-facts", sellerStatus: "approved_seller", createdAt: "2026-01-01T00:00:00Z" } as AlphaExchangeUser;
const request = (status: PurchaseRequest["status"], overrides: Partial<PurchaseRequest> = {}) => ({
  id: "request-facts", sellerId: seller.id, buyerId: "buyer-facts", listingId: "listing-facts", status,
  usdtAmount: "10", pricePerUsdt: "3.10", createdAt: "2026-01-02T10:00:00Z", updatedAt: "2026-01-02T10:04:00Z", timeline: [], ...overrides,
}) as PurchaseRequest;

describe("trust engine uses recorded seller facts", () => {
  it("measures average trade size in USDT across ILS and USD settlement currencies", () => {
    const snapshot = calculateSellerTrustSnapshot({ seller, listings: [], requests: [
      request("completed", { id: "ils-trade", usdtAmount: "100", pricePerUsdt: "3.5", fiatAmount: "350", currency: "ILS" }),
      request("completed", { id: "usd-trade", usdtAmount: "300", pricePerUsdt: "1.1", fiatAmount: "330", currency: "USD" }),
      request("pending", { id: "pending-trade", usdtAmount: "5000", pricePerUsdt: "3.5", currency: "ILS" }),
    ], commissions: [] });
    expect(snapshot.totalUsdtVolume).toBe(400);
    expect(snapshot.completedTrades).toBe(2);
    expect(snapshot.averageTradeSize).toBe(200);
  });

  it("does not invent reviews, view counters, growth or customer satisfaction", () => {
    const snapshot = calculateSellerTrustSnapshot({ seller, listings: [], requests: [], commissions: [] });
    expect(snapshot.rating).toBe(0);
    expect(snapshot.customerSatisfaction).toBeUndefined();
    expect(snapshot.profileViews).toBeUndefined();
    expect(snapshot.listingViews).toBeUndefined();
    expect(snapshot.monthlyGrowthPercent).toBeUndefined();
    expect(snapshot.badges).not.toContain("fast_responder");
  });

  it("never treats cancelled trades as adjudicated lost disputes", () => {
    const snapshot = calculateSellerTrustSnapshot({ seller, listings: [], requests: Array.from({ length: 20 }, () => request("cancelled")), commissions: [] });
    expect(snapshot.disputesLost).toBeUndefined();
    expect(snapshot.successRate).toBe(0);
    expect(snapshot.cancellationRate).toBe(100);
  });

  it("does not count pending trades as successful or accepted", () => {
    const snapshot = calculateSellerTrustSnapshot({ seller, listings: [], requests: Array.from({ length: 20 }, () => request("pending")), commissions: [] });
    expect(snapshot.successRate).toBe(0);
    expect(snapshot.acceptanceRate).toBe(0);
  });

  it("uses actual acceptance timestamps instead of a seller's advertised response speed", () => {
    const requests = [request("funds_received", { tradeCreatedAt: "2026-01-02T10:04:00Z" })];
    const calculate = (responseTime: string) => calculateSellerTrustSnapshot({ seller, requests, commissions: [], listings: [{ id: "listing-facts", responseTime }] as MarketplaceListing[] });
    const fastClaim = calculate("1 minute");
    const slowClaim = calculate("900 minutes");
    expect(fastClaim.responseTimeMinutes).toBe(4);
    expect(fastClaim.responseScore).toBe(slowClaim.responseScore);
    expect(fastClaim.acceptanceRate).toBe(100);
  });

  it("uses completed-trade reviews and excludes unpaid commission from settled totals", () => {
    const snapshot = calculateSellerTrustSnapshot({ seller, listings: [], requests: [
      request("completed", { buyerReview: { rating: 5 } as PurchaseRequest["buyerReview"] }),
      request("completed", { buyerReview: { rating: 1 } as PurchaseRequest["buyerReview"] }),
      request("pending", { buyerReview: { rating: 5 } as PurchaseRequest["buyerReview"] }),
    ], commissions: [
      { paymentStatus: "paid", commissionAmount: 0.002 },
      { paymentStatus: "pending", commissionAmount: 10 },
      { paymentStatus: "overdue", commissionAmount: 20 },
    ] as CommissionRecord[] });
    expect(snapshot.rating).toBe(3);
    expect(snapshot.customerSatisfaction).toBe(60);
    expect(snapshot.estimatedCommissionPaid).toBe(0.002);
  });

  it("counts recorded active enforcement and reports suspension separately", () => {
    const snapshot = calculateSellerTrustSnapshot({ seller: { ...seller, sellerStatus: "suspended" }, listings: [], requests: [], commissions: [],
      enforcementRecords: [
        { id: "active", sellerId: seller.id, status: "active" },
        { id: "removed", sellerId: seller.id, status: "resolved_removed" },
        { id: "other-seller", sellerId: "someone-else", status: "active" },
      ] as MarketplaceEnforcementRecord[],
    });
    expect(snapshot.marketplaceViolations).toBe(1);
    expect(snapshot.accountSuspended).toBe(true);
  });
});
