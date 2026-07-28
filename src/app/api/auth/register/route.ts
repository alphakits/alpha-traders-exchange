import { NextRequest, NextResponse } from "next/server";
import { upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient, getSupabaseEmailRedirectUrl, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function isDuplicateRegistrationError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("already registered") || normalized.includes("already exists");
}

function isAuthRateLimitError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("rate limit") || normalized.includes("too many requests");
}

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
    const email = String(body.email ?? "").trim().toLowerCase();
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

    const locale = inferLocaleFromRequest(request);
    const supabase = createSupabaseAuthClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getSupabaseEmailRedirectUrl(locale),
        data: {
          full_name: fullName,
          whatsapp_number: whatsappNumber,
        },
      },
    });
    if (error) {
      if (isDuplicateRegistrationError(error.message)) {
        return NextResponse.json({ error: "Email already registered." }, { status: 409, headers: AUTH_RESPONSE_HEADERS });
      }
      if (isAuthRateLimitError(error.message)) {
        return NextResponse.json({ error: "Registration is temporarily rate-limited. Please try again in a few minutes." }, { status: 429, headers: AUTH_RESPONSE_HEADERS });
      }
      return NextResponse.json({ error: error.message }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!data.user) {
      return NextResponse.json({ error: "Registration failed." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return NextResponse.json({ error: "Email already registered." }, { status: 409, headers: AUTH_RESPONSE_HEADERS });
    }
    await upsertUserProfileForAuth({
      fullName,
      email,
      whatsappNumber,
      emailVerified: false,
    });

    return NextResponse.json({
      ok: true,
      message: "Your account has been created. Please verify your email before signing in.",
    }, { headers: AUTH_RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Registration failed." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  }
}
