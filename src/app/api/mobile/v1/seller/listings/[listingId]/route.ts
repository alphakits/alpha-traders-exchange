import { NextRequest } from "next/server";
import {
  getMarketplaceListingById,
  updateMarketplaceListingForSeller,
} from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import {
  isIdempotentSellerListingStatus,
  sellerListingMutationError,
  toMobileSellerListing,
} from "@/lib/mobile-seller-workspace";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { hasRole } from "@/lib/roles";
import { logEvent } from "@/lib/structured-logging";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const { listingId } = await context.params;
  if (!RESOURCE_ID_PATTERN.test(listingId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    if (!hasRole(auth.user, "approved_seller")) {
      return mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:seller-listing-status",
      maxRequests: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }
    const body = await readMobileJsonBody(request);
    const action = String(body?.action ?? "").trim();
    if (action !== "pause" && action !== "resume") {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const existing = await getMarketplaceListingById(listingId);
    if (!existing || existing.sellerId !== auth.user.id) {
      return mobileError("NOT_FOUND", requestId, locale, 404);
    }
    const nextStatus = action === "pause" ? "paused" : "active";
    if (isIdempotentSellerListingStatus(existing, nextStatus)) {
      return mobileJson({ listing: toMobileSellerListing(existing) }, requestId);
    }
    if (
      (action === "pause" && existing.status !== "active")
      || (action === "resume" && existing.status !== "paused")
    ) {
      return mobileError("LISTING_ACTION_NOT_ALLOWED", requestId, locale, 409);
    }
    const listing = await updateMarketplaceListingForSeller({
      listingId,
      sellerId: auth.user.id,
      actorUserId: auth.user.id,
      status: nextStatus,
    });
    return mobileJson({ listing: toMobileSellerListing(listing) }, requestId);
  } catch (error) {
    const mapped = sellerListingMutationError(error);
    logEvent("error", {
      event: "mobile_seller_listing_status",
      outcome: "failed",
      reason: mapped.code.toLowerCase(),
      resourceId: listingId,
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError(mapped.code, requestId, locale, mapped.status);
  }
}
