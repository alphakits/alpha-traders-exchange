import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import {
  clearSellerCommissionDuesByAdmin,
  findUserByEmail,
  getSellerCommissionStatus,
  getSellerListingWorkspaceSummary,
} from "@/lib/alpha-exchange-store";

export async function POST(request: NextRequest) {
  const { user: admin, unauthorized } = await requireApiAdmin();
  if (!admin) return unauthorized;

  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }

    const seller = await findUserByEmail(email);
    if (!seller) {
      return NextResponse.json({ error: `No user found with email: ${email}.` }, { status: 404 });
    }

    const result = await clearSellerCommissionDuesByAdmin({
      sellerUserId: seller.id,
      adminUserId: admin.id,
    });
    const [commissionStatus, workspaceSummary] = await Promise.all([
      getSellerCommissionStatus(seller.id),
      getSellerListingWorkspaceSummary(seller.id),
    ]);
    if (commissionStatus.pendingCount > 0) {
      return NextResponse.json({
        error: "Commission reset did not fully clear outstanding dues.",
        sellerId: seller.id,
        sellerEmail: seller.email,
        clearedCount: result.clearedCount,
        commissionStatus,
        workspaceSummary,
      }, { status: 409 });
    }

    return NextResponse.json({
      sellerId: seller.id,
      sellerEmail: seller.email,
      clearedCount: result.clearedCount,
      commissionStatus,
      workspaceSummary,
      message: `Cleared ${result.clearedCount} commission record(s) for ${email}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reset commissions." },
      { status: 500 },
    );
  }
}
