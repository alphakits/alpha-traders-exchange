import { NextRequest, NextResponse } from "next/server";
import { adminOverrideMarketplaceListing, getMarketplaceListingById } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  const { listingId } = await context.params;
  const body = (await request.json()) as { action?: string };
  const action = body.action;

  if (!action || !["remove", "hide", "restore", "feature"].includes(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const existing = await getMarketplaceListingById(listingId);
  if (!existing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  try {
    // Map moderation actions to admin override actions:
    // remove  → force_close (sets status "closed", cancels any active trade)
    // hide    → close      (sets status "closed" without force-cancelling locked trades)
    // restore → renew      (sets status "active")
    // feature → renew      (ensures listing is active and visible; featured state is noted)
    const overrideAction =
      action === "remove"
        ? "force_close"
        : action === "hide"
          ? "close"
          : "renew";

    const listing = await adminOverrideMarketplaceListing({
      listingId,
      adminUserId: user.id,
      action: overrideAction,
      reason: `Moderation action: ${action}`,
    });

    return NextResponse.json({ listing });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Moderation action failed." },
      { status: 400 },
    );
  }
}
