import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_PHONE_VERIFIED_COOKIE_NAME, clearUserSession, expireAuthCookies, getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";
import { isMarketplacePhoneVerificationDisabled } from "@/lib/phone-verification";
import { isVerified } from "@/lib/verification-bypass";
import { toClientSessionUser } from "@/lib/client-session-user";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const routeStartedAt = Date.now();
  const timeline: Array<{ name: string; startTime: number; endTime: number; durationMs: number }> = [];
  const loadUserStartedAt = Date.now();
  const user = await getCurrentSessionUser();
  const loadUserEndedAt = Date.now();
  timeline.push({
    name: "/api/auth/me",
    startTime: loadUserStartedAt,
    endTime: loadUserEndedAt,
    durationMs: Math.max(0, loadUserEndedAt - loadUserStartedAt),
  });

  if (!user) {
    const token = await getCurrentSessionToken();
    if (token) {
      await clearUserSession(token);
      const cookieStore = await cookies();
      expireAuthCookies(cookieStore, process.env.NODE_ENV === "production");
    }
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({ user: null }, {
      status: 200,
      headers: {
        ...AUTH_RESPONSE_HEADERS,
        "X-Auth-Me-Route-Ms": String(routeMs),
        "X-Auth-Me-Timeline": JSON.stringify(timeline),
      },
    });
  }

  const cookieStore = await cookies();
  const verified = isMarketplacePhoneVerificationDisabled() || isVerified(user);
  if (verified) {
    cookieStore.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  }
  const routeMs = Date.now() - routeStartedAt;
  return NextResponse.json({
    user: toClientSessionUser(user, { isPhotoVerified: verified }),
  }, {
    headers: {
      ...AUTH_RESPONSE_HEADERS,
      "X-Auth-Me-Route-Ms": String(routeMs),
      "X-Auth-Me-Timeline": JSON.stringify(timeline),
      "Server-Timing": `route;dur=${routeMs}, me;dur=${Math.max(0, loadUserEndedAt - loadUserStartedAt)}`,
    },
  });
}
