import { NextRequest, NextResponse } from "next/server";
import { getMarketplaceListings, adminOverrideMarketplaceListing } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";
import { fetchUsdIlsMarketRate, getListingPriceValidationError } from "@/lib/listing-price-validation";

/**
 * GET  /api/alpha-exchange/admin/listings/price-audit
 * Returns all active/paused listings whose price exceeds the current market cap (market + ₪0.35).
 *
 * POST /api/alpha-exchange/admin/listings/price-audit
 * Body: { action: "close_all" }
 * Force-closes all over-priced listings with an audit log entry.
 */

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  const marketRate = await fetchUsdIlsMarketRate();
  const listings = await getMarketplaceListings();
  const violations = listings
    .filter((l) => l.status === "active" || l.status === "paused")
    .filter((l) =>
      Boolean(getListingPriceValidationError({ price: l.price, currency: l.currency ?? "ILS", marketRate }))
    )
    .map((l) => ({
      id: l.id,
      sellerId: l.sellerId,
      price: l.price,
      currency: l.currency,
      status: l.status,
      maxAllowed: (marketRate + 0.35).toFixed(2),
      marketRate: marketRate.toFixed(4),
    }));

  return NextResponse.json({ marketRate, violations, count: violations.length });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  const body = (await request.json()) as { action?: string };
  if (String(body.action ?? "") !== "close_all") {
    return NextResponse.json({ error: "action must be 'close_all'" }, { status: 400 });
  }

  const marketRate = await fetchUsdIlsMarketRate();
  const listings = await getMarketplaceListings();
  const violations = listings.filter(
    (l) =>
      (l.status === "active" || l.status === "paused") &&
      Boolean(getListingPriceValidationError({ price: l.price, currency: l.currency ?? "ILS", marketRate }))
  );

  const results: Array<{ id: string; outcome: string }> = [];
  for (const listing of violations) {
    try {
      await adminOverrideMarketplaceListing({
        listingId: listing.id,
        adminUserId: user.id,
        action: "force_close",
        reason: `Price ₪${listing.price} exceeds market cap ₪${(marketRate + 0.35).toFixed(2)} (market ₪${marketRate.toFixed(4)} + ₪0.35).`,
      });
      results.push({ id: listing.id, outcome: "force_closed" });
    } catch (err) {
      results.push({ id: listing.id, outcome: `error: ${err instanceof Error ? err.message : "unknown"}` });
    }
  }

  return NextResponse.json({ marketRate, results, count: results.length });
}
