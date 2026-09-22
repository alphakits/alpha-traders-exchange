import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { touchUserPresence } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: `presence:${user.id}`, maxRequests: 6, windowMs: 60_000 });
  if (!rate.allowed) return new NextResponse(null, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  await touchUserPresence(user.id);
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
