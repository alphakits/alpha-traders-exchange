import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { forceCloseTradeByOwner } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    const { requestId } = await context.params;
    const body = await request.json() as { reason?: string };
    const reason = String(body.reason ?? "").trim();
    if (!reason || reason.length > 1000) return NextResponse.json({ error: "A reason of 1–1000 characters is required." }, { status: 400, headers });
    await forceCloseTradeByOwner({ requestId, reason, actorUserId: user.id });
    return NextResponse.json({ success: true }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to close trade." }, { status: 400, headers });
  }
}
