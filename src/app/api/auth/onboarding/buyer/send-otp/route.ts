import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { beginBuyerVerification, beginProfilePhoneVerification } from "@/lib/alpha-exchange-store";
import { sendPhoneVerificationCode } from "@/lib/phone-verification-delivery";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: `auth:buyer-otp-send:${user.id}`,
    maxRequests: 5,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (!rate.allowed) {
    logEvent("warn", {
      event: "buyer_verification_otp_send",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "Daily OTP send limit reached",
    });
    return NextResponse.json({ error: "OTP send limit reached for today." }, { status: 429 });
  }

  const body = await request.json();
  const firstName = String(body?.firstName ?? "").trim();
  const lastName = String(body?.lastName ?? "").trim();
  const displayName = String(body?.displayName ?? "").trim();
  const phone = String(body?.phone ?? "").trim();
  const locale = body?.locale === "ar" || request.headers.get("x-locale") === "ar" ? "ar" : "en";

  if (!firstName || !lastName || !phone) {
    return NextResponse.json({ error: "First name, last name, and phone are required." }, { status: 400 });
  }

  try {
    logEvent("info", {
      event: "buyer_verification_otp_send_start",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "success",
      metadata: {
        requestId,
        hasFirstName: Boolean(firstName),
        hasLastName: Boolean(lastName),
        hasDisplayName: Boolean(displayName),
        phonePrefix: phone.startsWith("+972") ? "+972" : phone.startsWith("05") ? "05" : "other",
        phoneLength: phone.length,
      },
    });

    const started = await beginBuyerVerification({
      userId: user.id,
      firstName,
      lastName,
      displayName: displayName || undefined,
      phone,
    });

    logEvent("info", {
      event: "buyer_verification_otp_send_pre_provider",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "success",
      metadata: {
        requestId,
        normalizedPhonePrefix: started.phone.startsWith("+972") ? "+972" : "other",
        normalizedPhoneLength: started.phone.length,
      },
    });

    const otp = await beginProfilePhoneVerification({ userId: user.id, phone: started.phone });
    const sent = await sendPhoneVerificationCode({ phone: otp.phone, code: otp.code, locale });
    if (!sent.ok) {
      logEvent("warn", {
        event: "buyer_verification_otp_send",
        actorUserId: user.id,
        actorRole: user.role,
        outcome: "failed",
        reason: sent.supportCode,
        metadata: { requestId, provider: sent.provider ?? "unconfigured" },
      });
      return NextResponse.json(
        { error: sent.error, supportCode: sent.supportCode, requestId },
        { status: sent.supportCode === "OTP_PHONE_INVALID" ? 400 : 503 },
      );
    }
    logEvent("info", {
      event: "buyer_verification_otp_send",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "success",
      metadata: { requestId, phoneSuffix: started.phone.slice(-4), provider: sent.provider },
    });
    return NextResponse.json({
      ok: true,
      channel: sent.channel,
      message: locale === "ar"
        ? `تم إرسال رمز التحقق عبر ${sent.channel === "whatsapp" ? "WhatsApp" : "رسالة نصية"}.`
        : `Verification code sent via ${sent.channel === "whatsapp" ? "WhatsApp" : "SMS"}.`,
    });
  } catch (error) {
    logEvent("error", {
      event: "buyer_verification_otp_send",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error instanceof Error ? error.message : "Unknown error",
      metadata: { requestId },
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to send OTP.",
        supportCode: "OTP_PROVIDER_UNKNOWN",
        requestId,
      },
      { status: 400 },
    );
  }
}
