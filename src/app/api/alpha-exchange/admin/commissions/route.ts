import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { issueSellerCommissionByAdmin } from "@/lib/alpha-exchange-store";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const body = await request.json() as {
      sellerId?: unknown;
      commissionAmount?: unknown;
      reason?: unknown;
      dueAt?: unknown;
    };
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
    });
    return NextResponse.json({ commission }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Failed to issue seller commission.",
    }, { status: 400 });
  }
}
