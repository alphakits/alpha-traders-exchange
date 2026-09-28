import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market-service";

export async function GET() {
  const snapshot = await getMarketSnapshot();
  return NextResponse.json({ snapshot });
}
