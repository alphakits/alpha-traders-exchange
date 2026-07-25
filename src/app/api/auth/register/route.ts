import { NextRequest, NextResponse } from "next/server";
import { createEmailVerificationTokenForUser, createUser } from "@/lib/alpha-exchange-store";
import { hashPassword } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/auth-email";
import { checkRateLimit } from "@/lib/rate-limit";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest) {
  const rate = checkRateLimit({
    headers: request.headers,
    key: "auth:register",
    maxRequests: 6,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many registration attempts. Please try again shortly." }, { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const confirmPassword = String(body.confirmPassword ?? "");
    const whatsappNumber = String(body.whatsappNumber ?? "").trim();
    const agreedToTerms = Boolean(body.agreedToTerms);

    if (!fullName || !email || !password || !confirmPassword || !whatsappNumber) {
      return NextResponse.json({ error: "All fields are required." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (fullName.length > 100 || whatsappNumber.length > 30 || email.length > 254) {
      return NextResponse.json({ error: "One or more fields exceed allowed length." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!agreedToTerms) {
      return NextResponse.json({ error: "Terms must be accepted." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({
      fullName,
      email,
      passwordHash,
      whatsappNumber,
    });
    const verification = await createEmailVerificationTokenForUser(user.id);

    try {
      await sendVerificationEmail({
        to: user.email,
        fullName: user.fullName,
        token: verification.token,
      });
    } catch (error) {
      console.error("[auth/register] Failed to send verification email:", error);
    }

    return NextResponse.json({
      ok: true,
      message: "Your account has been created. Please verify your email before signing in.",
    }, { headers: AUTH_RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Registration failed." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  }
}
