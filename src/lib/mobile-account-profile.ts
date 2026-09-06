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
    fullName: profile.fullName,
    email: profile.email,
    profilePhotoUrl: safeMobileMediaUrl(profile.profilePhotoUrl),
    bio: profile.bio,
    country: profile.country,
    language: profile.language,
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
    progressToNextLevelPercent: stats.progressToNextLevelPercent,
  };
}
