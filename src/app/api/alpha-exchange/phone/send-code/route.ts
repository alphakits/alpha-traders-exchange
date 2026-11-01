import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { beginProfilePhoneVerification } from "@/lib/alpha-exchange-store";
import { getPhoneVerificationChannels, phoneVerificationDeliveryPreflight, sendPhoneVerificationCode } from "@/lib/phone-verification-delivery";
import { parsePhoneVerificationChannel } from "@/lib/phone-verification-channel";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  return NextResponse.json({ channels: getPhoneVerificationChannels() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!isMarketplacePhoneVerificationEnabled()) {
    return NextResponse.json({
      error: "Phone verification is disabled. Email verification is the active verification method.",
      supportCode: "OTP_PROVIDER_CONFIGURATION",
    }, { status: 503 });
  }
  const rate = await checkSharedRateLimit({ headers: request.headers, identifier: user.id, key: "phone-otp-send", maxRequests: 5, windowMs: 60 * 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  try {
    const body = await request.json();
    if (!body || Array.isArray(body) || typeof body.phone !== "string") return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
    const channel = parsePhoneVerificationChannel(body.channel);
    if (channel === null) return NextResponse.json({ error: "Choose SMS or WhatsApp." }, { status: 400 });
    const locale = body?.locale === "ar" || request.headers.get("x-locale") === "ar" ? "ar" : "en";
    const unavailable = phoneVerificationDeliveryPreflight(body.phone, channel);
    if (unavailable) return NextResponse.json({ error: locale === "ar" ? "قناة التحقق المختارة غير متاحة حاليًا. تواصل مع الدعم." : unavailable.error, supportCode: unavailable.supportCode }, { status: 503 });
    const { phone, code } = await beginProfilePhoneVerification({ userId: user.id, phone: String(body?.phone ?? "") });
    const sent = await sendPhoneVerificationCode({ phone, code, locale, ...(channel ? { channel } : {}) });
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
