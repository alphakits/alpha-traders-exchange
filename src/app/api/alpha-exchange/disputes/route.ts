import { NextRequest, NextResponse } from "next/server";
import { openTradeDispute } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:dispute-open",
    maxRequests: 6,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many dispute requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const body = await request.json();
    const purchaseRequestId = String(body.purchaseRequestId ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 2000);
    if (!purchaseRequestId) {
      return NextResponse.json({ error: "purchaseRequestId is required." }, { status: 400 });
    }
    const dispute = await openTradeDispute({
      purchaseRequestId,
      openedByUserId: user.id,
      reason,
    });
    return NextResponse.json({ dispute }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to open dispute." }, { status: 400 });
  }
}
