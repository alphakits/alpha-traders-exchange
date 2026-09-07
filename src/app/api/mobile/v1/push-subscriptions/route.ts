import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getCurrentSessionToken } from "@/lib/auth";
import {
  isExpoPushToken,
  isMobilePushInstallationId,
  registerMobilePushSubscription,
} from "@/lib/mobile-push";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import {
  createMobileRequestId,
  mobileClientVersionError,
  mobileError,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RegistrationBody = {
  expoPushToken?: unknown;
  installationId?: unknown;
  platform?: unknown;
  locale?: unknown;
  appVersion?: unknown;
};

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function hasTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:"
      && (parsed.hostname === "alphatraders.co.il" || parsed.hostname === "www.alphatraders.co.il");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const requestLocale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, requestLocale, 400);
  const versionError = mobileClientVersionError(metadata, requestId, requestLocale);
  if (versionError) return versionError;
  if (!hasTrustedOrigin(request)) return noStoreJson({ error: "Invalid request origin." }, 403);
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "mobile:web-push-registration",
    identifier: user.id,
    maxRequests: 12,
    windowMs: 60_000,
  });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json().catch(() => null) as RegistrationBody | null;
  const expoPushToken = typeof body?.expoPushToken === "string" ? body.expoPushToken.trim() : "";
  const installationId = typeof body?.installationId === "string" ? body.installationId.trim() : "";
  const appVersion = typeof body?.appVersion === "string" ? body.appVersion.trim() : "";
  const platform = body?.platform === "ios" || body?.platform === "android" ? body.platform : null;
  const locale = body?.locale === "ar" || body?.locale === "en" ? body.locale : null;
  if (
    !isExpoPushToken(expoPushToken)
    || !isMobilePushInstallationId(installationId)
    || !platform
    || !locale
    || platform !== metadata.platform
    || locale !== metadata.locale
    || installationId !== metadata.deviceId
    || appVersion !== metadata.appVersion
    || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(appVersion)
  ) {
    return noStoreJson({ error: "Invalid mobile push registration." }, 400);
  }

  const sessionToken = await getCurrentSessionToken();
  if (!sessionToken) return noStoreJson({ error: "Unauthorized" }, 401);
  try {
    await registerMobilePushSubscription({
      userId: user.id,
      sessionToken,
      installationId,
      expoPushToken,
      platform,
      locale,
      appVersion,
    });
    return noStoreJson({ registered: true });
  } catch (error) {
    const sessionEnded = error instanceof Error
      && error.message === "Authenticated session is no longer active.";
    logEvent(sessionEnded ? "warn" : "error", {
      event: "mobile_push_registration",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: sessionEnded ? "denied" : "failed",
      reason: sessionEnded ? "Authenticated session ended during registration." : "Mobile push storage unavailable.",
    });
    return noStoreJson(
      { error: sessionEnded ? "Unauthorized" : "Push registration is temporarily unavailable." },
      sessionEnded ? 401 : 503,
    );
  }
}
