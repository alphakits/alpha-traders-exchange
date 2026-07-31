import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: Parameters<typeof intlMiddleware>[0]) {
  const { pathname } = request.nextUrl;
  const isProtectedRoute = /^\/(ar|en)\/(?:academy|lessons|usdt-exchange|dashboard|profile|settings|admin)(?:\/|$)/.test(pathname);
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  const hasVerifiedEmail = request.cookies.get(AUTH_VERIFIED_COOKIE_NAME)?.value === "1";

  if (isProtectedRoute && !hasSession) {
    const locale = pathname.startsWith("/ar/") ? "ar" : "en";
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("redirectTo", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
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
