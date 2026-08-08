import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import {
  decideMarketplaceEnforcementAppealByOwner,
  confirmMarketplaceEnforcementPaymentByOwner,
  issueMarketplaceEnforcementFeeByAdmin,
  markMarketplaceEnforcementFeePaidByAdmin,
  removeMarketplaceEnforcementRestrictionByAdmin,
  revokeSellerMarketplacePrivilegesByAdmin,
} from "@/lib/alpha-exchange-store";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { userId } = await context.params;
    const body = await request.json() as {
      action?: string;
      reason?: string;
      notes?: string;
      feeAmount?: number;
      dueAt?: string;
      evidenceFiles?: Array<{
        fileName?: string;
        mimeType?: string;
        sizeBytes?: number;
        fileData?: string;
      }>;
      decision?: "accepted" | "rejected";
    };
    const action = String(body.action ?? "").trim();

    if (action === "issue_fee") {
      const reason = String(body.reason ?? "").trim();
      const feeAmount = Number(body.feeAmount ?? 0);
      const enforcement = await issueMarketplaceEnforcementFeeByAdmin({
        sellerId: userId,
        actorUserId: user.id,
        feeAmount,
        reason,
        adminNotes: String(body.notes ?? "").trim(),
        evidenceFiles: Array.isArray(body.evidenceFiles)
          ? body.evidenceFiles.map((item) => ({
              fileName: String(item.fileName ?? ""),
              mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
              sizeBytes: Number(item.sizeBytes ?? 0),
              fileData: String(item.fileData ?? ""),
            }))
          : [],
        dueAt: typeof body.dueAt === "string" ? body.dueAt : undefined,
      });
      return NextResponse.json({ enforcement });
    }

    if (action === "confirm_payment") {
      const enforcement = await confirmMarketplaceEnforcementPaymentByOwner({
        sellerId: userId,
        actorUserId: user.id,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return NextResponse.json({ enforcement });
    }

    if (action === "appeal_decision") {
      if (body.decision !== "accepted" && body.decision !== "rejected") {
        return NextResponse.json({ error: "Decision must be accepted or rejected." }, { status: 400 });
      }
      const enforcement = await decideMarketplaceEnforcementAppealByOwner({
        sellerId: userId,
        actorUserId: user.id,
        decision: body.decision,
        notes: String(body.notes ?? "").trim(),
      });
      return NextResponse.json({ enforcement });
    }

    if (action === "mark_paid") {
      const enforcement = await markMarketplaceEnforcementFeePaidByAdmin({
        sellerId: userId,
        actorUserId: user.id,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return NextResponse.json({ enforcement });
    }

    if (action === "remove_restriction") {
      const reason = String(body.reason ?? "").trim();
      if (!reason) {
        return NextResponse.json({ error: "Reason is required." }, { status: 400 });
      }
      const enforcement = await removeMarketplaceEnforcementRestrictionByAdmin({
        sellerId: userId,
        actorUserId: user.id,
        reason,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return NextResponse.json({ enforcement });
    }

    if (action === "revoke_seller") {
      const reason = String(body.reason ?? "").trim();
      if (!reason) {
        return NextResponse.json({ error: "Reason is required." }, { status: 400 });
      }
      const enforcement = await revokeSellerMarketplacePrivilegesByAdmin({
        sellerId: userId,
        actorUserId: user.id,
        reason,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return NextResponse.json({ enforcement });
    }

    return NextResponse.json({ error: "Invalid compliance action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process compliance action.";
    logEvent("error", {
      event: "marketplace_enforcement_action",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: message,
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
