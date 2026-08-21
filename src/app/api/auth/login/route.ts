import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, authenticateLocalUser, createUserSession } from "@/lib/auth";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";
import { checkSharedRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { createSupabaseAuthClient, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";
import { isMarketplacePhoneVerificationDisabled } from "@/lib/phone-verification";
import { isVerified } from "@/lib/verification-bypass";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
type LoginTimelineStep = {
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  meta?: Record<string, string | number | boolean | null>;
};

function loginRateLimitMessage(locale: "ar" | "en") {
  return locale === "ar"
    ? "تم تقييد تسجيل الدخول مؤقتًا. يُرجى المحاولة مرة أخرى بعد قليل."
    : "Too many login attempts. Please try again shortly.";
}

function pushTimelineStep(
  timeline: LoginTimelineStep[],
  name: string,
  startTime: number,
  endTime: number,
  meta?: Record<string, string | number | boolean | null>,
) {
  timeline.push({
    name,
    startTime,
    endTime,
    durationMs: Math.max(0, endTime - startTime),
    meta,
  });
}

function clearAuthCookies(cookieStore: Awaited<ReturnType<typeof cookies>>, secure: boolean) {
  const expires = new Date(0);
  cookieStore.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires,
  });
  cookieStore.set(AUTH_VERIFIED_COOKIE_NAME, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires,
  });
  cookieStore.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires,
  });
}

function setPhoneVerificationCookie(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  secure: boolean,
  rememberMe: boolean,
  expiresAt: string,
  isPhoneVerified: boolean,
) {
  if (!isPhoneVerified) {
    cookieStore.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "", {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });
    return;
  }
  cookieStore.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "1", {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: rememberMe ? new Date(expiresAt) : undefined,
  });
}

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  const timeline: LoginTimelineStep[] = [];
  const authDebug = process.env.ALPHA_AUTH_DEBUG === "1";
  const secureCookies = shouldUseSecureAuthCookie(request);
  const cookieStore = await cookies();
  const locale = inferLocaleFromRequest(request);
  const clientIp = resolveClientIp(request.headers);
  const isProduction = process.env.NODE_ENV === "production";
  const ipRateMaxRequests = isProduction ? 120 : 600;
  const ipEmailRateMaxRequests = isProduction ? 24 : 240;
  try {
    let body: Record<string, unknown> = {};
    let rawBody = "";
    try {
      rawBody = await request.text();
      const contentType = request.headers.get("content-type") ?? "";
      if (authDebug) {
        const sanitizedBodyPreview = rawBody.replace(/"password":"([^"]*)"/g, '"password":"[REDACTED]"');
        console.error("[auth/login] body preview", { contentType, length: rawBody.length, preview: sanitizedBodyPreview.slice(0, 400) });
      }
      if (!rawBody.trim()) {
        body = {};
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams(rawBody);
        body = Object.fromEntries(params.entries());
      } else {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        if (authDebug) {
          console.error("[auth/login] parse failure", { error: error.message, bodyLength: rawBody.length });
        }
        return NextResponse.json({ error: "Invalid JSON body." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
      }
      throw error;
    }
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const rememberMe = body.rememberMe !== false;

    const ipRate = await checkSharedRateLimit({
      headers: request.headers,
      key: "auth:login:ip",
      maxRequests: ipRateMaxRequests,
      windowMs: 10 * 60_000,
    });
    if (!ipRate.allowed) {
      return NextResponse.json(
        { error: loginRateLimitMessage(locale) },
        { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(ipRate.retryAfterSeconds) } },
      );
    }
    const ipEmailRate = await checkSharedRateLimit({
      headers: request.headers,
      key: "auth:login:ip-email",
      identifier: `${clientIp}:${email}`,
      maxRequests: ipEmailRateMaxRequests,
      windowMs: 10 * 60_000,
    });
    if (!ipEmailRate.allowed) {
      return NextResponse.json(
        { error: loginRateLimitMessage(locale) },
        { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(ipEmailRate.retryAfterSeconds) } },
      );
    }
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const localAuthStartedAt = Date.now();
    const localUser = await authenticateLocalUser(email, password);
    const localAuthEndedAt = Date.now();
    const localAuthMs = localAuthEndedAt - localAuthStartedAt;
    pushTimelineStep(timeline, "Password hashing / verification", localAuthStartedAt, localAuthEndedAt, { provider: "local" });
    if (localUser) {
      const upsertStartedAt = Date.now();
      const user = await upsertUserProfileForAuth({
        fullName: localUser.fullName,
        email: localUser.email,
        whatsappNumber: localUser.whatsappNumber,
        emailVerified: true,
      });
      const upsertMs = Date.now() - upsertStartedAt;

      const sessionStartedAt = Date.now();
      const { token, expiresAt } = await createUserSession(user.id, rememberMe ? 14 : 1);
      const sessionEndedAt = Date.now();
      const sessionMs = sessionEndedAt - sessionStartedAt;
      pushTimelineStep(timeline, "Database session creation", sessionStartedAt, sessionEndedAt, { provider: "local" });
      const cookieWriteStartedAt = Date.now();
      cookieStore.set(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        path: "/",
        expires: rememberMe ? new Date(expiresAt) : undefined,
      });
      cookieStore.set(AUTH_VERIFIED_COOKIE_NAME, "1", {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        path: "/",
        expires: rememberMe ? new Date(expiresAt) : undefined,
      });
      setPhoneVerificationCookie(
        cookieStore,
        secureCookies,
        rememberMe,
        expiresAt,
        isMarketplacePhoneVerificationDisabled() || isVerified(user),
      );
      const cookieWriteEndedAt = Date.now();
      pushTimelineStep(timeline, "Cookie write", cookieWriteStartedAt, cookieWriteEndedAt, { provider: "local" });
      const routeMs = Date.now() - routeStartedAt;
      const dbMs = localAuthMs + upsertMs + sessionMs;
      return NextResponse.json({
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          roles: user.roles ?? [user.role],
          sellerStatus: user.sellerStatus,
          onboardingSelection: user.onboardingSelection,
          onboardingCompletedAt: user.onboardingCompletedAt,
        },
      }, {
        headers: {
          ...AUTH_RESPONSE_HEADERS,
          "X-Auth-Route-Ms": String(routeMs),
          "X-Auth-Db-Ms": String(dbMs),
          "X-Auth-Local-Auth-Ms": String(localAuthMs),
          "X-Auth-Upsert-Ms": String(upsertMs),
          "X-Auth-Session-Ms": String(sessionMs),
          "X-Auth-Login-Timeline": JSON.stringify(timeline),
          "Server-Timing": `route;dur=${routeMs}, db;dur=${dbMs}, localAuth;dur=${localAuthMs}, upsert;dur=${upsertMs}, session;dur=${sessionMs}`,
        },
      });
    }

    const supabase = createSupabaseAuthClient({ requestHeaders: request.headers });
    const supabaseAuthStartedAt = Date.now();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    const supabaseAuthEndedAt = Date.now();
    const supabaseAuthMs = supabaseAuthEndedAt - supabaseAuthStartedAt;
    pushTimelineStep(timeline, "Password hashing / verification", supabaseAuthStartedAt, supabaseAuthEndedAt, { provider: "supabase" });
    if (error) {
      clearAuthCookies(cookieStore, secureCookies);
      if (error.message.toLowerCase().includes("email not confirmed")) {
        return NextResponse.json(
          {
            error: "Please verify your email before signing in. Check your inbox or request a new verification email.",
            requiresEmailVerification: true,
          },
          { status: 403, headers: AUTH_RESPONSE_HEADERS },
        );
      }
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401, headers: AUTH_RESPONSE_HEADERS });
    }
    const supabaseUser = data.user;
    if (!supabaseUser?.email) {
      clearAuthCookies(cookieStore, secureCookies);
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!supabaseUser.email_confirmed_at) {
      clearAuthCookies(cookieStore, secureCookies);
      return NextResponse.json(
        {
          error: "Please verify your email before signing in. Check your inbox or request a new verification email.",
          requiresEmailVerification: true,
        },
        { status: 403, headers: AUTH_RESPONSE_HEADERS },
      );
    }
    const upsertStartedAt = Date.now();
    const user = await upsertUserProfileForAuth({
      fullName: String(supabaseUser.user_metadata?.full_name ?? supabaseUser.email.split("@")[0]),
      email: supabaseUser.email,
      whatsappNumber: String(supabaseUser.user_metadata?.whatsapp_number ?? ""),
      emailVerified: true,
    });
    const upsertMs = Date.now() - upsertStartedAt;

    const sessionStartedAt = Date.now();
    const { token, expiresAt } = await createUserSession(user.id, rememberMe ? 14 : 1);
    const sessionEndedAt = Date.now();
    const sessionMs = sessionEndedAt - sessionStartedAt;
    pushTimelineStep(timeline, "Database session creation", sessionStartedAt, sessionEndedAt, { provider: "supabase" });
    const cookieWriteStartedAt = Date.now();
    cookieStore.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      expires: rememberMe ? new Date(expiresAt) : undefined,
    });
    cookieStore.set(AUTH_VERIFIED_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      expires: rememberMe ? new Date(expiresAt) : undefined,
    });
    setPhoneVerificationCookie(
      cookieStore,
      secureCookies,
      rememberMe,
      expiresAt,
      isMarketplacePhoneVerificationDisabled() || isVerified(user),
    );
    const cookieWriteEndedAt = Date.now();
    pushTimelineStep(timeline, "Cookie write", cookieWriteStartedAt, cookieWriteEndedAt, { provider: "supabase" });
    const routeMs = Date.now() - routeStartedAt;
    const dbMs = upsertMs + sessionMs;
    return NextResponse.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        roles: user.roles ?? [user.role],
        sellerStatus: user.sellerStatus,
        onboardingSelection: user.onboardingSelection,
        onboardingCompletedAt: user.onboardingCompletedAt,
      },
    }, {
      headers: {
        ...AUTH_RESPONSE_HEADERS,
        "X-Auth-Route-Ms": String(routeMs),
        "X-Auth-Db-Ms": String(dbMs),
        "X-Auth-Supabase-Ms": String(supabaseAuthMs),
        "X-Auth-Upsert-Ms": String(upsertMs),
        "X-Auth-Session-Ms": String(sessionMs),
        "X-Auth-Login-Timeline": JSON.stringify(timeline),
        "Server-Timing": `route;dur=${routeMs}, db;dur=${dbMs}, supabase;dur=${supabaseAuthMs}, upsert;dur=${upsertMs}, session;dur=${sessionMs}`,
      },
    });
  } catch (error) {
    console.error("[auth/login] unexpected error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Login failed." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  }
}
