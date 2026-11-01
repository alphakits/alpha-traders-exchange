import type { AlphaExchangeUser, CommissionRecord, MarketplaceEnforcementRecord, MarketplaceListing, PurchaseRequest, SellerBadge, SellerLevel, SellerReputationSnapshot } from "@/types/alpha-exchange";
import { getSellerPrestigeProgress, getSellerPublicVolumeLabel, resolveSellerPrestigeRank } from "@/lib/seller-prestige";
import { isOwnerApprovedSeller } from "@/lib/seller-approval";
import { measureSellerActivity } from "@/lib/seller-activity-metrics";
import { sumCommissionAmounts } from "@alpha-traders/contracts";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value: string | number | null | undefined) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function deriveSellerLevel(input: { completedTrades: number; totalUsdtVolume: number; trustScore: number }) {
  return resolveSellerPrestigeRank(input.totalUsdtVolume);
}

function deriveSellerBadges(input: {
  level: SellerLevel;
  rating: number;
  responseTimeMinutes: number;
  responseSampleCount: number;
  trustScore: number;
  completionRate: number;
  completedTrades: number;
  recentActivityScore: number;
}) {
  const badges: SellerBadge[] = [];
  if (input.level === "elite") badges.push("elite_seller");
  if (input.level === "diamond" || input.level === "elite") badges.push("platinum_seller");
  if (input.rating >= 4.9) badges.push("top_rated");
  if (input.responseSampleCount > 0 && input.responseTimeMinutes <= 2) badges.push("fast_responder");
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
  /** Deterministic evaluation for a reviewed historical reconciliation plan. */
  now?: number;
  seller: AlphaExchangeUser;
  listings: MarketplaceListing[];
  requests: PurchaseRequest[];
  commissions: CommissionRecord[];
  enforcementRecords?: MarketplaceEnforcementRecord[];
  marketplacePosition?: number;
}): SellerReputationSnapshot {
  const now = input.now ?? Date.now();
  const completedRequests = input.requests.filter((request) => ["completed", "review_open", "locked"].includes(request.status) || Boolean(request.completedAt));
  const acceptedOrCompleted = input.requests.filter((request) => ["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "completed", "review_open", "locked"].includes(request.status) || Boolean(request.tradeCreatedAt) || Boolean(request.completedAt));
  const cancelled = input.requests.filter((request) => request.status === "cancelled");
  const pending = input.requests.filter((request) => request.status === "pending");
  const requestsCount = input.requests.length;
  const completedTrades = completedRequests.length;

  const volumeByCompleted = completedRequests.reduce(
    (acc, request) => {
      const listing = input.listings.find((item) => item.id === request.listingId);
      const amount = toNumber(request.usdtAmount);
      // A removed listing must not erase a completed sale or change its agreed price.
      const price = toNumber(request.pricePerUsdt ?? listing?.price ?? 0);
      acc.totalUsdtVolume += amount;
      acc.revenueGenerated += amount * price;
      return acc;
    },
    { totalUsdtVolume: 0, revenueGenerated: 0 },
  );

  const facts = measureSellerActivity(input.requests, now);
  const { responseTimeMinutes, rating, responseSampleCount } = facts;

  const completionRate = requestsCount ? (completedTrades / requestsCount) * 100 : 0;
  const acceptanceRate = requestsCount ? (acceptedOrCompleted.length / requestsCount) * 100 : 0;
  const cancellationRate = requestsCount ? (cancelled.length / requestsCount) * 100 : 0;
  const successRate = completionRate;

  const accountAgeDays = Math.max(1, Math.round((now - new Date(input.seller.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
  const profileCompletion = clamp(
    [input.seller.fullName, input.seller.whatsappNumber, input.seller.bio, input.seller.profilePhotoUrl].filter((value) => String(value ?? "").trim()).length / 4 * 100,
    0,
    100,
  );
  const verificationScore = isOwnerApprovedSeller(input.seller) ? 100 : 0;
  const accountSuspended = input.seller.sellerStatus === "suspended";
  const marketplaceViolations = new Set((input.enforcementRecords ?? [])
    .filter(record => record.sellerId === input.seller.id && record.status === "active" && record.appealStatus !== "accepted")
    .map(record => record.id)).size;
  // Dispute records do not identify a losing party. Cancellation is not proof
  // of fault. Keep this unavailable until an adjudicated outcome exists.
  const disputesLost = undefined;
  const listingQualityScore = clamp(
    input.listings.length
      ? input.listings.reduce((sum, listing) => sum + (listing.sellerDescription ? 20 : 0) + (listing.paymentMethod ? 20 : 0) + (listing.photos?.length ? 60 : 20), 0) / input.listings.length
      : 40,
    0,
    100,
  );
  const recentActivityScore = clamp(
    input.requests.filter((request) => now - new Date(request.updatedAt).getTime() <= 1000 * 60 * 60 * 24 * 30).length * 4 +
    input.listings.filter((listing) => listing.status === "active" || listing.status === "matched" || listing.status === "in_trade").length * 8 +
      pending.length * 2,
    0,
    100,
  );
  const responseScore = responseSampleCount ? clamp(100 - responseTimeMinutes * 8, 0, 100) : 0;
  const reliabilityScore = clamp(
    successRate * 0.35 + completionRate * 0.3 + acceptanceRate * 0.15 + (100 - cancellationRate) * 0.2 - Math.max(marketplaceViolations * 8, accountSuspended ? 16 : 0),
    0,
    100,
  );
  const activityScore = clamp(recentActivityScore * 0.5 + Math.min(100, completedTrades * 2) * 0.3 + Math.min(100, accountAgeDays / 3) * 0.2, 0, 100);
  const customerSatisfaction = facts.totalReviews ? rating / 5 * 100 : undefined;

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
  // Trade size is denominated in USDT, including when completed trades use
  // different fiat currencies. Do not average ILS and USD settlement totals.
  const averageTradeSize = completedTrades ? volumeByCompleted.totalUsdtVolume / completedTrades : 0;
  const level = deriveSellerLevel({ completedTrades, totalUsdtVolume: volumeByCompleted.totalUsdtVolume, trustScore });
  const badges = deriveSellerBadges({ level, rating, responseTimeMinutes, responseSampleCount, trustScore, completionRate, completedTrades, recentActivityScore });
  const prestigeProgress = getSellerPrestigeProgress(volumeByCompleted.totalUsdtVolume, level);

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
    accountSuspended,
    listingQualityScore,
    tradeRequests: requestsCount,
    // This legacy field is settled obligation value, not measured cash receipts.
    estimatedCommissionPaid: sumCommissionAmounts(input.commissions.filter(record => record.paymentStatus === "paid").map(record => record.commissionAmount)),
    revenueGenerated: volumeByCompleted.revenueGenerated,
    repeatBuyers,
    averageTradeSize,
    publicVolumeRange: getSellerPublicVolumeLabel(level),
    nextRank: prestigeProgress.nextRank,
    remainingVolumeToNextRank: prestigeProgress.remainingUsdt,
    prestigeProgressPercent: prestigeProgress.progressPercent,
    lifetimeCompletedVolumeUsdt: volumeByCompleted.totalUsdtVolume,
    isRankOverridden: false,
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
