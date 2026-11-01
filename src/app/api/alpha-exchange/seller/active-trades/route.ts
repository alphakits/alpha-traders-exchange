import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getSellerActiveTradeHeaderState } from "@/lib/alpha-exchange-store";
import { usesSellerActiveTradeHeader } from "@/lib/seller-active-trades";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
  if (!usesSellerActiveTradeHeader(user)) {
    return NextResponse.json({ error: "Seller account required." }, { status: 403, headers });
  }
  try {
    const trades = await getSellerActiveTradeHeaderState(user.id);
    return NextResponse.json({ actorId: user.id, trades }, { headers });
  } catch {
    return NextResponse.json({ error: "Active trades temporarily unavailable." }, { status: 503, headers });
  }
}
