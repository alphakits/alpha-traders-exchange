import { NextRequest } from "next/server";
import { hashMobileSecret, mobileAuthService } from "@/lib/mobile-auth";
import {
  createMobileRequestId,
  mobileClientVersionError,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { checkSharedRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

export async function POST(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const versionError = mobileClientVersionError(metadata, requestId, locale);
  if (versionError) return versionError;
  const body = await readMobileJsonBody(request);
  const refreshToken = String(body?.refreshToken ?? "").trim();
  if (!refreshToken || refreshToken.length > 220) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  const [ipRate, deviceRate] = await Promise.all([
    checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:auth:refresh:ip",
      identifier: resolveClientIp(request.headers),
      maxRequests: 120,
      windowMs: 10 * 60_000,
    }),
    checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:auth:refresh:device",
      identifier: hashMobileSecret(`device:${metadata.deviceId}`),
      maxRequests: 60,
      windowMs: 10 * 60_000,
    }),
  ]);
  const blocked = [ipRate, deviceRate].find((rate) => !rate.allowed);
  if (blocked) {
    return mobileError("RATE_LIMITED", requestId, locale, 429, {
      retryAfterSeconds: blocked.retryAfterSeconds,
    });
  }

  try {
    const rotation = await mobileAuthService.rotateRefreshToken(refreshToken, metadata);
    if (rotation.status === "rotated") {
      return mobileJson({ tokens: rotation.tokens }, requestId);
    }
    if (rotation.status === "reused") {
      logEvent("warn", {
        event: "mobile_auth_refresh",
        outcome: "denied",
        reason: "refresh_token_reuse",
        metadata: { requestId },
      });
      return mobileError("REFRESH_TOKEN_REUSED", requestId, locale, 401);
    }
    const code = rotation.status === "expired"
      ? "SESSION_EXPIRED"
      : rotation.status === "revoked"
        ? "SESSION_REVOKED"
        : "UNAUTHORIZED";
    return mobileError(code, requestId, locale, 401);
  } catch (error) {
    logEvent("error", {
      event: "mobile_auth_refresh",
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
