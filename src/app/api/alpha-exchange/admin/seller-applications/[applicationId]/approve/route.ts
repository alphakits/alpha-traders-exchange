import { NextRequest, NextResponse } from "next/server";
import { approveSellerApplicationByAdmin } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";
import { logEvent } from "@/lib/structured-logging";
import { isSellerApprovalChecklistComplete } from "@/lib/seller-approval-verification";

type RouteContext = {
  params: Promise<{ applicationId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { applicationId } = await context.params;
    const body = await request.json() as { reason?: string; verification?: unknown };
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "Reason is required." }, { status: 400 });
    }
    if (!isSellerApprovalChecklistComplete(body.verification)) {
      return NextResponse.json({ error: "Seller identity verification checklist is incomplete." }, { status: 400 });
    }
    const application = await approveSellerApplicationByAdmin(
      applicationId,
      user.id,
      reason,
      body.verification,
    );
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
