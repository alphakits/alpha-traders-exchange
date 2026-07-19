import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";

const AUTH_COOKIE_NAME = "alpha_exchange_session";

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: Parameters<typeof intlMiddleware>[0]) {
  const { pathname } = request.nextUrl;
  const isProtectedRoute = /^\/(ar|en)\/(?:dashboard|profile)(?:\/|$)/.test(pathname);
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);

  if (isProtectedRoute && !hasSession) {
    const locale = pathname.startsWith("/en/") ? "en" : "ar";
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/", "/(ar|en)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
