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
    return NextResponse.json({ messages: room.messages });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load messages." },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
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
    const body = (await request.json()) as { message?: string };
    const message = await postTradeRoomMessage({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      actorRole: user.role,
      message: String(body.message ?? ""),
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send message." },
      { status: 400 },
    );
  }
}
