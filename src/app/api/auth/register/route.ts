import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createUser } from "@/lib/alpha-exchange-store";
import { AUTH_COOKIE_NAME, createUserSession, hashPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const rate = checkRateLimit({
    headers: request.headers,
    key: "auth:register",
    maxRequests: 6,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many registration attempts. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const confirmPassword = String(body.confirmPassword ?? "");
    const whatsappNumber = String(body.whatsappNumber ?? "").trim();
    const inviteCode = String(body.inviteCode ?? "").trim();
    const agreedToTerms = Boolean(body.agreedToTerms);

    if (!fullName || !email || !password || !confirmPassword || !whatsappNumber) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400 });
    }
    if (!inviteCode) {
      return NextResponse.json({ error: "Invite code is required for private beta registration." }, { status: 400 });
    }
    if (inviteCode.length > 64) {
      return NextResponse.json({ error: "Invite code is invalid." }, { status: 400 });
    }
    if (fullName.length > 100 || whatsappNumber.length > 30) {
      return NextResponse.json({ error: "One or more fields exceed allowed length." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400 });
    }
    if (!agreedToTerms) {
      return NextResponse.json({ error: "Terms must be accepted." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({
      fullName,
      email,
      passwordHash,
      whatsappNumber,
      inviteCode,
    });
    const { token, expiresAt } = await createUserSession(user.id);
    const secureCookies = process.env.AUTH_COOKIE_SECURE === "true";
    const cookieStore = await cookies();
    cookieStore.set(AUTH_COOKIE_NAME, token, {
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
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Registration failed." }, { status: 400 });
  }
}
