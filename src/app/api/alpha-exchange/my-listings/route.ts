import { NextRequest, NextResponse } from "next/server";
import { canPublishListings, getMyMarketplaceListings } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!canPublishListings(user)) {
    return NextResponse.json({ listings: [] });
  }
  const status = request.nextUrl.searchParams.get("status") ?? "all";
  const listings = await getMyMarketplaceListings(user.id, status);
  return NextResponse.json({ listings });
}
