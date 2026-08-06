import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { disableUserAccountByAdmin } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ userId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  try {
    const { userId } = await context.params;
    const body = await request.json() as { disabled?: boolean; reason?: string };
    const disabled = Boolean(body.disabled);
    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "Reason is required." }, { status: 400 });

    await disableUserAccountByAdmin({ userId, disabled, reason, actorUserId: user.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update user account." }, { status: 400 });
  }
}
