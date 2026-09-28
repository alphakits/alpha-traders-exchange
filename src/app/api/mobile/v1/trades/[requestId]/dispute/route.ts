import { NextRequest } from "next/server";
import { getTradeRoomData, openTradeDispute } from "@/lib/alpha-exchange-store";
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
    const isBuyer = room.request.buyerId === auth.user.id;
    if (!isBuyer || (!room.canOpenDispute && !room.hasOpenDispute)) {
      return mobileError("TRADE_ACTION_NOT_ALLOWED", responseRequestId, locale, 409);
    }

    const body = await readMobileJsonBody(request);
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 500) {
      return mobileError("DISPUTE_INVALID", responseRequestId, locale, 400);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:trade:dispute",
      identifier: auth.user.id,
      maxRequests: 6,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", responseRequestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    // The canonical store makes an exact replay with the same actor and reason
    // return the existing dispute. Participant identity is always server-owned.
    await openTradeDispute({
      purchaseRequestId: requestId,
      openedByUserId: auth.user.id,
      reason,
    });
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
      event: "mobile_trade_dispute",
      outcome: "failed",
      reason: "service_unavailable",
      resourceId: requestId,
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId: responseRequestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", responseRequestId, locale, 503);
  }
}
