import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCommissionCheckoutRuntime } from "@/lib/commission-checkout-runtime";
import { logEvent } from "@/lib/structured-logging";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: NextRequest) {
  const started = Date.now();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) return NextResponse.json({ error: "Scheduler unavailable" }, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const service = await getCommissionCheckoutRuntime();
    const result = await service.scan(started + 55_000);
    const ok = result.complete && result.errors === 0;
    logEvent(ok ? "info" : "warn", { event: "commission_checkout_scan", outcome: ok ? "success" : "failed",
      metadata: { ...result, ownerApprovalRequired: false } });
    return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 503, headers });
  } catch {
    logEvent("error", { event: "commission_checkout_scan", outcome: "failed", reason: "checkout_scan_unavailable" });
    return NextResponse.json({ error: "Automatic checkout scan unavailable" }, { status: 503, headers });
  }
}
