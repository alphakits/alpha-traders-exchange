import { NextRequest } from "next/server";
import {
  getNotificationsForUser,
  markAllNotificationsRead,
} from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { toMobileNotification } from "@/lib/mobile-notifications";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:notifications:list",
      identifier: auth.user.id,
      maxRequests: 90,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const payload = await getNotificationsForUser({
      userId: auth.user.id,
      limit: 60,
      includeActivity: false,
    });
    return mobileJson({
      notifications: payload.notifications.map((notification) =>
        toMobileNotification(notification, locale)),
      total: payload.total,
      unreadCount: payload.unreadCount,
    }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_notifications_list",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: {
        errorType: error instanceof Error ? error.name : typeof error,
        requestId,
      },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const body = await readMobileJsonBody(request);
    if (body?.action !== "mark_all_read") {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:notifications:mark-all-read",
      identifier: auth.user.id,
      maxRequests: 12,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    await markAllNotificationsRead(auth.user.id);
    return mobileJson({ updated: true as const }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_notifications_mark_all_read",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: {
        errorType: error instanceof Error ? error.name : typeof error,
        requestId,
      },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
