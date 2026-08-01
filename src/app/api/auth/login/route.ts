import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, authenticateLocalUser, createUserSession } from "@/lib/auth";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";
import { isVerified } from "@/lib/verification-bypass";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

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
  const secureCookies = shouldUseSecureAuthCookie(request);
  const cookieStore = await cookies();
  const rate = checkRateLimit({
    headers: request.headers,
    key: "auth:login",
    maxRequests: 10,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many login attempts. Please try again shortly." }, { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const rememberMe = body.rememberMe !== false;
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const localUser = await authenticateLocalUser(email, password);
    if (localUser) {
      console.log("[auth/login] upserting local user profile", email);
      const user = await upsertUserProfileForAuth({
        fullName: localUser.fullName,
        email: localUser.email,
        whatsappNumber: localUser.whatsappNumber,
        emailVerified: true,
      });
      console.log("[auth/login] creating user session", user.id);

      const { token, expiresAt } = await createUserSession(user.id, rememberMe ? 14 : 1);
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
        isVerified(user),
      );
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
      }, { headers: AUTH_RESPONSE_HEADERS });
    }

    const supabase = createSupabaseAuthClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
    console.log("[auth/login] upserting supabase user profile", supabaseUser.email);
    const user = await upsertUserProfileForAuth({
      fullName: String(supabaseUser.user_metadata?.full_name ?? supabaseUser.email.split("@")[0]),
      email: supabaseUser.email,
      whatsappNumber: String(supabaseUser.user_metadata?.whatsapp_number ?? ""),
      emailVerified: true,
    });
    console.log("[auth/login] creating user session for supabase user", user.id);

    const { token, expiresAt } = await createUserSession(user.id, rememberMe ? 14 : 1);
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
      isVerified(user),
    );
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
    }, { headers: AUTH_RESPONSE_HEADERS });
  } catch (error) {
    console.error("[auth/login] unexpected error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Login failed." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  }
}
