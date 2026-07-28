import { NextResponse } from "next/server";
import { approveSellerApplicationByAdmin } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ applicationId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { applicationId } = await context.params;
    const application = await approveSellerApplicationByAdmin(applicationId, user.id);
    logEvent("info", { event: "seller_application_approve", actorUserId: user.id, actorRole: user.role, resourceId: applicationId, outcome: "success" });
    return NextResponse.json({ application });
  } catch (error) {
    logEvent("error", {
      event: "seller_application_approve",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Unknown approval failure",
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to approve seller application." }, { status: 400 });
  }
}
