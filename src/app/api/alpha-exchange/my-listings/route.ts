import { NextRequest, NextResponse } from "next/server";
import { getCommissionQaModeStatus, getCommissionQaResetStatus, getSellerListingWorkspaceData } from "@/lib/alpha-exchange-store";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { getCommissionWalletConfiguration } from "@/lib/commission-config";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;
  const VALID_STATUSES = new Set(["all", "draft", "active", "paused", "matched", "in_trade", "expired", "completed", "cancelled", "closed"]);
  const statusParam = request.nextUrl.searchParams.get("status") ?? "all";
  const status = VALID_STATUSES.has(statusParam) ? statusParam : "all";
  const commissionId = request.nextUrl.searchParams.get("commissionId")?.trim() || undefined;
  const { listings, summary, commissionStatus } = await getSellerListingWorkspaceData({
    sellerId: user.id,
    status,
    commissionId,
  });
  return NextResponse.json({
    listings,
    summary,
    commissionStatus,
    commissionWalletConfiguration: getCommissionWalletConfiguration(),
    qaCommissionModeEnabled: getCommissionQaModeStatus(),
    qaCommissionResetEnabled: getCommissionQaResetStatus(),
  });
}
