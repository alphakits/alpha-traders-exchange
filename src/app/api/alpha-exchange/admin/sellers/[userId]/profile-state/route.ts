import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { updateSellerAvailabilityStatus, updateSellerProfileStateByAdmin } from "@/lib/alpha-exchange-store";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  try {
    const { userId } = await context.params;
    const body = await request.json();
    const feature = typeof body.feature === "boolean" ? body.feature : undefined;
    const hidden = typeof body.hidden === "boolean" ? body.hidden : undefined;
    const availabilityStatus =
      body.availabilityStatus === "available" || body.availabilityStatus === "away" || body.availabilityStatus === "vacation"
        ? body.availabilityStatus
        : undefined;
    if (feature === undefined && hidden === undefined && availabilityStatus === undefined) {
      return NextResponse.json({ error: "At least one profile state flag is required." }, { status: 400 });
    }
    const seller = (feature !== undefined || hidden !== undefined)
      ? await updateSellerProfileStateByAdmin({
          sellerId: userId,
          adminUserId: user.id,
          feature,
          hidden,
        })
      : null;
    const availabilitySeller = availabilityStatus
      ? await updateSellerAvailabilityStatus({
          sellerId: userId,
          actorUserId: user.id,
          availabilityStatus,
          reason: typeof body.reason === "string" ? body.reason : undefined,
        })
      : null;
    return NextResponse.json({ seller: availabilitySeller ?? seller });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update seller profile state." }, { status: 400 });
  }
}
