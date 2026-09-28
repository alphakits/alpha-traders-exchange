import type { SellerAchievement, SellerAchievementKey, SellerLevel } from "@/types/alpha-exchange";

export type SellerAchievementEvaluationInput = {
  sellerId: string;
  sellerName: string;
  rank: SellerLevel;
  lifetimeVolumeUsdt: number;
  completedTrades: number;
  reviewCount: number;
  averageRating: number;
  responseTimeMinutes: number;
  completionRate: number;
  approvedAt?: string;
  createdAt?: string;
  tradeRequests: number;
  completedTradeMonths: string[];
  hasCommissionRecords: boolean;
  hasDispute: boolean;
  sellerStatus: "approved_seller" | "suspended" | "buyer" | "pending_seller_approval" | "rejected";
};

const ACHIEVEMENT_TITLES: Record<SellerAchievementKey, string> = {
  first_trade: "First Trade",
  trades_100: "100 Trades",
  fast_responder: "Fast Responder",
  customer_favorite: "Customer Favorite",
  volume_500k: "500K Volume",
  perfect_month: "Perfect Month",
  rising_star: "Rising Star",
  trusted_veteran: "Trusted Veteran",
};

const ACHIEVEMENT_DESCRIPTIONS: Record<SellerAchievementKey, string> = {
  first_trade: "Completed the first successful trade.",
  trades_100: "Completed 100 successful trades.",
  fast_responder: "Maintained an average response time under 2 minutes for at least 100 completed trades.",
  customer_favorite: "Maintained a 4.95+ rating with at least 100 reviews.",
  volume_500k: "Reached the Elite Seller prestige tier.",
  perfect_month: "Achieved a 100% completion rate in a calendar month with at least 20 completed trades.",
  rising_star: "Reached Gold Seller within 30 days of becoming an approved seller.",
  trusted_veteran: "Remained an approved seller for one full year.",
};

function toIsoDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildAchievement(key: SellerAchievementKey, input: SellerAchievementEvaluationInput, metadata?: Record<string, string | number | boolean | undefined>): SellerAchievement {
  return {
    id: `${input.sellerId}:${key}`,
    key,
    title: ACHIEVEMENT_TITLES[key],
    description: ACHIEVEMENT_DESCRIPTIONS[key],
    earnedAt: new Date().toISOString(),
    source: "automatic",
    metadata,
  };
}

export function evaluateSellerAchievements(input: SellerAchievementEvaluationInput): SellerAchievement[] {
  const achievements: SellerAchievement[] = [];
  const now = new Date();

  if (input.completedTrades >= 1) {
    achievements.push(buildAchievement("first_trade", input, { completedTrades: input.completedTrades }));
  }
  if (input.completedTrades >= 100) {
    achievements.push(buildAchievement("trades_100", input, { completedTrades: input.completedTrades }));
  }
  if (input.completedTrades >= 100 && input.responseTimeMinutes < 2 && input.hasCommissionRecords) {
    achievements.push(buildAchievement("fast_responder", input, { responseTimeMinutes: input.responseTimeMinutes }));
  }
  if (input.reviewCount >= 100 && input.averageRating >= 4.95) {
    achievements.push(buildAchievement("customer_favorite", input, { averageRating: input.averageRating, reviewCount: input.reviewCount }));
  }
  if (input.rank === "elite" || input.lifetimeVolumeUsdt >= 500_000) {
    achievements.push(buildAchievement("volume_500k", input, { lifetimeVolumeUsdt: input.lifetimeVolumeUsdt }));
  }
  if (input.completionRate === 100 && input.completedTradeMonths.some((month) => month) && input.completedTrades >= 20) {
    achievements.push(buildAchievement("perfect_month", input, { completionRate: input.completionRate, completedTrades: input.completedTrades }));
  }

  const approvedAt = toIsoDate(input.approvedAt);
  const createdAt = toIsoDate(input.createdAt);
  if (input.rank === "gold" && approvedAt && createdAt && now.getTime() - approvedAt.getTime() <= 30 * 24 * 60 * 60 * 1000) {
    achievements.push(buildAchievement("rising_star", input, { approvedAt: approvedAt.toISOString() }));
  }

  if (input.sellerStatus === "approved_seller" && approvedAt && now.getTime() - approvedAt.getTime() >= 365 * 24 * 60 * 60 * 1000) {
    achievements.push(buildAchievement("trusted_veteran", input, { approvedAt: approvedAt.toISOString() }));
  }

  return achievements.filter((achievement) => achievement.key && achievement.title).map((achievement, index) => ({
    ...achievement,
    id: `${achievement.id}-${index}`,
  }));
}
