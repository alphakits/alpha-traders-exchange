import { getSellerProfileRouteData } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeUser, PremiumSellerProfileData, SellerLevel } from "@/types/alpha-exchange";

export function deriveSellerRouteUsername(input: { fullName?: string; email?: string; id?: string }) {
  const base = (input.fullName || input.email || input.id || "seller")
    .toString()
    .trim()
    .toLowerCase();

  const normalized = base
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return normalized || "seller";
}

export function resolveSellerByUsername<T extends Pick<AlphaExchangeUser, "id" | "fullName" | "email" | "sellerStatus">>(
  sellers: T[],
  username: string,
) {
  const normalizedUsername = username.toLowerCase().trim();
  return sellers.find((seller) => {
    const derived = deriveSellerRouteUsername({ fullName: seller.fullName, email: seller.email, id: seller.id });
    return derived === normalizedUsername;
  });
}

export async function getSellerProfilePageData(input: {
  username: string;
  sellerId?: string;
  viewerUserId?: string;
  viewerRole?: string;
  viewerEmail?: string;
}) {
  const routeData = await getSellerProfileRouteData({
    username: input.username,
    sellerId: input.sellerId,
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
    sellerId: string;
    sellerName: string;
    sellerLevel: SellerLevel;
    trustScore: number;
    profilePhotoUrl: string;
    publicVolumeRange: string;
  }>;
};
