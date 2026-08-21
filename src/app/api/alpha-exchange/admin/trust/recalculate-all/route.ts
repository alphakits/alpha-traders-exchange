import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { recalculateAllTrustByAdmin } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "admin:trust-recalculate-all", identifier: user.id, maxRequests: 3, windowMs: 60 * 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);

  try {
    const body = await request.json() as { reason?: string };
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "Reason is required." }, { status: 400 });
    }
    const result = await recalculateAllTrustByAdmin({ actorUserId: user.id, reason });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to recalculate trust scores." }, { status: 400 });
  }
}
