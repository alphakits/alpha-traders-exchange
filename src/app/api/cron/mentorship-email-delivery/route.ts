import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { deliverMentorshipEmailQueue } from "@/lib/mentorship-email-delivery";
import { logEvent } from "@/lib/structured-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) return NextResponse.json({ error: "Scheduler unavailable" }, { status: 503, headers: HEADERS });
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS });
  }
  try {
    const result = await deliverMentorshipEmailQueue();
    logEvent(result.configurationError ? "error" : "info", { event: "mentorship_email_delivery", outcome: result.configurationError ? "failed" : "success", metadata: result });
    return NextResponse.json(result, { status: result.configurationError ? 503 : 200, headers: HEADERS });
  } catch (error) {
    logEvent("error", { event: "mentorship_email_delivery", outcome: "failed", reason: "sweep_unconfirmed", metadata: { errorType: error instanceof Error ? error.name : typeof error } });
    return NextResponse.json({ error: "Delivery sweep unconfirmed" }, { status: 503, headers: HEADERS });
  }
}
