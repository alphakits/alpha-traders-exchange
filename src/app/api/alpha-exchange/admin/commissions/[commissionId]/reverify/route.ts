import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { reverifyCommissionByAdmin } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ commissionId: string }> };

export async function POST(_: Request, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { commissionId } = await context.params;
    const result = await reverifyCommissionByAdmin({ commissionId, actorUserId: user.id });
    return NextResponse.json({ success: result.verified, notes: result.notes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reverify commission." }, { status: 400 });
  }
}
