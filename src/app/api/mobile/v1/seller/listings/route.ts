import { NextRequest } from "next/server";
import {
  getMyMarketplaceListings,
  getSellerListingWorkspaceSummary,
} from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  mobilePaginationResult,
  parseMobileClientMetadata,
  parseMobilePagination,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { toMobileSellerListing } from "@/lib/mobile-seller-workspace";
import { hasRole } from "@/lib/roles";
import { logEvent } from "@/lib/structured-logging";

const SELLER_LISTING_STATUSES = new Set([
  "all",
  "draft",
  "active",
  "paused",
  "matched",
  "in_trade",
  "expired",
  "completed",
  "cancelled",
  "closed",
]);

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const pagination = parseMobilePagination(request, { defaultLimit: 30, maxLimit: 50 });
  if (!pagination) return mobileError("INVALID_REQUEST", requestId, locale, 400);
  const status = request.nextUrl.searchParams.get("status")?.trim() || "all";
  if (!SELLER_LISTING_STATUSES.has(status)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    if (!hasRole(auth.user, "approved_seller")) {
      return mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403);
    }
    const [rawListings, rawSummary] = await Promise.all([
      getMyMarketplaceListings(auth.user.id, status),
      getSellerListingWorkspaceSummary(auth.user.id),
    ]);
    const ownedListings = rawListings
      .filter((listing) => listing.sellerId === auth.user.id)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .map(toMobileSellerListing);
    const listings = ownedListings.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );
    return mobileJson({
      listings,
      total: ownedListings.length,
      pagination: mobilePaginationResult(pagination, listings.length, ownedListings.length),
      availabilityStatus: auth.user.availabilityStatus ?? "available",
      summary: {
        activeListingLimit: rawSummary.activeListingLimit,
        openListingCount: rawSummary.openListingCount,
        openTradeCount: rawSummary.openTradeCount,
        pendingCommissionCount: rawSummary.pendingCommissionCount,
        canCreateListing: rawSummary.canCreateListing,
      },
    }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_listings_list",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
