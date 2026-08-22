import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { createSupabaseAuthClient, getSupabaseEmailRedirectUrl, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";
import { logEvent } from "@/lib/structured-logging";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function isDuplicateRegistrationError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("already registered") || normalized.includes("already exists");
}

function registrationRateLimitMessage(locale: "ar" | "en") {
  return locale === "ar"
    ? "تم تقييد التسجيل مؤقتًا. يُرجى المحاولة مرة أخرى خلال بضع دقائق."
    : "Registration is temporarily rate-limited. Please try again in a few minutes.";
}

function registrationSuccessMessage(locale: "ar" | "en") {
  return locale === "ar"
    ? "تم إنشاء الحساب. يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول."
    : "Your account has been created. Please verify your email before signing in.";
}

function logRegistrationRateLimit(reason: string, details: Record<string, unknown>) {
  const retryAfterSeconds = typeof details.retryAfterSeconds === "number"
    ? details.retryAfterSeconds
    : undefined;
  logEvent("warn", {
    event: "auth_registration_rate_limit",
    outcome: "denied",
    reason,
    metadata: { retryAfterSeconds },
  });
}

export async function POST(request: NextRequest) {
  const locale = inferLocaleFromRequest(request);
  const clientIp = resolveClientIp(request.headers);
  const ipRate = await checkSharedRateLimit({
    headers: request.headers,
    key: "auth:register:ip",
    maxRequests: 25,
    windowMs: 10 * 60_000,
  });
  if (!ipRate.allowed) {
    logRegistrationRateLimit("ip_limit_reached", {
      retryAfterSeconds: ipRate.retryAfterSeconds,
    });
    return NextResponse.json(
      { error: registrationRateLimitMessage(locale) },
      { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(ipRate.retryAfterSeconds) } },
    );
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

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      logRegistrationRateLimit("duplicate_registration", {
        ip: clientIp,
        email,
        provider: "local-profile",
      });
      return NextResponse.json({ error: "Email already registered." }, { status: 409, headers: AUTH_RESPONSE_HEADERS });
    }

    const ipEmailRate = await checkSharedRateLimit({
      headers: request.headers,
      key: "auth:register:ip-email",
      identifier: `${clientIp}:${email}`,
      maxRequests: 8,
      windowMs: 10 * 60_000,
    });
    if (!ipEmailRate.allowed) {
      logRegistrationRateLimit("email_limit_reached", {
        ip: clientIp,
        email,
        retryAfterSeconds: ipEmailRate.retryAfterSeconds,
      });
      return NextResponse.json(
        { error: registrationRateLimitMessage(locale) },
        { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(ipEmailRate.retryAfterSeconds) } },
      );
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

    const supabase = createSupabaseAuthClient({ requestHeaders: request.headers });
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
        logRegistrationRateLimit("duplicate_registration", {
          ip: clientIp,
          email,
          provider: "supabase",
        });
        return NextResponse.json({ error: "Email already registered." }, { status: 409, headers: AUTH_RESPONSE_HEADERS });
      }
      if (error.message.toLowerCase().includes("rate limit")) {
        logRegistrationRateLimit("provider_rate_limit", {
          ip: clientIp,
          email,
          provider: "supabase",
        });
        return NextResponse.json({ error: registrationRateLimitMessage(locale) }, { status: 429, headers: AUTH_RESPONSE_HEADERS });
      }
      logRegistrationRateLimit("provider_signup_failed", {
        ip: clientIp,
        email,
        provider: "supabase",
      });
      return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!data.user) {
      return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
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
      message: registrationSuccessMessage(locale),
    }, { headers: AUTH_RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Registration failed." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  }
}
