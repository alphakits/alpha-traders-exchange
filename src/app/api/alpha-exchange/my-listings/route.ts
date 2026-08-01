import { NextRequest, NextResponse } from "next/server";
import { getCommissionQaModeStatus, getMyMarketplaceListings, getSellerCommissionStatus, getSellerListingWorkspaceSummary } from "@/lib/alpha-exchange-store";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;
  const VALID_STATUSES = new Set(["all", "draft", "active", "paused", "matched", "in_trade", "expired", "completed", "cancelled", "closed"]);
  const statusParam = request.nextUrl.searchParams.get("status") ?? "all";
  const status = VALID_STATUSES.has(statusParam) ? statusParam : "all";
  const [listings, summary, commissionStatus] = await Promise.all([
    getMyMarketplaceListings(user.id, status),
    getSellerListingWorkspaceSummary(user.id),
    getSellerCommissionStatus(user.id),
  ]);
  return NextResponse.json({ listings, summary, commissionStatus, qaCommissionModeEnabled: getCommissionQaModeStatus() });
}
