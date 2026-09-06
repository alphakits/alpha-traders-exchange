import { NextRequest } from "next/server";
import type { MobileSellerProfile } from "@alpha-traders/contracts";
import { getMarketplaceListings, getPremiumSellerProfile } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileClientVersionError,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileBearerToken,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import type { PremiumSellerProfileData } from "@/types/alpha-exchange";

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

const LISTING_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function toMobileSellerProfile(
  listing: { id: string; currency: string; sellerId: string },
  profile: PremiumSellerProfileData,
  viewerUserId?: string,
): MobileSellerProfile {
  const isCurrentUser = Boolean(viewerUserId && listing.sellerId === viewerUserId);
  return {
    listingId: listing.id,
    displayName: profile.profile.publicTradingName || profile.profile.sellerName,
    isCurrentUser,
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
    canBuyNow: !isCurrentUser,
    canMakeOffer: !isCurrentUser && listing.currency.trim().toUpperCase() === "ILS",
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
  const versionError = mobileClientVersionError(metadata, requestId, locale);
  if (versionError) return versionError;

  const { listingId } = await context.params;
  if (!LISTING_ID_PATTERN.test(listingId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  try {
    let viewerUserId: string | undefined;
    if (readMobileBearerToken(request)) {
      const auth = await requireMobileApiUser(request, requestId, metadata);
      if (!auth.user) return auth.unauthorized;
      viewerUserId = auth.user.id;
    }
    const listing = (await getMarketplaceListings("active"))
      .find((candidate) => candidate.id === listingId);
    if (!listing) return mobileError("NOT_FOUND", requestId, locale, 404);

    const profile = await getPremiumSellerProfile({ sellerId: listing.sellerId });
    if (!profile) return mobileError("NOT_FOUND", requestId, locale, 404);

    return mobileJson(
      { seller: toMobileSellerProfile(listing, profile, viewerUserId) },
      requestId,
      {
        headers: {
          "Cache-Control": viewerUserId ? "no-store, max-age=0" : "public, max-age=5, stale-while-revalidate=20",
          Vary: "Accept-Language, X-App-Version, X-Platform, Authorization",
        },
      },
    );
  } catch {
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
