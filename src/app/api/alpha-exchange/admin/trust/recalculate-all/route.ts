import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { recalculateAllTrustByAdmin } from "@/lib/alpha-exchange-store";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const body = await request.json() as { reason?: string };
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "Reason is required." }, { status: 400 });
    }
    const result = await recalculateAllTrustByAdmin({ actorUserId: user.id, reason });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to recalculate trust scores." }, { status: 400 });
  }
}
