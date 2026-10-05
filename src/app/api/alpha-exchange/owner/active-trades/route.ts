import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { getOwnerActiveTradeHeaderState } from "@/lib/alpha-exchange-store";

export async function GET() {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;
  const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
  try {
    const trades = await getOwnerActiveTradeHeaderState(user.id, "owner");
    return NextResponse.json({ actorId: user.id, trades }, { headers });
  } catch {
    return NextResponse.json({ error: "Active trades temporarily unavailable." }, { status: 503, headers });
  }
}
