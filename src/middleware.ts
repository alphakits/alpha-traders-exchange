import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";
import { isMarketplacePhoneVerificationDisabled } from "@/lib/phone-verification";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { allowsLocalTestSupportRequest } from "@/lib/runtime-safety";

const intlMiddleware = createMiddleware(routing);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const EXTERNAL_CALLBACK_PATHS = new Set([
  "/api/discord/marketplace-events",
  "/api/twilio/status",
]);

function isExternalCallbackPath(pathname: string) {
  return EXTERNAL_CALLBACK_PATHS.has(pathname.replace(/\/$/, ""));
}

function rejectUntrustedApiMutation() {
  return NextResponse.json(
    { error: "Invalid request origin." },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Vary": "Origin, Sec-Fetch-Site",
      },
    },
  );
}

export default function middleware(request: Parameters<typeof intlMiddleware>[0]) {
  const { pathname } = request.nextUrl;
  const isApiRoute = pathname.startsWith("/api/");

  if (isApiRoute) {
    const isProtectedMutation = STATE_CHANGING_METHODS.has(request.method.toUpperCase())
      && !isExternalCallbackPath(pathname);
    const isOriginlessLocalTestMutation = !request.headers.get("origin")
      && allowsLocalTestSupportRequest(request);
    if (
      isProtectedMutation
      && !hasTrustedSameOrigin(request)
      && !isOriginlessLocalTestMutation
    ) {
      return rejectUntrustedApiMutation();
    }
    return NextResponse.next();
  }

  const isProtectedRoute = /^\/(ar|en)\/(?:academy|lessons|usdt-exchange|trade-room|dashboard|profile|settings|admin)(?:\/|$)/.test(pathname);
  const isSellerWorkspaceRoute = /^\/(ar|en)\/dashboard\/seller(?:\/|$)/.test(pathname);
  const isTradeRoomRoute = /^\/(ar|en)\/trade-room(?:\/|$)/.test(pathname);
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  const hasVerifiedEmail = request.cookies.get(AUTH_VERIFIED_COOKIE_NAME)?.value === "1";
  // The local test-only setting may bypass the seller-workspace phone cookie
  // check. Trade Room access is email-gated independently below.
  const skipPhoneVerification = isMarketplacePhoneVerificationDisabled();
  const hasVerifiedPhone = skipPhoneVerification || request.cookies.get(AUTH_PHONE_VERIFIED_COOKIE_NAME)?.value === "1";

  if (isProtectedRoute && !hasSession) {
    const locale = pathname.startsWith("/ar/") ? "ar" : "en";
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("redirectTo", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  if (isSellerWorkspaceRoute && hasSession && (!hasVerifiedEmail || !hasVerifiedPhone)) {
    const locale = pathname.startsWith("/ar/") ? "ar" : "en";
    const verifyAccountUrl = new URL(`/${locale}/verify-account`, request.url);
    verifyAccountUrl.searchParams.set("redirectTo", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(verifyAccountUrl);
  }
  if (isTradeRoomRoute && hasSession && !hasVerifiedEmail) {
    const locale = pathname.startsWith("/ar/") ? "ar" : "en";
    const verifyAccountUrl = new URL(`/${locale}/verify-account`, request.url);
    verifyAccountUrl.searchParams.set("redirectTo", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(verifyAccountUrl);
  }
  if (isProtectedRoute && hasSession && !hasVerifiedEmail) {
    const locale = pathname.startsWith("/ar/") ? "ar" : "en";
    const verifyUrl = new URL(`/${locale}/verify-email`, request.url);
    return NextResponse.redirect(verifyUrl);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/", "/api/:path*", "/(ar|en)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
