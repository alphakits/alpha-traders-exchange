import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { demandEnabled } from "@/lib/usdt-demand-policy";
import { runDemandExpiryNotifications } from "@/lib/usdt-demand-store";
import { logEvent } from "@/lib/structured-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    return NextResponse.json({ error: "Buy Request notification scheduler is not configured." }, { status: 503, headers });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  }
  if (!demandEnabled()) return NextResponse.json({ ok: true, enabled: false, notified: 0 }, { headers });

  try {
    // This sweep creates notices only. Expiry, matching, inventory, and trade
    // state remain governed by the existing Buy Request transaction rules.
    const result = await runDemandExpiryNotifications();
    logEvent("info", { event: "buy_request_notification_cron", outcome: "success", metadata: result });
    return NextResponse.json({ ok: true, enabled: true, ...result }, { headers });
  } catch {
    logEvent("error", { event: "buy_request_notification_cron", outcome: "failed", reason: "expiry_notice_sweep_failed" });
    return NextResponse.json({ error: "Buy Request notification sweep failed." }, { status: 500, headers });
  }
}
