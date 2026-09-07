import { NextRequest } from "next/server";
import type { MobileNotificationPreferencesUpdateRequest } from "@alpha-traders/contracts";
import { updateNotificationPreferences } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

function responsePayload(user: {
  notificationPreferences?: { inApp?: boolean; email?: boolean; sms?: boolean };
  verifiedPhone?: string;
  phoneVerifiedAt?: string;
}) {
  return {
    preferences: {
      inApp: user.notificationPreferences?.inApp !== false,
      email: user.notificationPreferences?.email === true,
      sms: user.notificationPreferences?.sms === true,
    },
    phone: {
      verified: Boolean(user.verifiedPhone && user.phoneVerifiedAt),
      masked: user.verifiedPhone
        ? `${user.verifiedPhone.slice(0, 3)}•••${user.verifiedPhone.slice(-2)}`
        : null,
    },
  };
}

async function authenticate(request: NextRequest, requestId: string) {
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return { response: mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400) };
  const auth = await requireMobileApiUser(request, requestId, metadata);
  return auth.user ? { user: auth.user, locale } : { response: auth.unauthorized };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  try {
    const auth = await authenticate(request, requestId);
    if (auth.response) return auth.response;
    return mobileJson(responsePayload(auth.user), requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_notification_preferences_read",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  try {
    const auth = await authenticate(request, requestId);
    if (auth.response) return auth.response;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      identifier: auth.user.id,
      key: "mobile:notification-preferences",
      maxRequests: 12,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, { retryAfterSeconds: rate.retryAfterSeconds });
    }
    const body = await readMobileJsonBody(request);
    if (!body) return mobileError("INVALID_REQUEST", requestId, locale, 400);
    const allowedKeys = new Set(["inApp", "email", "sms"]);
    const keys = Object.keys(body);
    if (!keys.length || keys.some((key) => !allowedKeys.has(key)) || keys.some((key) => typeof body[key] !== "boolean")) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    if (body.sms === true && (!auth.user.verifiedPhone || !auth.user.phoneVerifiedAt)) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const input = body as MobileNotificationPreferencesUpdateRequest;
    const preferences = await updateNotificationPreferences({
      userId: auth.user.id,
      preferences: input,
    });
    return mobileJson({
      preferences: {
        inApp: preferences.inApp !== false,
        email: preferences.email === true,
        sms: preferences.sms === true,
      },
      phone: responsePayload(auth.user).phone,
    }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_notification_preferences_update",
      outcome: "failed",
      reason: "invalid_or_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}
