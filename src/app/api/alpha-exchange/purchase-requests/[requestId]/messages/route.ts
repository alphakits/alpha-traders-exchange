import { after, NextRequest, NextResponse } from "next/server";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { getTradeRoomData, postTradeRoomMessage } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { prepareTradeRoomConversationEmail, TRADE_ROOM_MESSAGE_EMAIL_BURST_WINDOW_MS } from "@/lib/marketplace-email-events";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;

  try {
    const { requestId } = await context.params;
    const room = await getTradeRoomData({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      actorRole: user.role,
      markMessagesRead: false,
      strongConsistency: false,
    });
    return NextResponse.json({
      messages: room.messages,
      trade: room.request,
      listing: room.listing,
      counterpart: room.counterpart,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load messages." },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;

  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "exchange:trade-room-message",
    maxRequests: 40,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many messages. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const { requestId } = await context.params;
    const body = (await request.json()) as { message?: string; imageUrl?: string; imageName?: string; imageMimeType?: string };
    const posted = await postTradeRoomMessage({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      message: String(body.message ?? ""),
      imageUrl: body.imageUrl,
      imageName: body.imageName,
      imageMimeType: body.imageMimeType,
    });
    // One immediate transactional email per recipient/trade burst. The shared
    // limiter is PostgreSQL-backed in production and cannot be bypassed with a
    // refresh, another device, or another Vercel instance. Chat and bell/SSE
    // delivery have already committed and never depend on this provider work.
    try {
      const emailBurst = await checkSharedRateLimit({
        headers: request.headers,
        key: "exchange:trade-room-message-email",
        identifier: `${posted.trade.id}:${posted.notificationRecipientUserId}`,
        maxRequests: 1,
        windowMs: TRADE_ROOM_MESSAGE_EMAIL_BURST_WINDOW_MS,
      });
      if (emailBurst.allowed) {
        const deliverEmail = await prepareTradeRoomConversationEmail({
          event: "trade_room_message",
          request: posted.trade,
          recipientUserId: posted.notificationRecipientUserId,
          senderUserId: user.id,
          senderRole: posted.senderParticipantRole,
          idempotencyKey: `trade-room-message:${posted.message.id}:${posted.notificationRecipientUserId}`,
        });
        after(deliverEmail);
      } else if (emailBurst.reason === "limiter_unavailable") {
        logEvent("warn", {
          event: "trade_room_email_schedule",
          actorUserId: user.id,
          resourceId: posted.trade.id,
          outcome: "failed",
          reason: "burst_limiter_unavailable",
        });
      }
    } catch (emailScheduleError) {
      logEvent("error", {
        event: "trade_room_email_schedule",
        actorUserId: user.id,
        resourceId: posted.trade.id,
        outcome: "failed",
        reason: "post_commit_schedule_failed",
        metadata: { errorType: emailScheduleError instanceof Error ? emailScheduleError.name : typeof emailScheduleError },
      });
    }
    const routeMs = Date.now() - routeStartedAt;
    const queueMs = Math.max(0, routeMs - posted.metrics.totalMs);
    return NextResponse.json(
      { message: posted.message, metrics: posted.metrics },
      {
        status: 201,
        headers: {
          "X-Trade-Route-Ms": String(routeMs),
          "X-Trade-Queue-Ms": String(queueMs),
          "X-Trade-Db-Ms": String(posted.metrics.totalMs),
          "X-Trade-Read-Ms": String(posted.metrics.readDbMs),
          "X-Trade-Validation-Ms": String(posted.metrics.validationMs),
          "X-Trade-Logic-Ms": String(posted.metrics.businessMs),
          "X-Trade-Write-Ms": String(posted.metrics.writeDbMs),
          "X-Trade-Sse-Ms": String(posted.metrics.sseMs),
          "Server-Timing": `route;dur=${routeMs}, queue;dur=${queueMs}, db;dur=${posted.metrics.totalMs}, read;dur=${posted.metrics.readDbMs}, validate;dur=${posted.metrics.validationMs}, logic;dur=${posted.metrics.businessMs}, write;dur=${posted.metrics.writeDbMs}, sse;dur=${posted.metrics.sseMs}`,
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send message.";
    const status = message === "Trade not found."
      ? 404
      : message.includes("not allowed")
        ? 403
        : 400;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
