import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { updateSellerAvailabilityStatus, updateSellerProfileStateByAdmin } from "@/lib/alpha-exchange-store";
import { logEvent } from "@/lib/structured-logging";
import { toAdminSellerSummary } from "@/lib/client-session-user";

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
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (feature === undefined && hidden === undefined && availabilityStatus === undefined) {
      return NextResponse.json({ error: "At least one profile state flag is required." }, { status: 400 });
    }
    if (availabilityStatus !== undefined && !reason) {
      return NextResponse.json({ error: "Reason is required." }, { status: 400 });
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
          reason,
        })
      : null;
    logEvent("info", {
      event: "seller_profile_state_update",
      actorUserId: user.id,
      actorRole: user.role,
      targetUserId: userId,
      outcome: "success",
    });
    const updatedSeller = availabilitySeller ?? seller;
    if (!updatedSeller) {
      return NextResponse.json({ error: "No seller profile state was updated." }, { status: 400 });
    }
    return NextResponse.json({ seller: toAdminSellerSummary(updatedSeller) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update seller profile state.";
    logEvent("error", {
      event: "seller_profile_state_update",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: message,
    });
    const status = message === "Owner account cannot be modified." ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
