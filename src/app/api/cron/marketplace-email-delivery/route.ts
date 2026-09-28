import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/structured-logging";
import { deliverMarketplaceEmailQueue } from "@/lib/marketplace-email-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function authorizedCronRequest(request: NextRequest, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const provided = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    logEvent("error", {
      event: "marketplace_email_delivery_cron",
      outcome: "failed",
      reason: "cron_secret_not_configured",
    });
    return NextResponse.json(
      { error: "Marketplace email delivery scheduler is not configured." },
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
    const result = await deliverMarketplaceEmailQueue();
    logEvent("info", {
      event: "marketplace_email_delivery_cron",
      outcome: "success",
      metadata: result,
    });
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logEvent("error", {
      event: "marketplace_email_delivery_cron",
      outcome: "failed",
      reason: "delivery_sweep_failed",
      metadata: { errorType: error instanceof Error ? error.name : typeof error },
    });
    return NextResponse.json(
      { error: "Marketplace email delivery sweep failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
