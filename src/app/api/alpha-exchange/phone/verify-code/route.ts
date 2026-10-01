import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { confirmProfilePhoneVerification } from "@/lib/alpha-exchange-store";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import { AUTH_PHONE_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!isMarketplacePhoneVerificationEnabled()) {
    return NextResponse.json({
      error: "Phone verification is disabled. Email verification is the active verification method.",
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    }, { status: 503 });
  }
  const rate = await checkSharedRateLimit({ headers: request.headers, identifier: user.id, key: "phone-otp-verify", maxRequests: 5, windowMs: 60 * 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  try {
    const body = await request.json();
    await confirmProfilePhoneVerification({ userId: user.id, phone: String(body.phone ?? ""), code: String(body.code ?? "") });
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "1", {
      httpOnly: true, secure: shouldUseSecureAuthCookie(request), sameSite: "lax", path: "/",
    });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to verify phone." }, { status: 400 });
  }
}
