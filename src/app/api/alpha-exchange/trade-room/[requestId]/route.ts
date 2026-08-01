import { NextRequest, NextResponse } from "next/server";
import { getTradeRoomData } from "@/lib/alpha-exchange-store";
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
      markMessagesRead: true,
    });
    return NextResponse.json(room);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load trade room." },
      { status: 400 },
    );
  }
}
