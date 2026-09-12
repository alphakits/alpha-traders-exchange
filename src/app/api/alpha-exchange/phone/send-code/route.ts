import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { beginProfilePhoneVerification } from "@/lib/alpha-exchange-store";
import { sendPhoneVerificationCode } from "@/lib/phone-verification-delivery";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: `profile-phone-send:${user.id}`, maxRequests: 5, windowMs: 60 * 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  try {
    const body = await request.json();
    const locale = body?.locale === "ar" || request.headers.get("x-locale") === "ar" ? "ar" : "en";
    const { phone, code } = await beginProfilePhoneVerification({ userId: user.id, phone: String(body?.phone ?? "") });
    const sent = await sendPhoneVerificationCode({ phone, code, locale });
    if (!sent.ok) {
      return NextResponse.json(
        { error: sent.error, supportCode: sent.supportCode },
        { status: sent.supportCode === "OTP_PHONE_INVALID" ? 400 : 503 },
      );
    }
    return NextResponse.json({
      ok: true,
      channel: sent.channel,
      message: locale === "ar"
        ? `تم إرسال رمز التحقق عبر ${sent.channel === "whatsapp" ? "WhatsApp" : "رسالة نصية"}.`
        : `Verification code sent via ${sent.channel === "whatsapp" ? "WhatsApp" : "SMS"}.`,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send verification code." }, { status: 400 });
  }
}
