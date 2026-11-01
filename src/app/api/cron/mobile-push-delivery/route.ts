import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runMobilePushDeliverySweep } from "@/lib/mobile-push";
import { logEvent } from "@/lib/structured-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (secret.length < 32) return NextResponse.json({ error: "Push scheduler is not configured." }, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  try {
    const result = await runMobilePushDeliverySweep();
    logEvent("info", { event: "mobile_push_delivery_cron", outcome: "success", metadata: result });
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch {
    logEvent("error", { event: "mobile_push_delivery_cron", outcome: "failed", reason: "delivery_sweep_failed" });
    return NextResponse.json({ error: "Push delivery sweep failed." }, { status: 500, headers });
  }
}
