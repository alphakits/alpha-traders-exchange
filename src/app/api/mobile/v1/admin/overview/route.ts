import { after, NextRequest } from "next/server";
import {
  approveSellerApplicationByAdmin,
  getOwnerPendingListingsDashboardData,
  getPendingSellerApplicationsForAdmin,
  rejectSellerApplicationByAdmin,
  reviewMarketplaceListingByOwner,
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
import { prepareListingReviewEmails } from "@/lib/marketplace-email-events";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { hasRole } from "@/lib/roles";
import { logEvent } from "@/lib/structured-logging";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ACTIVE_TRADE_STATUSES = new Set([
  "pending",
  "accepted",
  "payment_sent",
  "funds_received",
  "usdt_release_pending",
  "usdt_sent",
  "locked",
  "review_open",
]);

async function overviewPayload() {
  const [dashboard, pendingSellerApplications] = await Promise.all([
    getOwnerPendingListingsDashboardData(),
    getPendingSellerApplicationsForAdmin(),
  ]);
  const pendingListings = dashboard.pendingListings.map((listing) => ({
    id: listing.id,
    displayNumber: listing.displayNumber,
    sellerId: listing.sellerId,
    sellerDisplayName: listing.sellerDisplayName,
    availableAmount: listing.availableAmount,
    price: listing.price,
    currency: listing.currency,
    network: listing.network,
    paymentMethods: [...listing.paymentMethods],
    bankName: listing.bankName,
    minimumTrade: listing.minimumTrade,
    maximumTrade: listing.maximumTrade,
    sellerDescription: listing.sellerDescription,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  }));
  const applications = pendingSellerApplications.map((application) => ({
    id: application.id,
    displayNumber: application.displayNumber,
    userId: application.userId,
    fullName: application.fullName,
    email: application.email,
    whatsappNumber: application.whatsappNumber,
    preferredNetworks: [...application.preferredNetworks],
    expectedMonthlyTradingVolume: application.expectedMonthlyTradingVolume,
    additionalNotes: application.additionalNotes,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  }));
  return {
    pendingListings,
    pendingSellerApplications: applications,
    metrics: {
      pendingListings: pendingListings.length,
      pendingSellerApplications: applications.length,
      activeTrades: dashboard.purchaseRequests.filter((trade) => ACTIVE_TRADE_STATUSES.has(trade.status)).length,
      totalListings: dashboard.allListings.length,
    },
  };
}

async function requireAdmin(request: NextRequest, requestId: string) {
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return { response: mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400) };
  const auth = await requireMobileApiUser(request, requestId, metadata);
  if (!auth.user) return { response: auth.unauthorized };
  if (!hasRole(auth.user, "admin") && !hasRole(auth.user, "owner")) {
    return { response: mobileError("UNAUTHORIZED", requestId, locale, 403) };
  }
  return { user: auth.user, locale };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  try {
    const auth = await requireAdmin(request, requestId);
    if (auth.response) return auth.response;
    return mobileJson(await overviewPayload(), requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_admin_overview",
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
  try {
    const auth = await requireAdmin(request, requestId);
    if (auth.response) return auth.response;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:admin-review",
      maxRequests: 30,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    }
    const body = await readMobileJsonBody(request);
    const target = String(body?.target ?? "");
    const id = String(body?.id ?? "").trim();
    const decision = String(body?.decision ?? "");
    const reason = String(body?.reason ?? "").trim().slice(0, 500);
    if (!RESOURCE_ID_PATTERN.test(id)) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    if (target === "listing" && (decision === "approve" || decision === "reject" || decision === "request_changes")) {
      if (decision !== "approve" && reason.length < 3) {
        return mobileError("INVALID_REQUEST", requestId, locale, 400);
      }
      const listing = await reviewMarketplaceListingByOwner({
        listingId: id,
        ownerUserId: auth.user.id,
        decision,
        reason: reason || undefined,
      });
      if (decision === "approve" || decision === "reject") {
        const deliverEmails = await prepareListingReviewEmails({ decision, listing, reason: reason || undefined });
        after(deliverEmails);
      }
    } else if (target === "seller_application" && (decision === "approve" || decision === "reject")) {
      if (reason.length < 3) return mobileError("INVALID_REQUEST", requestId, locale, 400);
      if (decision === "approve") await approveSellerApplicationByAdmin(id, auth.user.id, reason);
      else await rejectSellerApplicationByAdmin(id, auth.user.id, reason);
    } else {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    return mobileJson(await overviewPayload(), requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_admin_review",
      outcome: "failed",
      reason: "invalid_or_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}
