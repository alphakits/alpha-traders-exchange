import type { SellerReputationSnapshot, PublicSellerReputationSnapshot, SellerAchievement } from "@/types/alpha-exchange";

// Public listings must never carry private sales totals or values from which
// those totals can be reconstructed. Keep the internal trust snapshot intact.
export function publicSellerReputation(snapshot: SellerReputationSnapshot): PublicSellerReputationSnapshot {
  const result = { ...snapshot } as Partial<SellerReputationSnapshot>;
  for (const key of ["totalUsdtVolume", "estimatedCommissionPaid", "revenueGenerated", "averageTradeSize", "publicVolumeRange", "remainingVolumeToNextRank", "prestigeProgressPercent", "lifetimeCompletedVolumeUsdt", "prestigeVolumeUsdt"] as const) delete result[key];
  return result as PublicSellerReputationSnapshot;
}

export function publicSellerAchievements(achievements: SellerAchievement[]): SellerAchievement[] {
  return achievements.filter(item => item.key !== "volume_500k").map(item => ({
    id: item.id, key: item.key, title: item.title, description: item.description,
    earnedAt: item.earnedAt, source: item.source,
  }));
}
