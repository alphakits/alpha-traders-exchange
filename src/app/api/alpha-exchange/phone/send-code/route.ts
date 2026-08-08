import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { beginProfilePhoneVerification } from "@/lib/alpha-exchange-store";
import { sendTwilioMessageWithRetry } from "@/lib/notification-platform";
import { checkRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = checkRateLimit({ headers: request.headers, key: `profile-phone-send:${user.id}`, maxRequests: 5, windowMs: 60 * 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  try {
    const { phone, code } = await beginProfilePhoneVerification({ userId: user.id, phone: String((await request.json()).phone ?? "") });
    const sent = await sendTwilioMessageWithRetry({ to: phone, body: `Alpha Traders verification code: ${code}. Expires in 10 minutes.` });
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send verification code." }, { status: 400 });
  }
}
