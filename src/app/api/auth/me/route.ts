import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_PHONE_VERIFIED_COOKIE_NAME, clearUserSession, getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";
import { AUTH_VERIFIED_COOKIE_NAME } from "@/lib/auth-constants";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";
import { isMarketplacePhoneVerificationDisabled } from "@/lib/phone-verification";
import { isVerified } from "@/lib/verification-bypass";
import { toClientSessionUser } from "@/lib/client-session-user";
import { unstable_rethrow } from "next/navigation";
import { logEvent } from "@/lib/structured-logging";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  const routeStartedAt = Date.now();
  const timeline: Array<{ name: string; startTime: number; endTime: number; durationMs: number }> = [];
  const loadUserStartedAt = Date.now();
  let user: Awaited<ReturnType<typeof getCurrentSessionUser>>;
  try {
    user = await getCurrentSessionUser();
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", {
      event: "auth_me_session_unavailable",
      outcome: "failed",
      reason: "session_read_failed",
      metadata: { errorName: error instanceof Error ? error.name : typeof error },
    });
    return NextResponse.json({ error: "SESSION_TEMPORARILY_UNAVAILABLE" }, {
      status: 503,
      headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": "3" },
    });
  }
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
      // An old background read must not clear a replacement login cookie.
      // Canonical authorization still rejects this token; logout owns expiry.
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
  const secureCookie = shouldUseSecureAuthCookie(request);
  // Middleware uses this cookie only as a routing hint. Repair it from the
  // authenticated account so a lost hint cannot trap a verified user on the
  // verification screen; a stale positive hint must also be cleared.
  const hasEmailVerificationHint = cookieStore.get(AUTH_VERIFIED_COOKIE_NAME)?.value === "1";
  if (user.emailVerified !== true || !hasEmailVerificationHint) {
    // Keep an existing correct hint intact, including a remembered login's
    // expiry. Rewriting it without that expiry would make it session-only.
    cookieStore.set(AUTH_VERIFIED_COOKIE_NAME, user.emailVerified === true ? "1" : "", {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
      ...(user.emailVerified === true ? {} : { maxAge: 0 }),
    });
  }
  const verified = isMarketplacePhoneVerificationDisabled() || isVerified(user);
  if (verified) {
    cookieStore.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
    });
  } else {
    cookieStore.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "", {
      httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/", maxAge: 0,
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
