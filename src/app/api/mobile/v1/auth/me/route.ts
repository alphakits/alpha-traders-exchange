import { NextRequest } from "next/server";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { toMobileSessionUser } from "@/lib/mobile-session-user";
import { logEvent } from "@/lib/structured-logging";

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    return mobileJson({ user: toMobileSessionUser(auth.user) }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_auth_me",
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
