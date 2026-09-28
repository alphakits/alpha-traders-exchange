import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  AUTH_PHONE_VERIFIED_COOKIE_NAME,
  AUTH_VERIFIED_COOKIE_NAME,
  createUserSession,
} from "@/lib/auth";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { resolveMobileWebSessionDestination } from "@/lib/mobile-web-session";
import { isMarketplacePhoneVerificationDisabled } from "@/lib/phone-verification";
import { logEvent } from "@/lib/structured-logging";
import { isVerified } from "@/lib/verification-bypass";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) {
      if (auth.unauthorized.status === 426) return auth.unauthorized;
      const login = new URL(`/${locale}/login`, request.url);
      const response = NextResponse.redirect(login, 302);
      Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
      return response;
    }

    const { token, expiresAt } = await createUserSession(auth.user.id, 14);
    const destination = resolveMobileWebSessionDestination(
      locale,
      request.nextUrl.searchParams.get("returnTo"),
    );
    const response = NextResponse.redirect(new URL(destination, request.url), 302);
    const cookieOptions = {
      httpOnly: true,
      secure: shouldUseSecureAuthCookie(request),
      sameSite: "lax" as const,
      path: "/",
      expires: new Date(expiresAt),
    };
    response.cookies.set(AUTH_COOKIE_NAME, token, cookieOptions);
    response.cookies.set(AUTH_VERIFIED_COOKIE_NAME, "1", cookieOptions);
    if (isMarketplacePhoneVerificationDisabled() || isVerified(auth.user)) {
      response.cookies.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "1", cookieOptions);
    }
    Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));

    logEvent("info", {
      event: "mobile_web_session_handoff",
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      outcome: "success",
      metadata: {
        appVersion: metadata.appVersion,
        platform: metadata.platform,
        requestId,
      },
    });
    return response;
  } catch (error) {
    logEvent("error", {
      event: "mobile_web_session_handoff",
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
