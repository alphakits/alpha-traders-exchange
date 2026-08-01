import { NextResponse } from "next/server";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { clearSellerQaCommissionDues } from "@/lib/alpha-exchange-store";

export async function POST() {
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
