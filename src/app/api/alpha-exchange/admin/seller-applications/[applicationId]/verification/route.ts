import { NextRequest, NextResponse } from "next/server";
import { recordApprovedSellerVerificationByAdmin } from "@/lib/alpha-exchange-store";
import { requireApiOwner } from "@/lib/api-auth";
import { isSellerApprovalChecklistComplete } from "@/lib/seller-approval-verification";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ applicationId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  try {
    const { applicationId } = await context.params;
    const body = await request.json() as { reason?: string; verification?: unknown };
    const reason = String(body.reason ?? "").trim();
    if (reason.length < 3) {
      return NextResponse.json({ error: "A clear verification reason is required." }, { status: 400 });
    }
    if (!isSellerApprovalChecklistComplete(body.verification)) {
      return NextResponse.json({ error: "Seller identity verification checklist is incomplete." }, { status: 400 });
    }

    const application = await recordApprovedSellerVerificationByAdmin(
      applicationId,
      user.id,
      reason,
      body.verification,
    );
    logEvent("info", {
      event: "seller_verification_recorded",
      actorUserId: user.id,
      actorRole: user.role,
      resourceId: applicationId,
      outcome: "success",
    });
    return NextResponse.json({ application });
  } catch (error) {
    logEvent("error", {
      event: "seller_verification_recorded",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Unknown verification failure",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record seller verification." },
      { status: 400 },
    );
  }
}
