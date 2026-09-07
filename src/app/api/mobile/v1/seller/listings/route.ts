import { NextRequest } from "next/server";
import {
  canPublishListings,
  createMarketplaceListing,
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
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import {
  MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS,
  parseIsraeliBankSelection,
  serializeIsraeliBankSelection,
} from "@/lib/israeli-banks";
import { fetchUsdIlsMarketRate, getListingPriceValidationError } from "@/lib/listing-price-validation";
import {
  MAX_LISTING_PAYMENT_METHODS,
  requiresIsraeliBankSelection,
  resolveListingPaymentMethods,
} from "@/lib/marketplace-payment-methods";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { toMobileSellerListing } from "@/lib/mobile-seller-workspace";
import { logEvent } from "@/lib/structured-logging";
import type { SupportedNetwork } from "@/types/alpha-exchange";

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

function toNumber(value: unknown) {
  const amount = Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function isValidNetwork(value: unknown): value is SupportedNetwork {
  return value === "TRC20" || value === "ERC20" || value === "BEP20" || value === "SOL";
}

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
    if (!canPublishListings(auth.user)) {
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

export async function POST(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    if (!canPublishListings(auth.user)) {
      return mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:seller-listing-create",
      maxRequests: 10,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    }

    const body = await readMobileJsonBody(request);
    if (!body) return mobileError("INVALID_REQUEST", requestId, locale, 400);
    const availableAmount = String(body.availableAmount ?? "").trim();
    const price = String(body.price ?? "").trim();
    const currency = String(body.currency ?? "ILS").trim().slice(0, 10).toUpperCase() || "ILS";
    const network = body.network;
    const resolvedPaymentMethods = resolveListingPaymentMethods(body.paymentMethods);
    const paymentMethods = resolvedPaymentMethods.slice(0, MAX_LISTING_PAYMENT_METHODS);
    const bankAccountId = typeof body.bankAccountId === "string" ? body.bankAccountId.trim() : undefined;
    const banks = parseIsraeliBankSelection(String(body.bankName ?? ""));
    const minimumTrade = String(body.minimumTrade ?? "0").trim();
    const maximumTrade = String(body.maximumTrade ?? availableAmount).trim();
    const sellerDescription = String(body.sellerDescription ?? "").trim().slice(0, 2_000);
    const notes = String(body.notes ?? "").trim().slice(0, 2_000);
    const responseTime = String(body.responseTime ?? "5 min").trim().slice(0, 100) || "5 min";
    const expirationHours = body.expirationHours === undefined ? 24 : Number(body.expirationHours);

    if (
      toNumber(availableAmount) <= 0
      || toNumber(price) <= 0
      || !isValidNetwork(network)
      || !paymentMethods.length
      || resolvedPaymentMethods.length > MAX_LISTING_PAYMENT_METHODS
      || body.acceptedCommissionPolicy !== true
      || toNumber(minimumTrade) < 0
      || toNumber(maximumTrade) <= 0
      || toNumber(maximumTrade) < toNumber(minimumTrade)
      || toNumber(maximumTrade) > toNumber(availableAmount)
      || !Number.isFinite(expirationHours)
      || expirationHours < 1
      || expirationHours > 168
    ) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    if (requiresIsraeliBankSelection(paymentMethods)) {
      if (!banks.length || banks.length > MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS) {
        return mobileError("INVALID_REQUEST", requestId, locale, 400);
      }
    }
    const marketRate = await fetchUsdIlsMarketRate();
    if (getListingPriceValidationError({ price, currency, marketRate })) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const listing = await createMarketplaceListing({
      sellerId: auth.user.id,
      sellerDisplayName: auth.user.fullName,
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
      acceptedCommissionPolicy: true,
      actorUserId: auth.user.id,
    });
    return mobileJson({ listing: toMobileSellerListing(listing) }, requestId, { status: 201 });
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_listing_create",
      outcome: "failed",
      reason: "invalid_or_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}
