import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import {
  clearSellerCommissionDuesByAdmin,
  getCommissionResetTraceByEmail,
  findUsersByEmail,
} from "@/lib/alpha-exchange-store";

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  const { user: admin, unauthorized } = await requireApiAdmin();
  if (!admin) return unauthorized;

  try {
    const validationStartedAt = Date.now();
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }
    const validationMs = Date.now() - validationStartedAt;

    const logicStartedAt = Date.now();
    const preTrace = await getCommissionResetTraceByEmail(email);
    const sellers = await findUsersByEmail(email);
    if (sellers.length === 0) {
      return NextResponse.json({
        error: `No user found with email: ${email}.`,
        trace: preTrace,
      }, { status: 404 });
    }
    const sellerUserIds = sellers.map((seller) => seller.id);
    const prePendingCount = preTrace.sellerStates.reduce((sum, state) => sum + state.pendingCommissionCount, 0);
    if (prePendingCount <= 0) {
      return NextResponse.json({
        error: "No pending commissions found for the requested email.",
        trace: preTrace,
      }, { status: 409 });
    }

    const result = await clearSellerCommissionDuesByAdmin({
      sellerUserIds,
      adminUserId: admin.id,
    });
    const postTrace = await getCommissionResetTraceByEmail(email);
    const postPendingCount = postTrace.sellerStates.reduce((sum, state) => sum + state.pendingCommissionCount, 0);
    const postDueAmount = postTrace.sellerStates.reduce((sum, state) => sum + state.commissionDueUsdt, 0);
    const postStillLocked = postTrace.sellerStates.some((state) => state.sellerLocked);
    if (postPendingCount !== 0 || postDueAmount !== 0 || postStillLocked) {
      return NextResponse.json({
        error: "Commission reset assertion failed: seller is still commission-locked in dashboard source of truth.",
        clearedCount: result.clearedCount,
        preTrace,
        postTrace,
      }, {
        status: 500,
        headers: {
          "X-Trade-Route-Ms": String(Date.now() - routeStartedAt),
          "X-Trade-Validation-Ms": String(validationMs),
          "X-Trade-Logic-Ms": String(Date.now() - logicStartedAt),
          "Server-Timing": `route;dur=${Date.now() - routeStartedAt}, validate;dur=${validationMs}, logic;dur=${Date.now() - logicStartedAt}`,
        },
      });
    }

    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({
      clearedCount: result.clearedCount,
      preTrace,
      postTrace,
      message: `Cleared ${result.clearedCount} commission record(s) for ${email}.`,
    }, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Validation-Ms": String(validationMs),
        "X-Trade-Logic-Ms": String(logicMs),
        "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reset commissions." },
      { status: 500 },
    );
  }
}
