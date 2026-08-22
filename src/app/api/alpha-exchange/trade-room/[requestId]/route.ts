import { NextRequest, NextResponse } from "next/server";
import { getTradeRoomData } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { allowsRuntimeDiagnostics } from "@/lib/runtime-safety";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const { requestId } = await context.params;
  const startedAt = Date.now();
  const debug = allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
  if (debug) console.log("[trade-room-open] api request", {
    requestId,
    userId: user.id,
    role: user.role,
  });

  try {
    const room = await getTradeRoomData({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      actorRole: user.role,
      markMessagesRead: false,
      strongConsistency: true,
    });
    if (debug) console.log("[trade-room-open] api response", {
      requestId,
      userId: user.id,
      status: 200,
      tradeStatus: room.request.status,
      listingId: room.request.listingId,
      tradeId: room.request.tradeId ?? null,
    });
    const routeMs = Date.now() - startedAt;
    if (debug) console.log("[trade-consistency] GET status returned", {
      requestId,
      userId: user.id,
      statusReturned: room.request.status,
      messageCount: room.messages.length,
      timelineCount: room.request.timeline?.length ?? 0,
      routeMs,
    });
    return NextResponse.json(room, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Db-Ms": String(routeMs),
        "Server-Timing": `route;dur=${routeMs}, db;dur=${routeMs}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load trade room.";
    const status = message === "Trade not found."
      ? 404
      : message === "You are not allowed to access trade evidence."
        ? 403
        : 400;
    const code = status === 404
      ? "TRADE_NOT_FOUND"
      : status === 403
        ? "TRADE_FORBIDDEN"
        : "TRADE_ROOM_LOAD_FAILED";
    logEvent("warn", {
      event: "trade_room_load",
      actorUserId: user.id,
      resourceId: requestId,
      outcome: "denied",
      reason: code,
      metadata: { status, errorType: error instanceof Error ? error.name : typeof error },
    });
    return NextResponse.json(
      { error: message, code },
      { status },
    );
  }
}
