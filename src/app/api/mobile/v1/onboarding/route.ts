import { NextRequest } from "next/server";
import type { MobileOnboardingRequest } from "@alpha-traders/contracts";
import {
  activateBuyerOnboardingWithoutPhone,
  grantStudentRole,
  selectGuestOnboarding,
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
      key: "mobile:onboarding:update",
      identifier: auth.user.id,
      maxRequests: 12,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const body = await readMobileJsonBody(request) as MobileOnboardingRequest | null;
    if (!body || !["guest", "student", "buyer"].includes(body.action)) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const updated = body.action === "guest"
      ? await selectGuestOnboarding(auth.user.id)
      : body.action === "student"
        ? await grantStudentRole(auth.user.id)
        : await activateBuyerOnboardingWithoutPhone({
            userId: auth.user.id,
            firstName: String(body.firstName ?? "").slice(0, 100),
            lastName: String(body.lastName ?? "").slice(0, 100),
            displayName: String(body.displayName ?? "").slice(0, 100),
          });

    logEvent("info", {
      event: "mobile_onboarding_update",
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      outcome: "success",
      metadata: { selection: body.action, requestId },
    });
    return mobileJson({ user: toMobileSessionUser(updated) }, requestId);
  } catch (error) {
    logEvent("warn", {
      event: "mobile_onboarding_update",
      outcome: "failed",
      reason: "invalid_or_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}
