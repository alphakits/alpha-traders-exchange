import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { issueSellerCommissionByAdmin } from "@/lib/alpha-exchange-store";
import { requireManualCommissionOperationId } from "@/lib/manual-commission-operation";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const body = await request.json() as {
      sellerId?: unknown;
      commissionAmount?: unknown;
      reason?: unknown;
      dueAt?: unknown;
      clientOperationId?: unknown;
    };
    const clientOperationId = requireManualCommissionOperationId(body.clientOperationId);
    const sellerId = typeof body.sellerId === "string" ? body.sellerId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const dueAt = typeof body.dueAt === "string" ? body.dueAt.trim() || undefined : undefined;
    const commissionAmount = typeof body.commissionAmount === "number"
      || typeof body.commissionAmount === "string"
      ? Number(body.commissionAmount)
      : Number.NaN;

    const commission = await issueSellerCommissionByAdmin({
      sellerId,
      actorUserId: user.id,
      commissionAmount,
      reason,
      dueAt,
      clientOperationId,
    });
    return NextResponse.json({ commission }, { status: 201 });
  } catch (error) {
    const conflict = error instanceof Error && "code" in error && error.code === "manual-commission-operation-conflict";
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to issue seller commission.",
      ...(conflict ? { code: "manual-commission-operation-conflict" } : {}),
    }, { status: conflict ? 409 : 400 });
  }
}
