import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market-service";

export async function GET() {
  const routeStartedAt = performance.now();
  const snapshotStartedAt = performance.now();
  const snapshot = await getMarketSnapshot();
  const snapshotDurationMs = performance.now() - snapshotStartedAt;
  const response = NextResponse.json({ snapshot }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  const routeDurationMs = performance.now() - routeStartedAt;

  // These timings cover the handler and snapshot lookup (including its cache).
  // They exclude middleware and network transit; they expose no provider data.
  response.headers.set("Server-Timing", `market;dur=${routeDurationMs.toFixed(1)}, snapshot;dur=${snapshotDurationMs.toFixed(1)}`);
  response.headers.set("X-Market-Route-Ms", routeDurationMs.toFixed(1));
  return response;
}
