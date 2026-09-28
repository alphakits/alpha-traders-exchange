import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { reverifyCommissionByAdmin } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ commissionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { commissionId } = await context.params;
    const body = await request.json() as { reason?: string };
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "Reason is required." }, { status: 400 });
    }
    const result = await reverifyCommissionByAdmin({ commissionId, actorUserId: user.id, reason });
    return NextResponse.json({ success: result.verified, notes: result.notes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reverify commission." }, { status: 400 });
  }
}
