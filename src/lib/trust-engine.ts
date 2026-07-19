import type { AlphaExchangeUser, CommissionRecord, MarketplaceListing, PurchaseRequest, SellerBadge, SellerLevel, SellerReputationSnapshot } from "@/types/alpha-exchange";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: string | number | null | undefined) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function parseMinutes(value: string | number | null | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  if (Number.isNaN(parsed) || parsed <= 0) return 5;
  return parsed;
}

function deriveSellerLevel(input: { completedTrades: number; totalUsdtVolume: number; trustScore: number }) {
  if (input.completedTrades >= 1000 || input.totalUsdtVolume >= 2_000_000 || input.trustScore >= 95) return "elite" satisfies SellerLevel;
  if (input.completedTrades >= 350 || input.totalUsdtVolume >= 650_000 || input.trustScore >= 88) return "diamond" satisfies SellerLevel;
  if (input.completedTrades >= 120 || input.totalUsdtVolume >= 180_000 || input.trustScore >= 78) return "gold" satisfies SellerLevel;
  if (input.completedTrades >= 35 || input.totalUsdtVolume >= 45_000 || input.trustScore >= 65) return "silver" satisfies SellerLevel;
  return "bronze" satisfies SellerLevel;
}

function deriveSellerBadges(input: {
  level: SellerLevel;
  rating: number;
  responseTimeMinutes: number;
  trustScore: number;
  completionRate: number;
  completedTrades: number;
  recentActivityScore: number;
}) {
  const badges: SellerBadge[] = [];
  if (input.level === "elite") badges.push("elite_seller");
  if (input.level === "diamond" || input.level === "elite") badges.push("platinum_seller");
  if (input.rating >= 4.9) badges.push("top_rated");
  if (input.responseTimeMinutes <= 2) badges.push("fast_responder");
  if (input.trustScore >= 85 && input.completionRate >= 95) badges.push("trusted_seller");
  if (input.recentActivityScore >= 75) badges.push("most_active");
  if (input.completedTrades >= 1000) badges.push("trades_1000_plus");
  return badges;
}

function reputationSummaryFromScore(score: number, level: SellerLevel) {
  if (score >= 95) return "Excellent";
  if (score >= 88) return level === "diamond" || level === "elite" ? "Diamond Seller" : "Top Rated Seller";
  if (score >= 75) return "Trusted Professional";
  if (score >= 60) return "Reliable Seller";
  return "Growing Seller";
}

export function calculateSellerTrustSnapshot(input: {
  seller: AlphaExchangeUser;
  listings: MarketplaceListing[];
  requests: PurchaseRequest[];
  commissions: CommissionRecord[];
  marketplacePosition?: number;
}): SellerReputationSnapshot {
  const now = Date.now();
  const completedRequests = input.requests.filter((request) => request.status === "completed");
  const acceptedOrCompleted = input.requests.filter((request) => request.status === "accepted" || request.status === "completed");
  const cancelled = input.requests.filter((request) => request.status === "cancelled");
  const pending = input.requests.filter((request) => request.status === "pending");
  const requestsCount = input.requests.length;
  const completedTrades = completedRequests.length;

  const volumeByCompleted = completedRequests.reduce(
    (acc, request) => {
      const listing = input.listings.find((item) => item.id === request.listingId);
      if (!listing) return acc;
      const amount = toNumber(listing.availableAmount);
      const price = toNumber(listing.price);
      acc.totalUsdtVolume += amount;
      acc.revenueGenerated += amount * price;
      return acc;
    },
    { totalUsdtVolume: 0, revenueGenerated: 0 },
  );

  const responseSamples = input.listings.map((listing) => parseMinutes(listing.responseTime));
  const responseTimeMinutes = responseSamples.length ? responseSamples.reduce((sum, current) => sum + current, 0) / responseSamples.length : 5;

  const completionRate = requestsCount ? (completedTrades / requestsCount) * 100 : 0;
  const acceptanceRate = requestsCount ? (acceptedOrCompleted.length / requestsCount) * 100 : 0;
  const cancellationRate = requestsCount ? (cancelled.length / requestsCount) * 100 : 0;
  const successRate = requestsCount ? ((completedTrades + Math.max(0, requestsCount - acceptedOrCompleted.length - 1)) / requestsCount) * 100 : 0;

  const accountAgeDays = Math.max(1, Math.round((now - new Date(input.seller.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
  const profileCompletion = clamp(
    [input.seller.fullName, input.seller.whatsappNumber, input.seller.bio, input.seller.profilePhotoUrl].filter((value) => String(value ?? "").trim()).length / 4 * 100,
    0,
    100,
  );
  const verificationScore = input.seller.sellerStatus === "approved_seller" || input.seller.sellerStatus === "suspended" ? 100 : 60;
  const marketplaceViolations = input.seller.sellerStatus === "suspended" ? 2 : 0;
  const disputesLost = Math.round(cancelled.length * 0.15);
  const listingQualityScore = clamp(
    input.listings.length
      ? input.listings.reduce((sum, listing) => sum + (listing.sellerDescription ? 20 : 0) + (listing.paymentMethod ? 20 : 0) + (listing.photos?.length ? 60 : 20), 0) / input.listings.length
      : 40,
    0,
    100,
  );
  const recentActivityScore = clamp(
    input.requests.filter((request) => now - new Date(request.updatedAt).getTime() <= 1000 * 60 * 60 * 24 * 30).length * 4 +
      input.listings.filter((listing) => listing.status === "available").length * 8 +
      pending.length * 2,
    0,
    100,
  );
  const responseScore = clamp(100 - responseTimeMinutes * 8, 0, 100);
  const reliabilityScore = clamp(
    successRate * 0.35 + completionRate * 0.3 + acceptanceRate * 0.15 + (100 - cancellationRate) * 0.2 - marketplaceViolations * 8 - disputesLost * 2,
    0,
    100,
  );
  const activityScore = clamp(recentActivityScore * 0.5 + Math.min(100, completedTrades * 2) * 0.3 + Math.min(100, accountAgeDays / 3) * 0.2, 0, 100);
  const customerSatisfaction = clamp(88 + completionRate * 0.08 + Math.min(6, completedTrades / 25) - responseTimeMinutes * 0.35 - disputesLost * 0.6, 70, 99.9);
  const rating = clamp(4.2 + completionRate * 0.006 + acceptanceRate * 0.002 + Math.min(0.35, completedTrades / 1000) - disputesLost * 0.015, 3.8, 5);

  const trustScore = clamp(
    reliabilityScore * 0.36 +
      responseScore * 0.18 +
      activityScore * 0.16 +
      profileCompletion * 0.1 +
      verificationScore * 0.08 +
      listingQualityScore * 0.07 +
      Math.min(100, accountAgeDays / 2) * 0.05,
    0,
    100,
  );

  const buyersCount = completedRequests.reduce<Record<string, number>>((acc, request) => {
    acc[request.buyerId] = (acc[request.buyerId] ?? 0) + 1;
    return acc;
  }, {});
  const repeatBuyers = Object.values(buyersCount).filter((count) => count > 1).length;
  const profileViews = Math.round(220 + completedTrades * 6 + recentActivityScore * 3);
  const listingViews = Math.round(340 + input.listings.length * 80 + requestsCount * 12 + recentActivityScore * 5);
  const monthlyGrowthPercent = clamp((recentActivityScore / 2.8) - 8 + Math.min(16, completedTrades / 20), -8, 64);
  const averageTradeSize = completedTrades ? volumeByCompleted.revenueGenerated / completedTrades : 0;
  const level = deriveSellerLevel({ completedTrades, totalUsdtVolume: volumeByCompleted.totalUsdtVolume, trustScore });
  const badges = deriveSellerBadges({ level, rating, responseTimeMinutes, trustScore, completionRate, completedTrades, recentActivityScore });

  return {
    sellerId: input.seller.id,
    trustScore,
    reliabilityScore,
    responseScore,
    activityScore,
    marketplacePosition: input.marketplacePosition ?? 0,
    reputationSummary: reputationSummaryFromScore(trustScore, level),
    level,
    badges,
    rating,
    completedTrades,
    totalUsdtVolume: volumeByCompleted.totalUsdtVolume,
    successRate,
    acceptanceRate,
    cancellationRate,
    completionRate,
    responseTimeMinutes,
    customerSatisfaction,
    recentActivityScore,
    accountAgeDays,
    profileCompletion,
    verificationScore,
    disputesLost,
    marketplaceViolations,
    listingQualityScore,
    profileViews,
    listingViews,
    tradeRequests: requestsCount,
    monthlyGrowthPercent,
    estimatedCommissionPaid: input.commissions.reduce((sum, record) => sum + record.commissionAmount, 0),
    revenueGenerated: volumeByCompleted.revenueGenerated,
    repeatBuyers,
    averageTradeSize,
  };
}

export function rankTrustSnapshots(snapshots: SellerReputationSnapshot[]) {
  const sorted = [...snapshots].sort((a, b) => {
    if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
    if (b.reliabilityScore !== a.reliabilityScore) return b.reliabilityScore - a.reliabilityScore;
    if (a.responseTimeMinutes !== b.responseTimeMinutes) return a.responseTimeMinutes - b.responseTimeMinutes;
    return b.completedTrades - a.completedTrades;
  });
  return sorted.map((snapshot, index) => ({ ...snapshot, marketplacePosition: index + 1 }));
}
