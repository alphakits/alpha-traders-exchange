import { NextRequest, NextResponse } from "next/server";
import {
  adminOverrideMarketplaceListing,
  deleteMarketplaceListingForSeller,
  getMarketplaceListingById,
  reviewMarketplaceListingByOwner,
} from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { listingId } = await context.params;
    const current = await getMarketplaceListingById(listingId);
    if (!current) {
      return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    }

    const body = await request.json();
    const action = String(body.action ?? "").trim();
    if (action === "approve" || action === "reject" || action === "request_changes") {
      const listing = await reviewMarketplaceListingByOwner({
        listingId,
        ownerUserId: user.id,
        decision: action,
        reason: body.reason ? String(body.reason) : undefined,
      });
      return NextResponse.json({ listing });
    }
    if (action === "renew" || action === "extend" || action === "close" || action === "force_close") {
      const reason = String(body.reason ?? "").trim();
      if (!reason) {
        return NextResponse.json({ error: "Reason is required." }, { status: 400 });
      }
      const listing = await adminOverrideMarketplaceListing({
        listingId,
        adminUserId: user.id,
        action,
        expirationHours: body.expirationHours,
        reason,
      });
      return NextResponse.json({ listing });
    }
    return NextResponse.json({ error: "Invalid owner action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update listing." }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { listingId } = await context.params;
    const current = await getMarketplaceListingById(listingId);
    if (!current) {
      return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    }

    await deleteMarketplaceListingForSeller({
      listingId,
      sellerId: current.sellerId,
      actorUserId: user.id,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete listing." }, { status: 400 });
  }
}
