import { after, NextRequest } from "next/server";
import { getTradeRoomData, postTradeRoomMessage } from "@/lib/alpha-exchange-store";
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
  toMobileTradeMessage,
} from "@/lib/mobile-trades";
import {
  prepareTradeRoomConversationEmail,
  TRADE_ROOM_MESSAGE_EMAIL_BURST_WINDOW_MS,
} from "@/lib/marketplace-email-events";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CLIENT_MESSAGE_ID_PATTERN = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;

export async function POST(request: NextRequest, context: RouteContext) {
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

    const body = await readMobileJsonBody(request);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const clientMessageId = typeof body?.clientMessageId === "string"
      ? body.clientMessageId.trim().toLowerCase()
      : "";
    if (!message || message.length > 1200 || !CLIENT_MESSAGE_ID_PATTERN.test(clientMessageId)) {
      return mobileError("MESSAGE_INVALID", requestId, locale, 400);
    }

    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "exchange:trade-room-message",
      identifier: auth.user.id,
      maxRequests: 40,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const room = await getTradeRoomData({
      purchaseRequestId: params.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      markMessagesRead: false,
      strongConsistency: true,
    });
    if (!isMobileTradeParticipant(room.request, auth.user.id)) {
      return mobileError("TRADE_NOT_FOUND", requestId, locale, 404);
    }

    // Sender identity and attachment fields are deliberately server-owned.
    // Mobile v1 accepts text only and ignores any forged identity/media fields.
    const posted = await postTradeRoomMessage({
      purchaseRequestId: params.requestId,
      actorUserId: auth.user.id,
      message,
      clientMessageId,
    });

    if (posted.created) {
      try {
        const emailBurst = await checkSharedRateLimit({
          headers: request.headers,
          key: "exchange:trade-room-message-email",
          identifier: `${posted.trade.id}:${posted.notificationRecipientUserId}`,
          maxRequests: 1,
          windowMs: TRADE_ROOM_MESSAGE_EMAIL_BURST_WINDOW_MS,
        });
        if (emailBurst.allowed) {
          const deliver = await prepareTradeRoomConversationEmail({
            event: "trade_room_message",
            request: posted.trade,
            recipientUserId: posted.notificationRecipientUserId,
            senderUserId: auth.user.id,
            senderRole: posted.senderParticipantRole,
            idempotencyKey: `trade-room-message:${posted.message.id}:${posted.notificationRecipientUserId}`,
          });
          after(deliver);
        } else if (emailBurst.reason === "limiter_unavailable") {
          logEvent("warn", {
            event: "mobile_trade_message_email_schedule",
            actorUserId: auth.user.id,
            resourceId: posted.trade.id,
            outcome: "failed",
            reason: "burst_limiter_unavailable",
          });
        }
      } catch (emailError) {
        logEvent("error", {
          event: "mobile_trade_message_email_schedule",
          actorUserId: auth.user.id,
          resourceId: posted.trade.id,
          outcome: "failed",
          reason: "post_commit_schedule_failed",
          metadata: { errorType: emailError instanceof Error ? emailError.name : typeof emailError },
        });
      }
    }

    return mobileJson(
      {
        message: toMobileTradeMessage(posted.message, auth.user.id, locale),
        created: posted.created,
      },
      requestId,
      {
        status: posted.created ? 201 : 200,
        headers: posted.created ? {} : { "X-Trade-Message-Replayed": "1" },
      },
    );
  } catch (error) {
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, requestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_message",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
