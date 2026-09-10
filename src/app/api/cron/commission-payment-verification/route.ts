import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { reverifyPendingCommissionPayments } from "@/lib/alpha-exchange-store";
import { logEvent } from "@/lib/structured-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorizedCronRequest(request: NextRequest, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const provided = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    logEvent("error", {
      event: "commission_payment_verification_cron",
      outcome: "failed",
      reason: "cron_secret_not_configured",
    });
    return NextResponse.json(
      { error: "Commission verification scheduler is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!authorizedCronRequest(request, secret)) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await reverifyPendingCommissionPayments({ limit: 4 });
    logEvent("info", {
      event: "commission_payment_verification_cron",
      outcome: "success",
      metadata: result,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logEvent("error", {
      event: "commission_payment_verification_cron",
      outcome: "failed",
      reason: "verification_sweep_failed",
      metadata: { errorType: error instanceof Error ? error.name : typeof error },
    });
    return NextResponse.json(
      { error: "Commission verification sweep failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
