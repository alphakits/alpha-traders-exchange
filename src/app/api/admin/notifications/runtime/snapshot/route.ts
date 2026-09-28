import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "admin:notification-runtime-snapshot", identifier: user.id, maxRequests: 30, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  return NextResponse.json({ snapshot: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
