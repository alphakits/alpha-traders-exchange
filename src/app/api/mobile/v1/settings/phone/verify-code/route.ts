import { NextRequest } from "next/server";
import { confirmProfilePhoneVerification } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { toMobileSessionUser } from "@/lib/mobile-session-user";
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
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      identifier: auth.user.id,
      key: "mobile:phone-verification:verify",
      maxRequests: 5,
      windowMs: 60 * 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const body = await readMobileJsonBody(request);
    if (
      !body
      || Object.keys(body).some((key) => key !== "phone" && key !== "code")
      || typeof body.phone !== "string"
      || typeof body.code !== "string"
      || !/^\d{6}$/.test(body.code)
    ) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const user = await confirmProfilePhoneVerification({
      userId: auth.user.id,
      phone: body.phone,
      code: body.code,
    });
    return mobileJson({
      ok: true,
      phone: {
        verified: true,
        masked: user.verifiedPhone
          ? `${user.verifiedPhone.slice(0, 3)}•••${user.verifiedPhone.slice(-2)}`
          : null,
      },
      user: toMobileSessionUser(user),
      message: locale === "ar" ? "تم توثيق رقم الهاتف." : "Phone number verified.",
    }, requestId);
  } catch (error) {
    logEvent("warn", {
      event: "mobile_phone_verification_confirm",
      outcome: "failed",
      reason: "invalid_code",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}
