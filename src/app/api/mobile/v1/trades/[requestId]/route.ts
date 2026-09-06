import { after, NextRequest } from "next/server";
import { getTradeRoomData, updatePurchaseRequestStatus } from "@/lib/alpha-exchange-store";
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
  toMobileTradeSummary,
} from "@/lib/mobile-trades";
import { prepareTradeEventEmails, tradeEmailEventForStatus } from "@/lib/marketplace-email-events";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import type { PurchaseRequestStatus } from "@/types/alpha-exchange";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MOBILE_MUTABLE_STATUSES = new Set<PurchaseRequestStatus>([
  "accepted",
  "declined",
  "cancelled",
  "payment_sent",
  "funds_received",
  "usdt_release_pending",
  "usdt_sent",
  "completed",
]);

async function participantRoom(
  requestId: string,
  userId: string,
  role: Parameters<typeof getTradeRoomData>[0]["actorRole"],
  markMessagesRead = false,
) {
  const room = await getTradeRoomData({
    purchaseRequestId: requestId,
    actorUserId: userId,
    actorRole: role,
    markMessagesRead,
    strongConsistency: true,
  });
  return isMobileTradeParticipant(room.request, userId) ? room : null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const params = await context.params;
  if (!RESOURCE_ID_PATTERN.test(params.requestId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const room = await participantRoom(params.requestId, auth.user.id, auth.user.role, true);
    if (!room) return mobileError("TRADE_NOT_FOUND", requestId, locale, 404);
    return mobileJson({ trade: toMobileTradeDetail(room, auth.user.id, locale) }, requestId);
  } catch (error) {
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, requestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_detail",
      outcome: "failed",
      reason: "service_unavailable",
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
  const params = await context.params;
  if (!RESOURCE_ID_PATTERN.test(params.requestId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const room = await participantRoom(params.requestId, auth.user.id, auth.user.role);
    if (!room) return mobileError("TRADE_NOT_FOUND", requestId, locale, 404);

    const body = await readMobileJsonBody(request);
    const nextStatus = String(body?.status ?? "") as PurchaseRequestStatus;
    if (!MOBILE_MUTABLE_STATUSES.has(nextStatus)) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:trade:status",
      identifier: auth.user.id,
      maxRequests: 40,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const updated = await updatePurchaseRequestStatus({
      requestId: params.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      nextStatus,
      safetyAcknowledged: body?.safetyAcknowledged === true,
    });

    if (updated.deferredTrustWrite) {
      after(async () => {
        try {
          await updated.deferredTrustWrite?.();
        } catch (error) {
          logEvent("error", {
            event: "mobile_trade_deferred_trust",
            actorUserId: auth.user.id,
            resourceId: params.requestId,
            outcome: "failed",
            reason: "post_response_write_failed",
            metadata: { errorType: error instanceof Error ? error.name : typeof error },
          });
        }
      });
    }

    const emailEvent = updated.statusChanged ? tradeEmailEventForStatus(nextStatus) : null;
    if (emailEvent || updated.additionallyDeclinedRequests?.length) {
      try {
        const deliveries = await Promise.all([
          ...(updated.additionallyDeclinedRequests ?? []).map((declinedRequest) =>
            prepareTradeEventEmails({ event: "trade_rejected", request: declinedRequest }),
          ),
          ...(emailEvent
            ? [prepareTradeEventEmails({ event: emailEvent, request: updated.request })]
            : []),
        ]);
        after(() => Promise.allSettled(deliveries.map((deliver) => deliver())));
      } catch (emailError) {
        logEvent("error", {
          event: "mobile_trade_email_schedule",
          actorUserId: auth.user.id,
          resourceId: params.requestId,
          outcome: "failed",
          reason: "status_post_commit_schedule_failed",
          metadata: { errorType: emailError instanceof Error ? emailError.name : typeof emailError },
        });
      }
    }

    return mobileJson({ trade: toMobileTradeSummary(updated.request, auth.user.id) }, requestId);
  } catch (error) {
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, requestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_status",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
