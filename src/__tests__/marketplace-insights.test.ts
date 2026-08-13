import { describe, expect, it } from "vitest";
import { calculateSellerMarketplaceInsights } from "@/lib/marketplace-insights";
import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

const listing = { id: "listing-1", price: "3.20" } as MarketplaceListing;
const baseRequest = {
  id: "request-1",
  listingId: "listing-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  usdtAmount: "100",
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:30:00.000Z",
} as PurchaseRequest;

describe("marketplace insights", () => {
  it("uses actual completed request amounts and listing prices", () => {
    const result = calculateSellerMarketplaceInsights({
      listings: [listing],
      requests: [{ ...baseRequest, status: "completed", tradeCreatedAt: "2026-08-12T10:05:00.000Z" }],
    });
    expect(result.totalUsdtSold).toBe(100);
    expect(result.revenueGenerated).toBe(320);
    expect(result.estimatedEarnings).toBe(316.8);
    expect(result.averageResponseTimeMinutes).toBe(5);
  });

  it("keeps completion and resolved-success rates honest", () => {
    const result = calculateSellerMarketplaceInsights({
      listings: [listing],
      requests: [
        { ...baseRequest, id: "completed", status: "completed" },
        { ...baseRequest, id: "pending", status: "pending" },
        { ...baseRequest, id: "declined", status: "declined" },
        { ...baseRequest, id: "cancelled", status: "cancelled" },
      ],
    });
    expect(result.completionRate).toBe(25);
    expect(result.successRate).toBeCloseTo(33.333, 2);
  });
});