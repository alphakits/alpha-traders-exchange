import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { checkRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { createSupabaseAdminClient, createSupabaseAuthClient, getSupabaseEmailRedirectUrl, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";
import { buildAuthEmail, sendAuthEmailViaResend } from "@/lib/auth-email-delivery";

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

function logRegistrationRateLimit(reason: string, details: Record<string, string | number | boolean | null>) {
  if (process.env.NODE_ENV === "test") return;
  console.warn("[auth/register] rate-limited", { reason, ...details });
}

export async function POST(request: NextRequest) {
  const locale = inferLocaleFromRequest(request);
  const clientIp = resolveClientIp(request.headers);
  const ipRate = checkRateLimit({
    headers: request.headers,
    key: "auth:register:ip",
    maxRequests: 25,
    windowMs: 10 * 60_000,
  });
  if (!ipRate.allowed) {
    logRegistrationRateLimit("ip_limit_reached", {
      ip: clientIp,
      retryAfterSeconds: ipRate.retryAfterSeconds,
      path: request.nextUrl.pathname,
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

    const ipEmailRate = checkRateLimit({
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

    const adminSupabase = createSupabaseAdminClient();
    const createResult = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: {
        full_name: fullName,
        whatsapp_number: whatsappNumber,
      },
    });
    if (createResult.error) {
      if (isDuplicateRegistrationError(createResult.error.message)) {
        logRegistrationRateLimit("duplicate_registration", {
          ip: clientIp,
          email,
          provider: "supabase_admin",
        });
        return NextResponse.json({ error: "Email already registered." }, { status: 409, headers: AUTH_RESPONSE_HEADERS });
      }
      logRegistrationRateLimit("provider_create_user_failed", {
        ip: clientIp,
        email,
        provider: "supabase_admin",
      });
      return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const linkResult = await adminSupabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo: getSupabaseEmailRedirectUrl(locale),
      },
    });

    if (linkResult.error) {
      logRegistrationRateLimit("provider_generate_link_failed", {
        ip: clientIp,
        email,
        provider: "supabase_admin",
      });
      return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const actionLink = linkResult.data?.properties?.action_link;
    if (typeof actionLink !== "string" || !actionLink.startsWith("http")) {
      logRegistrationRateLimit("provider_generate_link_missing", {
        ip: clientIp,
        email,
        provider: "supabase_admin",
      });
      return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const verificationMail = buildAuthEmail("verification", locale, actionLink);
    const deliveryResult = await sendAuthEmailViaResend({
      to: email,
      subject: verificationMail.subject,
      html: verificationMail.html,
      text: verificationMail.text,
    });
    if (!deliveryResult.ok) {
      logRegistrationRateLimit(deliveryResult.reason, {
        ip: clientIp,
        email,
        provider: "resend",
      });
      try {
        const authSupabase = createSupabaseAuthClient({ requestHeaders: request.headers });
        const { error: resendError } = await authSupabase.auth.resend({
          type: "signup",
          email,
          options: {
            emailRedirectTo: getSupabaseEmailRedirectUrl(locale),
          },
        });
        if (resendError) {
          logRegistrationRateLimit("provider_resend_failed", {
            ip: clientIp,
            email,
            provider: "supabase",
          });
        }
      } catch {
        logRegistrationRateLimit("provider_resend_unavailable", {
          ip: clientIp,
          email,
          provider: "supabase",
        });
      }
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
