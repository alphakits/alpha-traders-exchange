import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

export async function POST() {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  try {
    const repository = await getAlphaExchangeRepository();
    const db = await repository.loadSnapshot();
    const now = new Date();
    let count = 0;

    for (const listing of db.marketplaceListings) {
      if (listing.expiresAt && new Date(listing.expiresAt) < now && listing.status !== "expired" && listing.status !== "completed" && listing.status !== "cancelled" && listing.status !== "closed") {
        listing.status = "expired";
        listing.expiredAt = now.toISOString();
        listing.updatedAt = now.toISOString();
        count++;
      }
    }

    if (count > 0) {
      await repository.saveSnapshot(db, { selectedTables: ["listings"] });
    }

    return NextResponse.json({ success: true, count });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to expire listings." }, { status: 400 });
  }
}
