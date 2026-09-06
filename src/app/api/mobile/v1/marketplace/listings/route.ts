import { NextRequest } from "next/server";
import type { MobileMarketplaceListing } from "@alpha-traders/contracts";
import { getMarketplaceListings } from "@/lib/alpha-exchange-store";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  mobilePaginationResult,
  parseMobileClientMetadata,
  parseMobilePagination,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import type { MarketplaceListing } from "@/types/alpha-exchange";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function toMobileListing(listing: MarketplaceListing): MobileMarketplaceListing {
  const profile = listing.sellerProfile;
  const reputation = listing.sellerReputation;
  return {
    id: listing.id,
    displayNumber: listing.displayNumber,
    seller: {
      displayName: listing.sellerDisplayName,
      profilePhotoUrl: profile?.profilePhotoUrl ?? "",
      isOwner: profile?.isOwner === true,
      isFoundingSeller: profile?.isFoundingSeller === true,
      isFeaturedSeller: profile?.isFeaturedSeller === true,
      onlineStatus: profile?.onlineStatus ?? "offline",
      availabilityStatus: profile?.availabilityStatus ?? "away",
      level: reputation?.level,
      trustScore: reputation?.trustScore,
      rating: reputation?.rating,
      completedTrades: reputation?.completedTrades,
      responseTimeMinutes: reputation?.responseTimeMinutes,
    },
    photos: listing.photos.slice(0, 6),
    availableAmount: listing.availableAmount,
    price: listing.price,
    currency: listing.currency,
    network: listing.network,
    paymentMethods: [...listing.paymentMethods],
    minimumTrade: listing.minimumTrade,
    maximumTrade: listing.maximumTrade,
    responseTime: listing.responseTime,
    expiresAt: listing.expiresAt,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
    actions: {
      canViewSellerProfile: true,
      canBuyNow: true,
      canMakeOffer: listing.currency.trim().toUpperCase() === "ILS",
    },
  };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const pagination = parseMobilePagination(request, { defaultLimit: 30, maxLimit: 50 });
  if (!pagination) return mobileError("INVALID_REQUEST", requestId, locale, 400);
  const listingId = request.nextUrl.searchParams.get("listingId")?.trim() ?? "";
  if (listingId && !RESOURCE_ID_PATTERN.test(listingId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
  try {
    const visibleListings = (await getMarketplaceListings())
      .filter((listing) => listing.status === "active" && listing.approvalStatus !== "rejected")
      .filter((listing) => !listingId || listing.id === listingId)
      .map(toMobileListing);
    const listings = visibleListings.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return mobileJson({
      listings,
      total: visibleListings.length,
      pagination: mobilePaginationResult(pagination, listings.length, visibleListings.length),
    }, requestId, {
      headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=20" },
    });
  } catch {
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
