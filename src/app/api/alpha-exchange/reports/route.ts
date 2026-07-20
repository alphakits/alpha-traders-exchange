import { NextRequest, NextResponse } from "next/server";
import { reportSeller } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:report-seller",
    maxRequests: 8,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many reports. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const body = await request.json();
    const sellerId = String(body.sellerId ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 2000);
    const purchaseRequestId = body.purchaseRequestId ? String(body.purchaseRequestId) : undefined;
    if (!sellerId) {
      return NextResponse.json({ error: "sellerId is required." }, { status: 400 });
    }
    const report = await reportSeller({
      reporterUserId: user.id,
      sellerId,
      reason,
      purchaseRequestId,
    });
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit report." }, { status: 400 });
  }
}
