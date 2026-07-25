import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findUserByEmail } from "@/lib/alpha-exchange-store";
import { AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, createUserSession, verifyPassword } from "@/lib/auth";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";
import { checkRateLimit } from "@/lib/rate-limit";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest) {
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
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401, headers: AUTH_RESPONSE_HEADERS });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401, headers: AUTH_RESPONSE_HEADERS });
    }
    if (user.emailVerified !== true) {
      return NextResponse.json(
        {
          error: "Please verify your email before signing in. Check your inbox or request a new verification email.",
          requiresEmailVerification: true,
        },
        { status: 403, headers: AUTH_RESPONSE_HEADERS },
      );
    }

    const { token, expiresAt } = await createUserSession(user.id);
    const secureCookies = shouldUseSecureAuthCookie(request);
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      expires: new Date(expiresAt),
    });
    cookieStore.set(AUTH_VERIFIED_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      expires: new Date(expiresAt),
    });
    return NextResponse.json({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        sellerStatus: user.sellerStatus,
      },
    }, { headers: AUTH_RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Login failed." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  }
}
