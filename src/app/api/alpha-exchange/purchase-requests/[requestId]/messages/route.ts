import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTradeRoomData, postTradeRoomMessage } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

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

  const rate = checkRateLimit({
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
      actorRole: user.role,
      message: String(body.message ?? ""),
      imageUrl: body.imageUrl,
      imageName: body.imageName,
      imageMimeType: body.imageMimeType,
    });
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send message." },
      { status: 400 },
    );
  }
}
