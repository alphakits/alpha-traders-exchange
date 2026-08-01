import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import {
  clearSellerCommissionDuesByAdmin,
  findUsersByEmail,
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

    const sellers = await findUsersByEmail(email);
    if (sellers.length === 0) {
      return NextResponse.json({ error: `No user found with email: ${email}.` }, { status: 404 });
    }
    const sellerUserIds = sellers.map((seller) => seller.id);

    const result = await clearSellerCommissionDuesByAdmin({
      sellerUserIds,
      adminUserId: admin.id,
    });
    const sellerStates = await Promise.all(
      sellers.map(async (seller) => {
        const [commissionStatus, workspaceSummary] = await Promise.all([
          getSellerCommissionStatus(seller.id),
          getSellerListingWorkspaceSummary(seller.id),
        ]);
        return {
          sellerId: seller.id,
          sellerEmail: seller.email,
          commissionStatus,
          workspaceSummary,
          isUnlocked: commissionStatus.pendingCount === 0 && commissionStatus.amountDue === 0 && workspaceSummary.pendingCommissionCount === 0,
        };
      }),
    );

    const failedAssertion = sellerStates.find((state) =>
      !(state.commissionStatus.pendingCount === 0
        && state.commissionStatus.amountDue === 0
        && state.commissionStatus.status === "clear"
        && state.workspaceSummary.pendingCommissionCount === 0
        && state.isUnlocked),
    );
    if (failedAssertion) {
      return NextResponse.json({
        error: "Commission reset assertion failed: seller is still commission-locked.",
        requestedEmail: email,
        sellerUserIds,
        clearedCount: result.clearedCount,
        sellerStates,
      }, { status: 500 });
    }

    return NextResponse.json({
      requestedEmail: email,
      sellerUserIds,
      clearedCount: result.clearedCount,
      sellerStates,
      message: `Cleared ${result.clearedCount} commission record(s) for ${email}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reset commissions." },
      { status: 500 },
    );
  }
}
