import { NextResponse } from "next/server";
import { getMarketChart } from "@/lib/market-chart-service";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol");
  if (symbol !== "ETHUSDT" && symbol !== "BTCUSDT") {
    return NextResponse.json({ error: "Unsupported chart symbol" }, { status: 400 });
  }
  const chart = await getMarketChart(symbol);
  return NextResponse.json({ chart }, {
    status: chart ? 200 : 503,
    headers: { "Cache-Control": chart && !chart.stale ? "public, s-maxage=10, max-age=0" : "no-store" },
  });
}
