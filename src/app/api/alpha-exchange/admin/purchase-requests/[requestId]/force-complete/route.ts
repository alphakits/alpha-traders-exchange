import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { forceCompleteTradeByAdmin } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ requestId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { requestId } = await context.params;
    const body = await request.json() as { reason?: string };
    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "Reason is required." }, { status: 400 });

    await forceCompleteTradeByAdmin({ requestId, reason, actorUserId: user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to force-complete trade." }, { status: 400 });
  }
}
