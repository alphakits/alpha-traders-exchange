import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { setSellerVacationModeByAdmin } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { userId } = await context.params;
    const body = await request.json() as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
    const enabled = body.enabled;

    await setSellerVacationModeByAdmin({ userId, enabled, actorUserId: user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to set vacation mode." }, { status: 400 });
  }
}
