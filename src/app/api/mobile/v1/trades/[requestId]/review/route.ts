import { NextRequest } from "next/server";
import {
  getTradeRoomData,
  submitBuyerTradeReview,
  submitSellerReviewResponse,
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
  isMobileTradeParticipant,
  mobileTradeErrorCode,
  mobileTradeErrorStatus,
  toMobileTradeDetail,
} from "@/lib/mobile-trades";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export async function POST(request: NextRequest, context: RouteContext) {
  const responseRequestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", responseRequestId, locale, 400);
  const { requestId } = await context.params;
  if (!RESOURCE_ID_PATTERN.test(requestId)) {
    return mobileError("INVALID_REQUEST", responseRequestId, locale, 400);
  }

  try {
    const auth = await requireMobileApiUser(request, responseRequestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const room = await getTradeRoomData({
      purchaseRequestId: requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      markMessagesRead: false,
      strongConsistency: true,
    });
    if (!isMobileTradeParticipant(room.request, auth.user.id)) {
      return mobileError("TRADE_NOT_FOUND", responseRequestId, locale, 404);
    }

    const body = await readMobileJsonBody(request);
    const isBuyer = room.request.buyerId === auth.user.id;
    if (isBuyer) {
      const rating = body?.rating;
      const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
      if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5 || !comment || comment.length > 500) {
        return mobileError("REVIEW_INVALID", responseRequestId, locale, 400);
      }
      const rate = await checkSharedRateLimit({
        headers: request.headers,
        key: "mobile:trade:review",
        identifier: auth.user.id,
        maxRequests: 12,
        windowMs: 60_000,
      });
      if (!rate.allowed) {
        return mobileError("RATE_LIMITED", responseRequestId, locale, 429, {
          retryAfterSeconds: rate.retryAfterSeconds,
        });
      }
      await submitBuyerTradeReview({
        requestId,
        buyerUserId: auth.user.id,
        rating,
        comment,
      });
    } else {
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      if (!message || message.length > 500) {
        return mobileError("REVIEW_INVALID", responseRequestId, locale, 400);
      }
      const rate = await checkSharedRateLimit({
        headers: request.headers,
        key: "mobile:trade:review-response",
        identifier: auth.user.id,
        maxRequests: 12,
        windowMs: 60_000,
      });
      if (!rate.allowed) {
        return mobileError("RATE_LIMITED", responseRequestId, locale, 429, {
          retryAfterSeconds: rate.retryAfterSeconds,
        });
      }
      await submitSellerReviewResponse({
        requestId,
        sellerUserId: auth.user.id,
        message,
      });
    }

    const refreshed = await getTradeRoomData({
      purchaseRequestId: requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      markMessagesRead: false,
      strongConsistency: true,
    });
    return mobileJson({ trade: toMobileTradeDetail(refreshed, auth.user.id, locale) }, responseRequestId);
  } catch (error) {
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, responseRequestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_review",
      outcome: "failed",
      reason: "service_unavailable",
      resourceId: requestId,
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId: responseRequestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", responseRequestId, locale, 503);
  }
}
