import type { SellerLevel } from "@/types/alpha-exchange";

export type BuyerRankKey = SellerLevel;

export const BUYER_PRESTIGE_TIERS: ReadonlyArray<{
  rank: BuyerRankKey;
  minVolumeUsdt: number;
}> = [
  { rank: "bronze", minVolumeUsdt: 0 },
  { rank: "silver", minVolumeUsdt: 15_000 },
  { rank: "gold", minVolumeUsdt: 50_000 },
  { rank: "diamond", minVolumeUsdt: 150_000 },
  { rank: "elite", minVolumeUsdt: 500_000 },
];

const BUYER_RANK_COPY: Record<BuyerRankKey, {
  label: string;
  description: string;
  labelAr: string;
  descriptionAr: string;
}> = {
  bronze: {
    label: "Bronze Buyer",
    description: "Your completed purchases are building a verified Alpha Exchange history.",
    labelAr: "مشتري برونزي",
    descriptionAr: "مشترياتك المكتملة تبني سجلًا موثقًا لك في Alpha Exchange.",
  },
  silver: {
    label: "Silver Buyer",
    description: "A consistent buyer with at least 15,000 USDT in completed purchases.",
    labelAr: "مشتري فضي",
    descriptionAr: "مشتري منتظم لديه مشتريات مكتملة بقيمة 15,000 USDT على الأقل.",
  },
  gold: {
    label: "Gold Buyer",
    description: "An established buyer with at least 50,000 USDT in completed purchases.",
    labelAr: "مشتري ذهبي",
    descriptionAr: "مشتري راسخ لديه مشتريات مكتملة بقيمة 50,000 USDT على الأقل.",
  },
  diamond: {
    label: "Diamond Buyer",
    description: "A high-volume buyer with at least 150,000 USDT in completed purchases.",
    labelAr: "مشتري ماسي",
    descriptionAr: "مشتري بحجم مرتفع لديه مشتريات مكتملة بقيمة 150,000 USDT على الأقل.",
  },
  elite: {
    label: "Elite Buyer",
    description: "The highest buyer tier, earned through 500,000 USDT in completed purchases.",
    labelAr: "مشتري من النخبة",
    descriptionAr: "أعلى رتبة للمشترين، وتُكتسب بعد إكمال مشتريات بقيمة 500,000 USDT.",
  },
};

export type BuyerRankSummary = {
  key: BuyerRankKey;
  label: string;
  description: string;
  labelAr: string;
  descriptionAr: string;
  progressPercent: number;
  completedTrades: number;
  reviewsGiven: number;
  activeTrades: number;
  lifetimeCompletedVolumeUsdt: number;
  nextRank?: BuyerRankKey;
  nextRankLabel?: string;
  nextRankLabelAr?: string;
  requiredVolumeUsdt: number;
  remainingVolumeUsdt: number;
};

function normalizeVolume(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

export function resolveBuyerPrestigeRank(volumeUsdt: number): BuyerRankKey {
  const normalizedVolume = normalizeVolume(volumeUsdt);
  for (let index = BUYER_PRESTIGE_TIERS.length - 1; index >= 0; index -= 1) {
    const tier = BUYER_PRESTIGE_TIERS[index];
    if (normalizedVolume >= tier.minVolumeUsdt) return tier.rank;
  }
  return "bronze";
}

export function getBuyerPrestigeProgress(volumeUsdt: number) {
  const normalizedVolume = normalizeVolume(volumeUsdt);
  const rank = resolveBuyerPrestigeRank(normalizedVolume);
  const currentTier = BUYER_PRESTIGE_TIERS.find((tier) => tier.rank === rank) ?? BUYER_PRESTIGE_TIERS[0];
  const nextTier = BUYER_PRESTIGE_TIERS.find((tier) => tier.minVolumeUsdt > currentTier.minVolumeUsdt);

  if (!nextTier) {
    return {
      rank,
      nextRank: undefined,
      requiredVolumeUsdt: normalizedVolume,
      remainingVolumeUsdt: 0,
      progressPercent: 100,
    };
  }

  const segmentSpan = Math.max(1, nextTier.minVolumeUsdt - currentTier.minVolumeUsdt);
  const segmentProgress = Math.min(segmentSpan, Math.max(0, normalizedVolume - currentTier.minVolumeUsdt));
  return {
    rank,
    nextRank: nextTier.rank,
    requiredVolumeUsdt: nextTier.minVolumeUsdt,
    remainingVolumeUsdt: Math.max(0, nextTier.minVolumeUsdt - normalizedVolume),
    progressPercent: Math.min(100, (segmentProgress / segmentSpan) * 100),
  };
}

export function buyerRankLabel(rank: BuyerRankKey, isArabic = false) {
  return isArabic ? BUYER_RANK_COPY[rank].labelAr : BUYER_RANK_COPY[rank].label;
}

export function deriveBuyerRankSummary(input: {
  completedTrades: number;
  reviewsGiven: number;
  activeTrades: number;
  lifetimeCompletedVolumeUsdt: number;
}): BuyerRankSummary {
  const lifetimeCompletedVolumeUsdt = normalizeVolume(input.lifetimeCompletedVolumeUsdt);
  const progress = getBuyerPrestigeProgress(lifetimeCompletedVolumeUsdt);
  const copy = BUYER_RANK_COPY[progress.rank];
  return {
    key: progress.rank,
    ...copy,
    progressPercent: Number(progress.progressPercent.toFixed(2)),
    completedTrades: Math.max(0, input.completedTrades),
    reviewsGiven: Math.max(0, input.reviewsGiven),
    activeTrades: Math.max(0, input.activeTrades),
    lifetimeCompletedVolumeUsdt,
    nextRank: progress.nextRank,
    nextRankLabel: progress.nextRank ? BUYER_RANK_COPY[progress.nextRank].label : undefined,
    nextRankLabelAr: progress.nextRank ? BUYER_RANK_COPY[progress.nextRank].labelAr : undefined,
    requiredVolumeUsdt: progress.requiredVolumeUsdt,
    remainingVolumeUsdt: progress.remainingVolumeUsdt,
  };
}
