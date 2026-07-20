import { NextRequest, NextResponse } from "next/server";
import { updateBetaAnnouncementState } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ announcementId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  try {
    const { announcementId } = await context.params;
    const body = await request.json();
    const isActive = body.isActive === true;
    const announcement = await updateBetaAnnouncementState({
      ownerUserId: user.id,
      announcementId,
      isActive,
    });
    return NextResponse.json({ announcement });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update announcement." }, { status: 400 });
  }
}
