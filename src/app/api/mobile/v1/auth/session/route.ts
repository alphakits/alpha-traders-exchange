import { NextRequest } from "next/server";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import { mobileAuthService } from "@/lib/mobile-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { logEvent } from "@/lib/structured-logging";

export async function DELETE(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const scope = request.nextUrl.searchParams.get("scope") === "all" ? "all" : "device";
    if (scope === "all") {
      await mobileAuthService.revokeAllUserSessions(auth.user.id);
    } else {
      await mobileAuthService.revokeDevice(auth.accessToken);
    }
    logEvent("info", {
      event: "mobile_auth_logout",
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      outcome: "success",
      metadata: { scope, requestId },
    });
    return mobileJson({ revoked: true as const, scope }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_auth_logout",
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
