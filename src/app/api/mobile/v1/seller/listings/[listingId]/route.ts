import { NextRequest } from "next/server";
import {
  canPublishListings,
  deleteMarketplaceListingForSeller,
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
  MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS,
  parseIsraeliBankSelection,
  serializeIsraeliBankSelection,
} from "@/lib/israeli-banks";
import { fetchUsdIlsMarketRate, getListingPriceValidationError } from "@/lib/listing-price-validation";
import { validateListingChangeReason } from "@/lib/listing-change-reasons";
import {
  MAX_LISTING_PAYMENT_METHODS,
  requiresIsraeliBankSelection,
  resolveListingPaymentMethods,
} from "@/lib/marketplace-payment-methods";
import {
  isIdempotentSellerListingStatus,
  sellerListingMutationError,
  toMobileSellerListing,
  toMobileSellerListingDetail,
} from "@/lib/mobile-seller-workspace";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function toNumber(value: unknown) {
  const amount = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function isValidNetwork(value: unknown): value is "TRC20" | "ERC20" | "BEP20" | "SOL" {
  return value === "TRC20" || value === "ERC20" || value === "BEP20" || value === "SOL";
}

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const { listingId } = await context.params;
  if (!RESOURCE_ID_PATTERN.test(listingId)) return mobileError("INVALID_REQUEST", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    if (!canPublishListings(auth.user)) return mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403);
    const listing = await getMarketplaceListingById(listingId);
    if (!listing || listing.sellerId !== auth.user.id) return mobileError("NOT_FOUND", requestId, locale, 404);
    return mobileJson({ listing: toMobileSellerListingDetail(listing) }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_listing_detail",
      outcome: "failed",
      reason: "service_unavailable",
      resourceId: listingId,
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}

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
    if (!canPublishListings(auth.user)) {
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
    if (action !== "pause" && action !== "resume" && action !== "update") {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const existing = await getMarketplaceListingById(listingId);
    if (!existing || existing.sellerId !== auth.user.id) {
      return mobileError("NOT_FOUND", requestId, locale, 404);
    }
    if (action === "update") {
      const availableAmount = String(body?.availableAmount ?? "").trim();
      const price = String(body?.price ?? "").trim();
      const currency = String(body?.currency ?? "ILS").trim().slice(0, 10).toUpperCase() || "ILS";
      const network = body?.network;
      const resolvedPaymentMethods = resolveListingPaymentMethods(body?.paymentMethods);
      const paymentMethods = resolvedPaymentMethods.slice(0, MAX_LISTING_PAYMENT_METHODS);
      const bankAccountId = typeof body?.bankAccountId === "string" ? body.bankAccountId.trim() : undefined;
      const banks = parseIsraeliBankSelection(String(body?.bankName ?? ""));
      const minimumTrade = String(body?.minimumTrade ?? "0").trim();
      const maximumTrade = String(body?.maximumTrade ?? availableAmount).trim();
      const sellerDescription = String(body?.sellerDescription ?? "").trim().slice(0, 2_000);
      const notes = String(body?.notes ?? "").trim().slice(0, 2_000);
      const responseTime = String(body?.responseTime ?? "5 min").trim().slice(0, 100) || "5 min";
      const expirationHours = body?.expirationHours === undefined ? undefined : Number(body.expirationHours);
      const reasonResult = validateListingChangeReason({
        reason: body?.changeReason,
        explanation: body?.changeExplanation,
      });
      if (
        toNumber(availableAmount) <= 0
        || toNumber(price) <= 0
        || !isValidNetwork(network)
        || !paymentMethods.length
        || resolvedPaymentMethods.length > MAX_LISTING_PAYMENT_METHODS
        || toNumber(minimumTrade) < 0
        || toNumber(maximumTrade) <= 0
        || toNumber(maximumTrade) < toNumber(minimumTrade)
        || toNumber(maximumTrade) > toNumber(availableAmount)
        || (expirationHours !== undefined && (!Number.isFinite(expirationHours) || expirationHours < 1 || expirationHours > 168))
        || !reasonResult.ok
      ) {
        return mobileError("INVALID_REQUEST", requestId, locale, 400);
      }
      if (requiresIsraeliBankSelection(paymentMethods) && (!banks.length || banks.length > MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS)) {
        return mobileError("INVALID_REQUEST", requestId, locale, 400);
      }
      const marketRate = await fetchUsdIlsMarketRate();
      if (getListingPriceValidationError({ price, currency, marketRate })) {
        return mobileError("INVALID_REQUEST", requestId, locale, 400);
      }
      const listing = await updateMarketplaceListingForSeller({
        listingId,
        sellerId: auth.user.id,
        actorUserId: auth.user.id,
        availableAmount,
        price,
        currency,
        network,
        paymentMethods,
        bankAccountId,
        bankName: requiresIsraeliBankSelection(paymentMethods) ? serializeIsraeliBankSelection(banks) : undefined,
        minimumTrade,
        maximumTrade,
        expirationHours,
        notes,
        sellerDescription,
        responseTime,
        changeReason: reasonResult.reason,
        changeExplanation: reasonResult.explanation,
      });
      return mobileJson({ listing: toMobileSellerListingDetail(listing) }, requestId);
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

export async function DELETE(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const { listingId } = await context.params;
  if (!RESOURCE_ID_PATTERN.test(listingId)) return mobileError("INVALID_REQUEST", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    if (!canPublishListings(auth.user)) return mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403);
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:seller-listing-delete",
      maxRequests: 10,
      windowMs: 60_000,
    });
    if (!rate.allowed) return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    const existing = await getMarketplaceListingById(listingId);
    if (!existing || existing.sellerId !== auth.user.id) return mobileError("NOT_FOUND", requestId, locale, 404);
    const body = await readMobileJsonBody(request);
    const reasonResult = validateListingChangeReason({ reason: body?.changeReason, explanation: body?.changeExplanation });
    if (!reasonResult.ok) return mobileError("INVALID_REQUEST", requestId, locale, 400);
    await deleteMarketplaceListingForSeller({
      listingId,
      sellerId: auth.user.id,
      actorUserId: auth.user.id,
      changeReason: reasonResult.reason,
      changeExplanation: reasonResult.explanation,
    });
    return mobileJson({ deleted: true as const }, requestId);
  } catch (error) {
    const mapped = sellerListingMutationError(error);
    logEvent("error", {
      event: "mobile_seller_listing_delete",
      outcome: "failed",
      reason: mapped.code.toLowerCase(),
      resourceId: listingId,
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError(mapped.code, requestId, locale, mapped.status);
  }
}
