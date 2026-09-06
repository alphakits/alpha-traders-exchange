import { NextRequest } from "next/server";
import type {
  MobileMarketplaceListing,
  MobileMarketplaceSort,
  MobileSupportedNetwork,
} from "@alpha-traders/contracts";
import { getMarketplaceListings } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileClientVersionError,
  mobileError,
  mobileJson,
  mobilePaginationResult,
  parseMobileClientMetadata,
  parseMobilePagination,
  readMobileBearerToken,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import type { MarketplaceListing } from "@/types/alpha-exchange";
import { safeMobileMediaUrl } from "@/lib/mobile-safe-media-url";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SUPPORTED_NETWORKS = new Set<MobileSupportedNetwork>(["TRC20", "ERC20", "BEP20", "SOL"]);
const SUPPORTED_SORTS = new Set<MobileMarketplaceSort>([
  "trust-desc",
  "price-asc",
  "amount-desc",
  "rating-desc",
  "response-fast",
  "newest",
]);

function numericValue(value: string | number | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function marketplaceRank(listing: MobileMarketplaceListing) {
  const level = listing.seller.level;
  if (level === "elite") return 5;
  if (level === "diamond") return 4;
  if (level === "gold") return 3;
  if (level === "silver") return 2;
  return 1;
}

function sortListings(listings: MobileMarketplaceListing[], sort: MobileMarketplaceSort) {
  return [...listings].sort((left, right) => {
    if (sort === "price-asc") return numericValue(left.price) - numericValue(right.price);
    if (sort === "amount-desc") return numericValue(right.availableAmount) - numericValue(left.availableAmount);
    if (sort === "rating-desc") return (right.seller.rating ?? 0) - (left.seller.rating ?? 0);
    if (sort === "response-fast") {
      return numericValue(left.seller.responseTimeMinutes ?? left.responseTime)
        - numericValue(right.seller.responseTimeMinutes ?? right.responseTime);
    }
    if (sort === "newest") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    return marketplaceRank(right) - marketplaceRank(left)
      || Number(right.seller.isFeaturedSeller) - Number(left.seller.isFeaturedSeller)
      || (right.seller.trustScore ?? 0) - (left.seller.trustScore ?? 0)
      || (right.seller.rating ?? 0) - (left.seller.rating ?? 0)
      || numericValue(left.seller.responseTimeMinutes ?? left.responseTime)
        - numericValue(right.seller.responseTimeMinutes ?? right.responseTime)
      || (right.seller.completedTrades ?? 0) - (left.seller.completedTrades ?? 0)
      || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function toMobileListing(listing: MarketplaceListing, viewerUserId?: string): MobileMarketplaceListing {
  const profile = listing.sellerProfile;
  const reputation = listing.sellerReputation;
  const isCurrentUser = Boolean(viewerUserId && listing.sellerId === viewerUserId);
  return {
    id: listing.id,
    displayNumber: listing.displayNumber,
    seller: {
      displayName: listing.sellerDisplayName,
      profilePhotoUrl: safeMobileMediaUrl(profile?.profilePhotoUrl),
      isCurrentUser,
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
    photos: listing.photos.slice(0, 6).map(safeMobileMediaUrl).filter(Boolean),
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
      canBuyNow: !isCurrentUser,
      canMakeOffer: !isCurrentUser && listing.currency.trim().toUpperCase() === "ILS",
    },
  };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const versionError = mobileClientVersionError(metadata, requestId, locale);
  if (versionError) return versionError;
  const pagination = parseMobilePagination(request, { defaultLimit: 30, maxLimit: 50 });
  if (!pagination) return mobileError("INVALID_REQUEST", requestId, locale, 400);
  const listingId = request.nextUrl.searchParams.get("listingId")?.trim() ?? "";
  if (listingId && !RESOURCE_ID_PATTERN.test(listingId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
  const networkValue = request.nextUrl.searchParams.get("network")?.trim().toUpperCase() ?? "";
  const currency = request.nextUrl.searchParams.get("currency")?.trim().toUpperCase() ?? "";
  const paymentMethod = request.nextUrl.searchParams.get("payment")?.trim() ?? "";
  const onlineValue = request.nextUrl.searchParams.get("online")?.trim() ?? "";
  const sortValue = request.nextUrl.searchParams.get("sort")?.trim() || "trust-desc";
  if (
    (networkValue && !SUPPORTED_NETWORKS.has(networkValue as MobileSupportedNetwork))
    || (currency && !/^[A-Z]{3,5}$/.test(currency))
    || paymentMethod.length > 80
    || /[\u0000-\u001F\u007F]/.test(paymentMethod)
    || (onlineValue && onlineValue !== "0" && onlineValue !== "1")
    || !SUPPORTED_SORTS.has(sortValue as MobileMarketplaceSort)
  ) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
  try {
    let viewerUserId: string | undefined;
    if (readMobileBearerToken(request)) {
      const auth = await requireMobileApiUser(request, requestId, metadata);
      if (!auth.user) return auth.unauthorized;
      viewerUserId = auth.user.id;
    }
    const visibleListings = (await getMarketplaceListings())
      .filter((listing) => listing.status === "active" && listing.approvalStatus !== "rejected")
      .filter((listing) => !listingId || listing.id === listingId)
      .map((listing) => toMobileListing(listing, viewerUserId));
    const facets = {
      networks: Array.from(new Set(visibleListings.map((listing) => listing.network))).sort(),
      currencies: Array.from(new Set(visibleListings.map((listing) => listing.currency))).sort(),
      paymentMethods: Array.from(new Set(visibleListings.flatMap((listing) => listing.paymentMethods))).sort(),
    };
    const filteredListings = sortListings(visibleListings.filter((listing) => {
      const networkMatches = !networkValue || listing.network === networkValue;
      const currencyMatches = !currency || listing.currency.toUpperCase() === currency;
      const paymentMatches = !paymentMethod
        || listing.paymentMethods.some((method) => method.toLowerCase() === paymentMethod.toLowerCase());
      const onlineMatches = onlineValue !== "1" || listing.seller.onlineStatus === "online";
      return networkMatches && currencyMatches && paymentMatches && onlineMatches;
    }), sortValue as MobileMarketplaceSort);
    const listings = filteredListings.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return mobileJson({
      listings,
      total: filteredListings.length,
      facets,
      pagination: mobilePaginationResult(pagination, listings.length, filteredListings.length),
    }, requestId, {
      headers: {
        "Cache-Control": viewerUserId ? "no-store, max-age=0" : "public, max-age=5, stale-while-revalidate=20",
        Vary: "Accept-Language, X-App-Version, X-Platform, Authorization",
      },
    });
  } catch {
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
