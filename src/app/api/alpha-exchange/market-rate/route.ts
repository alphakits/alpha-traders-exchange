import { NextResponse } from "next/server";
import { fetchUsdIlsMarketRate } from "@/lib/listing-price-validation";

export async function GET() {
  const rate = await fetchUsdIlsMarketRate();
  return NextResponse.json({ rate });
}
