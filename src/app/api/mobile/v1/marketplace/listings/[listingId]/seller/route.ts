import { NextRequest } from "next/server";
import type { MobileSellerProfile } from "@alpha-traders/contracts";
import { getMarketplaceListings, getPremiumSellerProfile } from "@/lib/alpha-exchange-store";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import type { PremiumSellerProfileData } from "@/types/alpha-exchange";

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

const LISTING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function toMobileSellerProfile(
  listing: { id: string; currency: string },
  profile: PremiumSellerProfileData,
): MobileSellerProfile {
  return {
    listingId: listing.id,
    displayName: profile.profile.publicTradingName || profile.profile.sellerName,
    profilePhotoUrl: profile.profile.profilePhotoUrl,
    bio: profile.profile.bio,
    memberSince: profile.profile.memberSince,
    languages: [...profile.profile.languages],
    country: profile.profile.country ?? "",
    onlineStatus: profile.profile.onlineStatus,
    availabilityStatus: profile.profile.availabilityStatus,
    isEmailVerified: profile.profile.isEmailVerified === true || profile.profile.emailVerified === true,
    isOwner: profile.profile.isOwner === true,
    isFoundingMember: profile.profile.isFoundingMember === true,
    isFoundingSeller: profile.profile.isFoundingSeller === true,
    isFeaturedSeller: profile.profile.isFeaturedSeller === true,
    canMakeOffer: listing.currency.trim().toUpperCase() === "ILS",
    level: profile.sellerLevel,
    trustScore: profile.trustScore,
    completedTrades: profile.completedTrades,
    averageRating: profile.averageRating,
    responseTimeMinutes: profile.responseTimeMinutes,
    completionRate: profile.completionRate,
    repeatBuyersPercent: profile.repeatBuyersPercent,
    totalReviews: profile.totalReviews,
    publicVolumeRange: profile.publicVolumeRange,
    badges: [...profile.badges],
    latestReviews: profile.latestReviews.map((review) => ({
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      buyerDisplayName: review.buyerName,
      verifiedPurchase: review.verifiedPurchase,
      ...(review.sellerResponse
        ? {
            sellerResponse: {
              message: review.sellerResponse.message,
              createdAt: review.sellerResponse.createdAt,
            },
          }
        : {}),
    })),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  const { listingId } = await context.params;
  if (!LISTING_ID_PATTERN.test(listingId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  try {
    const listing = (await getMarketplaceListings("active"))
      .find((candidate) => candidate.id === listingId);
    if (!listing) return mobileError("NOT_FOUND", requestId, locale, 404);

    const profile = await getPremiumSellerProfile({ sellerId: listing.sellerId });
    if (!profile) return mobileError("NOT_FOUND", requestId, locale, 404);

    return mobileJson(
      { seller: toMobileSellerProfile(listing, profile) },
      requestId,
      { headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=20" } },
    );
  } catch {
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
