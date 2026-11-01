import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runEconomicNewsSync } from "@/lib/economic-news/worker";
import { logEvent } from "@/lib/structured-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (secret.length < 32) return NextResponse.json({ error: "Scheduler unavailable." }, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    return NextResponse.json(await runEconomicNewsSync(), { headers });
  } catch {
    logEvent("error", { event: "economic_news_sync", outcome: "failed", reason: "news_sync_failed" });
    return NextResponse.json({ error: "News sync unavailable." }, { status: 503, headers });
  }
}
