import type { SellerMetricEvidence } from "@alpha-traders/contracts";
import type { SellerReputationSnapshot, PublicSellerReputationSnapshot, SellerAchievement } from "@/types/alpha-exchange";

// Public listings must never carry private sales totals or values from which
// those totals can be reconstructed. Keep the internal trust snapshot intact.
export function publicSellerReputation(snapshot: SellerReputationSnapshot): PublicSellerReputationSnapshot {
  const result = { ...snapshot } as Partial<SellerReputationSnapshot>;
  for (const key of ["totalUsdtVolume", "estimatedCommissionPaid", "revenueGenerated", "averageTradeSize", "publicVolumeRange", "remainingVolumeToNextRank", "prestigeProgressPercent", "lifetimeCompletedVolumeUsdt", "prestigeVolumeUsdt", "profileViews", "listingViews", "monthlyGrowthPercent", "customerSatisfaction"] as const) delete result[key];
  return result as PublicSellerReputationSnapshot;
}

export function publicSellerAchievements(achievements: SellerAchievement[]): SellerAchievement[] {
  return achievements.filter(item => item.key !== "volume_500k").map(item => ({
    id: item.id, key: item.key, title: item.title, description: item.description,
    earnedAt: item.earnedAt, source: item.source,
  }));
}

/** Allowlist score evidence from persisted JSON for outward-facing Discord cards. */
export function storedSellerMetricEvidence(snapshot: Record<string, unknown> | null): SellerMetricEvidence {
  const score = snapshot?.alphaScore as Partial<NonNullable<SellerMetricEvidence["alphaScore"]>> | null;
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  return {
    totalReviews: count(snapshot?.totalReviews),
    responseSampleCount: count(snapshot?.responseSampleCount),
    alphaScore: score && typeof score.value === "number" && Number.isFinite(score.value) && score.value >= 0 && score.value <= 100
      ? { value: score.value, starter: score.starter === true } : undefined,
  };
}

export function publicSellerMetricUpdate(snapshot: SellerReputationSnapshot) {
  return {
    sellerId: snapshot.sellerId, reviewCount: snapshot.totalReviews ?? 0,
    averageRating: snapshot.rating, alphaScore: snapshot.alphaScore,
    responseTimeMinutes: snapshot.responseTimeMinutes, responseSampleCount: snapshot.responseSampleCount,
  };
}
