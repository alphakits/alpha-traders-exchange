import { NextResponse } from "next/server";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { clearSellerQaCommissionDues, getCommissionQaResetStatus } from "@/lib/alpha-exchange-store";

export async function POST() {
  if (!getCommissionQaResetStatus()) {
    return NextResponse.json({ error: "QA commission reset is disabled." }, { status: 403 });
  }

  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

  try {
    const result = await clearSellerQaCommissionDues({ sellerUserId: user.id });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear QA commissions." },
      { status: 400 },
    );
  }
}
