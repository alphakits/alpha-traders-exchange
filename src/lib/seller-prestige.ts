import type { SellerLevel } from "@/types/alpha-exchange";

export const SELLER_PRESTIGE_TIERS: Array<{ rank: SellerLevel; minVolumeUsdt: number; publicLabel: string }> = [
  { rank: "bronze", minVolumeUsdt: 0, publicLabel: "0+" },
  { rank: "silver", minVolumeUsdt: 15_000, publicLabel: "15K+" },
  { rank: "gold", minVolumeUsdt: 50_000, publicLabel: "50K+" },
  { rank: "platinum", minVolumeUsdt: 150_000, publicLabel: "150K+" },
  { rank: "diamond", minVolumeUsdt: 300_000, publicLabel: "300K+" },
  { rank: "legendary", minVolumeUsdt: 500_000, publicLabel: "500K+" },
];

export function sellerPrestigeRankWeight(rank: SellerLevel) {
  if (rank === "legendary") return 6;
  if (rank === "diamond") return 5;
  if (rank === "platinum") return 4;
  if (rank === "gold") return 3;
  if (rank === "silver") return 2;
  return 1;
}

export function resolveSellerPrestigeRank(volumeUsdt: number): SellerLevel {
  const normalizedVolume = Math.max(0, Number.isFinite(volumeUsdt) ? volumeUsdt : 0);
  for (let index = SELLER_PRESTIGE_TIERS.length - 1; index >= 0; index -= 1) {
    const tier = SELLER_PRESTIGE_TIERS[index];
    if (normalizedVolume >= tier.minVolumeUsdt) return tier.rank;
  }
  return "bronze";
}

export function getNextSellerPrestigeRank(rank: SellerLevel): SellerLevel | undefined {
  const currentIndex = SELLER_PRESTIGE_TIERS.findIndex((tier) => tier.rank === rank);
  if (currentIndex === -1 || currentIndex >= SELLER_PRESTIGE_TIERS.length - 1) return undefined;
  return SELLER_PRESTIGE_TIERS[currentIndex + 1].rank;
}

export function getSellerPublicVolumeLabel(rank: SellerLevel) {
  return SELLER_PRESTIGE_TIERS.find((tier) => tier.rank === rank)?.publicLabel ?? "0+";
}

export function getSellerPrestigeProgress(volumeUsdt: number, rank?: SellerLevel) {
  const normalizedVolume = Math.max(0, Number.isFinite(volumeUsdt) ? volumeUsdt : 0);
  const currentRank = rank ?? resolveSellerPrestigeRank(normalizedVolume);
  const currentTier = SELLER_PRESTIGE_TIERS.find((tier) => tier.rank === currentRank) ?? SELLER_PRESTIGE_TIERS[0];
  const nextTier = SELLER_PRESTIGE_TIERS.find((tier) => tier.minVolumeUsdt > currentTier.minVolumeUsdt);
  if (!nextTier) {
    return {
      nextRank: undefined,
      remainingUsdt: 0,
      progressPercent: 100,
    };
  }
  const segmentSpan = Math.max(1, nextTier.minVolumeUsdt - currentTier.minVolumeUsdt);
  const segmentProgress = Math.min(segmentSpan, Math.max(0, normalizedVolume - currentTier.minVolumeUsdt));
  return {
    nextRank: nextTier.rank,
    remainingUsdt: Math.max(0, nextTier.minVolumeUsdt - normalizedVolume),
    progressPercent: Math.min(100, (segmentProgress / segmentSpan) * 100),
  };
}

export function toSellerPrestigeExportRecord(input: {
  sellerId: string;
  rank: SellerLevel;
  lifetimeCompletedVolumeUsdt: number;
  promotedAt?: string;
}) {
  return {
    sellerId: input.sellerId,
    rank: input.rank,
    lifetimeCompletedVolumeUsdt: Math.max(0, Number(input.lifetimeCompletedVolumeUsdt ?? 0)),
    publicVolumeRange: getSellerPublicVolumeLabel(input.rank),
    promotedAt: input.promotedAt,
  };
}
