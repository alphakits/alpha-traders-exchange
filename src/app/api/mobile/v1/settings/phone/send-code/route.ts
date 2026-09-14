import { NextRequest } from "next/server";
import { beginProfilePhoneVerification } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { sendPhoneVerificationCode } from "@/lib/phone-verification-delivery";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

export async function POST(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    if (!isMarketplacePhoneVerificationEnabled()) {
      return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      identifier: auth.user.id,
      key: "mobile:phone-verification:send",
      maxRequests: 5,
      windowMs: 60 * 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const body = await readMobileJsonBody(request);
    if (!body || Object.keys(body).some((key) => key !== "phone") || typeof body.phone !== "string") {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const { phone, code } = await beginProfilePhoneVerification({
      userId: auth.user.id,
      phone: body.phone,
    });
    const sent = await sendPhoneVerificationCode({ phone, code, locale });
    if (!sent.ok) {
      logEvent("warn", {
        event: "mobile_phone_verification_send",
        outcome: "failed",
        reason: sent.supportCode,
        metadata: { provider: sent.provider ?? "invalid", requestId, userId: auth.user.id },
      });
      return mobileError(
        sent.supportCode === "OTP_PHONE_INVALID" ? "INVALID_REQUEST" : "SERVICE_UNAVAILABLE",
        requestId,
        locale,
        sent.supportCode === "OTP_PHONE_INVALID" ? 400 : 503,
      );
    }

    return mobileJson({
      ok: true,
      channel: sent.channel,
      message: locale === "ar"
        ? `تم إرسال رمز التحقق عبر ${sent.channel === "whatsapp" ? "WhatsApp" : "رسالة نصية"}.`
        : `Verification code sent via ${sent.channel === "whatsapp" ? "WhatsApp" : "SMS"}.`,
    }, requestId);
  } catch (error) {
    logEvent("warn", {
      event: "mobile_phone_verification_send",
      outcome: "failed",
      reason: "invalid_request",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}
