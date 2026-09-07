import type {
  MobileAccountProfile,
  MobileAccountStats,
} from "@alpha-traders/contracts";
import type {
  AccountProfileSummary,
  BuyerAccountStats,
  SellerAccountStats,
} from "@/lib/alpha-exchange-store";
import { safeMobileMediaUrl } from "@/lib/mobile-safe-media-url";

export function toMobileAccountProfile(profile: AccountProfileSummary): MobileAccountProfile {
  return {
    id: profile.id,
    fullName: profile.fullName,
    username: profile.username,
    email: profile.email,
    profilePhotoUrl: safeMobileMediaUrl(profile.profilePhotoUrl),
    coverBannerUrl: safeMobileMediaUrl(profile.coverBannerUrl),
    role: profile.role,
    sellerStatus: profile.sellerStatus,
    onlineStatus: profile.onlineStatus,
    bio: profile.bio,
    country: profile.country,
    language: profile.language,
    whatsappNumber: profile.whatsappNumber,
    memberSince: profile.memberSince,
    lastLogin: profile.lastLogin,
    showTradeStats: profile.showTradeStats,
    showLastActive: profile.showLastActive,
    allowDirectMessages: profile.allowDirectMessages,
    allowProfileSearch: profile.allowProfileSearch,
    showPhonePublic: profile.showPhonePublic,
    showEmailPublic: profile.showEmailPublic,
  };
}

export function toMobileAccountStats(
  stats: BuyerAccountStats | SellerAccountStats,
): MobileAccountStats {
  if (stats.kind === "seller") {
    return {
      kind: "seller",
      level: stats.sellerLevel,
      lifetimeCompletedVolumeUsdt: stats.lifetimeCompletedVolumeUsdt,
      completedTrades: stats.completedTrades,
      activeListings: stats.activeListings,
      pendingListings: stats.pendingListings,
      averageRating: stats.averageRating,
      trustScore: stats.trustScore,
      nextLevel: stats.nextLevel,
      amountToNextLevelUsdt: stats.amountToNextLevelUsdt,
      commissionPaidUsdt: stats.commissionPaid,
      averageTradeSizeUsdt: stats.averageTradeSize,
      promotionHistory: stats.promotionHistory.map((entry) => ({
        id: entry.id,
        rank: entry.rank,
        promotedAt: entry.promotedAt,
      })),
      buyerActivity: {
        level: stats.buyerActivity.buyerLevel,
        nextLevel: stats.buyerActivity.nextLevel,
        progressToNextLevelPercent: stats.buyerActivity.progressToNextLevelPercent,
        amountToNextLevelUsdt: stats.buyerActivity.amountToNextLevelUsdt,
        requiredVolumeUsdt: stats.buyerActivity.requiredVolumeUsdt,
        lifetimeCompletedVolumeUsdt: stats.buyerActivity.lifetimeCompletedVolumeUsdt,
        activeTrades: stats.buyerActivity.activeTrades,
        completedTrades: stats.buyerActivity.completedTrades,
        reviewsGiven: stats.buyerActivity.reviewsGiven,
      },
      progressToNextLevelPercent: stats.progressToNextLevelPercent,
    };
  }
  return {
    kind: "buyer",
    level: stats.buyerLevel,
    lifetimeCompletedVolumeUsdt: stats.lifetimeCompletedVolumeUsdt,
    activeTrades: stats.activeTrades,
    completedTrades: stats.completedTrades,
    reviewsGiven: stats.reviewsGiven,
    nextLevel: stats.nextLevel,
    amountToNextLevelUsdt: stats.amountToNextLevelUsdt,
    requiredVolumeUsdt: stats.requiredVolumeUsdt,
    progressToNextLevelPercent: stats.progressToNextLevelPercent,
  };
}
