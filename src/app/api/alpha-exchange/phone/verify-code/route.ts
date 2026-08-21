import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { confirmProfilePhoneVerification } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: `profile-phone-verify:${user.id}`, maxRequests: 5, windowMs: 60 * 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  try {
    const body = await request.json();
    await confirmProfilePhoneVerification({ userId: user.id, phone: String(body.phone ?? ""), code: String(body.code ?? "") });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to verify phone." }, { status: 400 });
  }
}
