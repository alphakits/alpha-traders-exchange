import { NextRequest } from "next/server";
import { markNotificationReadState } from "@/lib/alpha-exchange-store";
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

type RouteContext = {
  params: Promise<{ notificationId: string }>;
};

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const { notificationId } = await context.params;
  if (!RESOURCE_ID_PATTERN.test(notificationId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const body = await readMobileJsonBody(request);
    if (typeof body?.isRead !== "boolean") {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:notifications:read-state",
      identifier: auth.user.id,
      maxRequests: 40,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const notification = await markNotificationReadState({
      userId: auth.user.id,
      notificationId,
      isRead: body.isRead,
    });
    return mobileJson({ notification: toMobileNotification(notification, locale) }, requestId);
  } catch (error) {
    if (error instanceof Error && error.message === "Notification not found.") {
      return mobileError("NOT_FOUND", requestId, locale, 404);
    }
    logEvent("error", {
      event: "mobile_notification_read_state",
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
