import { NextRequest } from "next/server";
import { authenticateMobileCredentials } from "@/lib/mobile-credentials";
import { mobileAuthService, hashMobileSecret } from "@/lib/mobile-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { toMobileSessionUser } from "@/lib/mobile-session-user";
import { checkSharedRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  const body = await readMobileJsonBody(request);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!EMAIL_PATTERN.test(email) || password.length < 8 || password.length > 256) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  const clientIp = resolveClientIp(request.headers);
  const accountKey = hashMobileSecret(`account:${email}`);
  const deviceKey = hashMobileSecret(`device:${metadata.deviceId}`);
  const limits = await Promise.all([
    checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:auth:login:ip",
      identifier: clientIp,
      maxRequests: 30,
      windowMs: 10 * 60_000,
    }),
    checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:auth:login:account",
      identifier: accountKey,
      maxRequests: 10,
      windowMs: 10 * 60_000,
    }),
    checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:auth:login:device",
      identifier: deviceKey,
      maxRequests: 15,
      windowMs: 10 * 60_000,
    }),
  ]);
  const blocked = limits.find((limit) => !limit.allowed);
  if (blocked) {
    return mobileError("RATE_LIMITED", requestId, locale, 429, {
      retryAfterSeconds: blocked.retryAfterSeconds,
    });
  }

  try {
    const credential = await authenticateMobileCredentials(request, email, password);
    if (credential.status === "invalid") {
      return mobileError("INVALID_CREDENTIALS", requestId, locale, 401);
    }
    if (credential.status === "email_unverified") {
      return mobileError("EMAIL_VERIFICATION_REQUIRED", requestId, locale, 403);
    }
    if (credential.status === "disabled") {
      return mobileError("ACCOUNT_DISABLED", requestId, locale, 403);
    }

    const issued = await mobileAuthService.issueSession(credential.user.id, metadata);
    logEvent("info", {
      event: "mobile_auth_login",
      actorUserId: credential.user.id,
      actorRole: credential.user.role,
      outcome: "success",
      metadata: {
        platform: metadata.platform,
        appVersion: metadata.appVersion,
        requestId,
      },
    });
    return mobileJson({
      user: toMobileSessionUser(credential.user),
      tokens: issued.tokens,
    }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_auth_login",
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
