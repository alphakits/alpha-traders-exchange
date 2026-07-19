import { NextRequest, NextResponse } from "next/server";
import { updatePrivateBetaInviteStatus } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ inviteId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  try {
    const { inviteId } = await context.params;
    const body = await request.json();
    const action = String(body.action ?? "").trim();
    if (action !== "expire" && action !== "disable") {
      return NextResponse.json({ error: "Invalid invite action." }, { status: 400 });
    }
    const invite = await updatePrivateBetaInviteStatus({
      ownerUserId: user.id,
      inviteId,
      action,
    });
    return NextResponse.json({ invite });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update invite." }, { status: 400 });
  }
}
