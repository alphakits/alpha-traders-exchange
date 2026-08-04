import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";
import { isMarketplacePhoneVerificationDisabled } from "@/lib/phone-verification";

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: Parameters<typeof intlMiddleware>[0]) {
  const { pathname } = request.nextUrl;
  const isProtectedRoute = /^\/(ar|en)\/(?:academy|lessons|usdt-exchange|trade-room|dashboard|profile|settings|admin)(?:\/|$)/.test(pathname);
  const isExchangeRoute = /^\/(ar|en)\/(?:dashboard\/seller|trade-room)(?:\/|$)/.test(pathname);
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  const hasVerifiedEmail = request.cookies.get(AUTH_VERIFIED_COOKIE_NAME)?.value === "1";
  // When ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION=1 is set (pre-Twilio operation),
  // bypass the phone cookie check entirely so the Trade Room remains accessible.
  const skipPhoneVerification = isMarketplacePhoneVerificationDisabled();
  const hasVerifiedPhone = skipPhoneVerification || request.cookies.get(AUTH_PHONE_VERIFIED_COOKIE_NAME)?.value === "1";

  if (isProtectedRoute && !hasSession) {
    const locale = pathname.startsWith("/ar/") ? "ar" : "en";
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("redirectTo", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }
  if (isExchangeRoute && hasSession && (!hasVerifiedEmail || !hasVerifiedPhone)) {
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
  matcher: ["/", "/(ar|en)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
