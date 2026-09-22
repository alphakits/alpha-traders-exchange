import type { RoleBadgeVariant } from "@/components/ui/role-badge";
export type AccountProfilePayload = {
  profile: {
    id: string;
    profilePhotoUrl: string;
    coverBannerUrl?: string;
    fullName: string;
    nextNameChangeAt?: string;
    username: string;
    email: string;
    role: string;
    roles?: string[];
    onboardingSelection?: "guest" | "student" | "buyer" | "seller_applicant";
    onboardingCompletedAt?: string;
    memberSince: string;
    lastLogin: string;
    onlineStatus: "online" | "offline";
    bio: string;
    country: string;
    language: string;
    whatsappNumber: string;
    showTradeStats?: boolean;
    showLastActive?: boolean;
    allowDirectMessages?: boolean;
    allowProfileSearch?: boolean;
    showPhonePublic?: boolean;
    showEmailPublic?: boolean;
  };
  stats:
    | {
        kind: "seller";
        sellerLevel: string;
        nextLevel?: string;
        progressToNextLevelPercent: number;
        amountToNextLevelUsdt: number;
        lifetimeCompletedVolumeUsdt: number;
        commissionPaid: number;
        averageTradeSize: number;
        promotionHistory: Array<{ id: string; rank: string; promotedAt: string }>;
        trustScore: number;
        completedTrades: number;
        activeListings: number;
        pendingListings: number;
        averageRating: number;
        buyerActivity?: {
          buyerLevel: "bronze" | "silver" | "gold" | "diamond" | "elite";
          nextLevel?: "bronze" | "silver" | "gold" | "diamond" | "elite";
          progressToNextLevelPercent: number;
          amountToNextLevelUsdt: number;
          requiredVolumeUsdt: number;
          lifetimeCompletedVolumeUsdt: number;
          activeTrades: number;
          completedTrades: number;
          reviewsGiven: number;
        };
      }
    | {
        kind: "buyer";
        buyerLevel: "bronze" | "silver" | "gold" | "diamond" | "elite";
        nextLevel?: "bronze" | "silver" | "gold" | "diamond" | "elite";
        progressToNextLevelPercent: number;
        amountToNextLevelUsdt: number;
        requiredVolumeUsdt: number;
        lifetimeCompletedVolumeUsdt: number;
        activeTrades: number;
        completedTrades: number;
        reviewsGiven: number;
      };
  roleBadge: RoleBadgeVariant;
  roleLabel: "Guest" | "Student" | "Buyer" | "Pending Seller" | "Approved Seller" | "Administrator" | "Owner";
  accountStatuses: string[];
};
