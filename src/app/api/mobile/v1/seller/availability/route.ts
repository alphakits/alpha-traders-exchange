import { NextRequest } from "next/server";
import { updateSellerAvailabilityStatus } from "@/lib/alpha-exchange-store";
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
import { hasRole } from "@/lib/roles";
import { logEvent } from "@/lib/structured-logging";
import type { SellerAvailabilityStatus } from "@/types/alpha-exchange";

function isAvailabilityStatus(value: string): value is SellerAvailabilityStatus {
  return value === "available" || value === "away" || value === "vacation";
}

export async function PATCH(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    if (!hasRole(auth.user, "approved_seller")) {
      return mobileError("SELLER_ROLE_REQUIRED", requestId, locale, 403);
    }
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:seller-availability",
      maxRequests: 12,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }
    const body = await readMobileJsonBody(request);
    const availabilityStatus = String(body?.availabilityStatus ?? "").trim();
    if (!isAvailabilityStatus(availabilityStatus)) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const seller = await updateSellerAvailabilityStatus({
      sellerId: auth.user.id,
      actorUserId: auth.user.id,
      availabilityStatus,
    });
    return mobileJson({ availabilityStatus: seller.availabilityStatus }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_seller_availability",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
