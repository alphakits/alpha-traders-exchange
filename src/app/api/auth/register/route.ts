import { NextRequest, NextResponse } from "next/server";
import { findUserByEmail, upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { createSupabaseAuthClient, getSupabaseEmailRedirectUrl, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";
import { logEvent } from "@/lib/structured-logging";
import { assertNoDirectContactContent } from "@/lib/privacy-redaction";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const REGISTRATION_RESPONSE_FLOOR_MS = 450;

type RegistrationErrorCode =
  | "REGISTRATION_RATE_LIMITED"
  | "REQUIRED_FIELDS"
  | "FIELD_TOO_LONG"
  | "INVALID_EMAIL"
  | "EMAIL_ALREADY_REGISTERED"
  | "TERMS_REQUIRED"
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_MISMATCH"
  | "REGISTRATION_FAILED";

const REGISTRATION_ERROR_COPY: Record<RegistrationErrorCode, { ar: string; en: string }> = {
  REGISTRATION_RATE_LIMITED: {
    ar: "تم تقييد التسجيل مؤقتًا. يُرجى المحاولة مرة أخرى خلال بضع دقائق.",
    en: "Registration is temporarily rate-limited. Please try again in a few minutes.",
  },
  REQUIRED_FIELDS: {
    ar: "الاسم الكامل والبريد الإلكتروني وكلمة المرور مطلوبة.",
    en: "Full name, email, and password are required.",
  },
  FIELD_TOO_LONG: {
    ar: "تجاوز حقل واحد أو أكثر الحد المسموح.",
    en: "One or more fields exceed allowed length.",
  },
  INVALID_EMAIL: {
    ar: "صيغة البريد الإلكتروني غير صحيحة.",
    en: "Invalid email format.",
  },
  EMAIL_ALREADY_REGISTERED: {
    ar: "البريد الإلكتروني مسجل بالفعل.",
    en: "Email already registered.",
  },
  TERMS_REQUIRED: {
    ar: "يجب الموافقة على شروط الخدمة.",
    en: "Terms must be accepted.",
  },
  PASSWORD_TOO_SHORT: {
    ar: "يجب أن تتكوّن كلمة المرور من 8 أحرف على الأقل.",
    en: "Password must be at least 8 characters.",
  },
  PASSWORD_MISMATCH: {
    ar: "كلمتا المرور غير متطابقتين.",
    en: "Passwords do not match.",
  },
  REGISTRATION_FAILED: {
    ar: "تعذر إنشاء الحساب. يُرجى المحاولة مرة أخرى.",
    en: "Registration failed. Please try again.",
  },
};

function registrationErrorResponse(
  locale: "ar" | "en",
  code: RegistrationErrorCode,
  status: number,
  headers: Record<string, string> = AUTH_RESPONSE_HEADERS,
) {
  return NextResponse.json({ code, error: REGISTRATION_ERROR_COPY[code][locale] }, { status, headers });
}

function isDuplicateRegistrationError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("already registered") || normalized.includes("already exists");
}

function registrationSuccessMessage(locale: "ar" | "en") {
  return locale === "ar"
    ? "إذا كان البريد صالحًا للتسجيل، فستصلك رسالة تأكيد. إذا كان لديك حساب بالفعل، فسجّل الدخول أو أعد تعيين كلمة المرور."
    : "If this email can be registered, you will receive a confirmation message. If you already have an account, sign in or reset your password.";
}

async function registrationAcceptedResponse(locale: "ar" | "en", startedAt: number) {
  const remainingDelay = REGISTRATION_RESPONSE_FLOOR_MS - (Date.now() - startedAt);
  if (remainingDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  }
  return NextResponse.json({ ok: true, message: registrationSuccessMessage(locale) }, { headers: AUTH_RESPONSE_HEADERS });
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
    return registrationErrorResponse(locale, "REGISTRATION_RATE_LIMITED", 429, {
      ...AUTH_RESPONSE_HEADERS,
      "Retry-After": String(ipRate.retryAfterSeconds),
    });
  }
  let validRegistrationStartedAt: number | null = null;
  try {
    const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const confirmPassword = String(body.confirmPassword ?? "");
    const whatsappNumber = String(body.whatsappNumber ?? "").trim();
    const agreedToTerms = Boolean(body.agreedToTerms);

    if (!fullName || !email || !password || !confirmPassword) {
      return registrationErrorResponse(locale, "REQUIRED_FIELDS", 400);
    }
    if (fullName.length > 100 || whatsappNumber.length > 30 || email.length > 254) {
      return registrationErrorResponse(locale, "FIELD_TOO_LONG", 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return registrationErrorResponse(locale, "INVALID_EMAIL", 400);
    }
    assertNoDirectContactContent(fullName);

    if (!agreedToTerms) {
      return registrationErrorResponse(locale, "TERMS_REQUIRED", 400);
    }
    if (password.length < 8) {
      return registrationErrorResponse(locale, "PASSWORD_TOO_SHORT", 400);
    }
    if (password !== confirmPassword) {
      return registrationErrorResponse(locale, "PASSWORD_MISMATCH", 400);
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
      return registrationErrorResponse(locale, "REGISTRATION_RATE_LIMITED", 429, {
        ...AUTH_RESPONSE_HEADERS,
        "Retry-After": String(ipEmailRate.retryAfterSeconds),
      });
    }

    validRegistrationStartedAt = Date.now();
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      logRegistrationRateLimit("duplicate_registration", {
        ip: clientIp,
        email,
        provider: "local-profile",
      });
      return registrationAcceptedResponse(locale, validRegistrationStartedAt);
    }

    const supabase = createSupabaseAuthClient({ requestHeaders: request.headers });
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getSupabaseEmailRedirectUrl(locale),
        data: {
          full_name: fullName,
          preferred_locale: locale,
          ...(whatsappNumber ? { whatsapp_number: whatsappNumber } : {}),
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
        return registrationAcceptedResponse(locale, validRegistrationStartedAt);
      }
      logRegistrationRateLimit(
        error.message.toLowerCase().includes("rate limit")
          ? "provider_rate_limit"
          : "provider_signup_failed",
        {
          ip: clientIp,
          email,
          provider: "supabase",
        },
      );
      return registrationAcceptedResponse(locale, validRegistrationStartedAt);
    }
    if (!data.user) {
      return registrationAcceptedResponse(locale, validRegistrationStartedAt);
    }
    if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return registrationAcceptedResponse(locale, validRegistrationStartedAt);
    }

    await upsertUserProfileForAuth({
      fullName,
      email,
      whatsappNumber,
      emailVerified: false,
      preferredLocale: locale,
    });

    return registrationAcceptedResponse(locale, validRegistrationStartedAt);
  } catch {
    // Provider, storage, and validation internals must not leak into the UI.
    if (validRegistrationStartedAt !== null) {
      return registrationAcceptedResponse(locale, validRegistrationStartedAt);
    }
    return registrationErrorResponse(locale, "REGISTRATION_FAILED", 400);
  }
}
