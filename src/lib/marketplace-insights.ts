import type { MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

import { measureSellerActivity } from "./seller-activity-metrics";

export type SellerMarketplaceInsights = {
  completedTrades: number;
  totalUsdtSold: number;
  revenueGenerated: number;
  estimatedEarnings: number;
  averageTradeSize: number;
  averageResponseTimeMinutes: number;
  responseSampleCount: number;
  successRate: number;
  completionRate: number;
};

function amount(value: string | number | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function isCompleted(request: PurchaseRequest) {
  return request.status === "completed" || request.status === "review_open" || request.status === "locked" || Boolean(request.completedAt);
}

export function calculateSellerMarketplaceInsights(input: {
  requests: PurchaseRequest[];
  listings: MarketplaceListing[];
}): SellerMarketplaceInsights {
  const listingsById = new Map(input.listings.map((listing) => [listing.id, listing]));
  const completedRequests = input.requests.filter(isCompleted);
  const completedMetrics = completedRequests.map((request) => ({
    amount: amount(request.usdtAmount),
    price: amount(listingsById.get(request.listingId)?.price),
  }));
  const totalUsdtSold = completedMetrics.reduce((sum, item) => sum + item.amount, 0);
  const revenueGenerated = completedMetrics.reduce((sum, item) => sum + item.amount * item.price, 0);
  const resolvedRequests = input.requests.filter((request) => !["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(request.status));
  const successfulResolvedRequests = resolvedRequests.filter(isCompleted).length;
  const responseFacts = measureSellerActivity(input.requests);
  return {
    completedTrades: completedRequests.length,
    totalUsdtSold,
    revenueGenerated,
    estimatedEarnings: revenueGenerated * 0.99,
    averageTradeSize: completedRequests.length ? revenueGenerated / completedRequests.length : 0,
    averageResponseTimeMinutes: responseFacts.responseTimeMinutes,
    responseSampleCount: responseFacts.responseSampleCount,
    successRate: resolvedRequests.length ? (successfulResolvedRequests / resolvedRequests.length) * 100 : 0,
    completionRate: input.requests.length ? (completedRequests.length / input.requests.length) * 100 : 0,
  };
}