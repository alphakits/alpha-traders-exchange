import {
  derivePublicProfileUsername,
  getSellerProfileRouteData,
  matchesPublicProfileUsername,
} from "@/lib/alpha-exchange-store";
import type { AlphaExchangeUser, PremiumSellerProfileData, SellerLevel } from "@/types/alpha-exchange";

export function deriveSellerRouteUsername(input: { fullName?: string; email?: string; id?: string; publicTradingName?: string }) {
  return derivePublicProfileUsername(input);
}

export function resolveSellerByUsername<T extends Pick<AlphaExchangeUser, "id" | "fullName" | "email" | "sellerStatus" | "buyerDisplayName">>(
  sellers: T[],
  username: string,
) {
  const normalizedUsername = username.toLowerCase().trim();
  return sellers.find((seller) => {
    return matchesPublicProfileUsername(
      { fullName: seller.fullName, email: seller.email, id: seller.id, publicTradingName: seller.buyerDisplayName },
      normalizedUsername,
    );
  });
}

export async function getSellerProfilePageData(input: {
  username: string;
  viewerUserId?: string;
  viewerRole?: string;
  viewerEmail?: string;
}) {
  const routeData = await getSellerProfileRouteData({
    username: input.username,
    viewerUserId: input.viewerUserId,
    viewerRole: input.viewerRole as never,
    viewerEmail: input.viewerEmail,
  });

  if (!routeData?.profile) {
    return null;
  }

  return {
    profile: routeData.profile,
    sellerListings: routeData.sellerListings,
    similarSellers: routeData.similarSellers,
  };
}

export function formatSellerLevelLabel(level?: SellerLevel) {
  if (level === "elite") return "Alpha Elite Seller";
  if (level === "diamond") return "Alpha Diamond Seller";
  if (level === "gold") return "Alpha Gold Seller";
  if (level === "silver") return "Alpha Silver Seller";
  return "Alpha Bronze Seller";
}

export function formatSellerBadgeLabel(badge: string) {
  if (badge === "elite_seller") return "Elite Seller";
  if (badge === "top_rated") return "Top Rated";
  if (badge === "fast_responder") return "Fast Responder";
  if (badge === "trusted_seller") return "Trusted Seller";
  if (badge === "most_active") return "Most Active";
  if (badge === "platinum_seller") return "Platinum Seller";
  return "1000+ Trades";
}

export type SellerProfilePageData = {
  profile: PremiumSellerProfileData | null;
  sellerListings: Array<{
    id: string;
    sellerId: string;
    sellerDisplayName: string;
    price: string;
    availableAmount: string;
    network: string;
    paymentMethod: string;
    sellerProfile?: { profilePhotoUrl?: string };
    sellerReputation?: { level?: SellerLevel; trustScore?: number; publicVolumeRange?: string };
  }>;
  similarSellers: Array<{
    sellerUsername: string;
    sellerName: string;
    sellerLevel: SellerLevel;
    trustScore: number;
    profilePhotoUrl: string;
    publicVolumeRange: string;
  }>;
};
