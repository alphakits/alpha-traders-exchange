import { NextRequest, NextResponse } from "next/server";
import { rejectSellerApplicationByAdmin } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ applicationId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { applicationId } = await context.params;
    const body = await request.json() as { reason?: string };
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "Reason is required." }, { status: 400 });
    }
    const application = await rejectSellerApplicationByAdmin(applicationId, user.id, reason);
    logEvent("info", { event: "seller_application_reject", actorUserId: user.id, actorRole: user.role, resourceId: applicationId, outcome: "success" });
    return NextResponse.json({ application });
  } catch (error) {
    logEvent("error", {
      event: "seller_application_reject",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Unknown rejection failure",
    });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reject seller application." }, { status: 400 });
  }
}
