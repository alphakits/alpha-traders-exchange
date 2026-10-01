import { NextRequest, NextResponse } from "next/server";
import { checkSharedRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient, createSupabaseAuthClient, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";
import { buildAuthEmail, sendAuthEmailViaResend } from "@/lib/auth-email-delivery";
import { logEvent } from "@/lib/structured-logging";
import { randomBytes } from "node:crypto";
import { findUserByEmail } from "@/lib/alpha-exchange-store";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function isAuthRateLimitError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("rate limit") || normalized.includes("too many requests");
}

function resetGenericMessage(locale: "ar" | "en") {
  return locale === "ar"
    ? "إذا كان هناك حساب مرتبط بهذا البريد الإلكتروني، فقد أرسلنا تعليمات إعادة تعيين كلمة المرور."
    : "If an account exists for this email, we've sent password reset instructions.";
}

function resetFailureResponse(locale: "ar" | "en", retryAfterSeconds?: number) {
  const rateLimited = retryAfterSeconds !== undefined;
  const error = rateLimited
    ? (locale === "ar" ? "طلبات كثيرة جدًا. يُرجى المحاولة مرة أخرى بعد قليل." : "Too many requests. Please try again shortly.")
    : (locale === "ar" ? "تعذر إرسال رسالة إعادة تعيين كلمة المرور الآن. يُرجى المحاولة مرة أخرى بعد قليل." : "We could not send a password reset email right now. Please try again shortly.");
  return NextResponse.json({ error }, {
    status: rateLimited ? 429 : 503,
    headers: { ...AUTH_RESPONSE_HEADERS, ...(rateLimited ? { "Retry-After": String(retryAfterSeconds) } : {}) },
  });
}

function logResetRequest(reason: string, details: Record<string, string | number | boolean | null>) {
  if (process.env.NODE_ENV === "test") return;
  const { provider, retryAfterSeconds } = details;
  logEvent(reason === "fallback_email_sent" ? "info" : "warn", {
    event: "auth_reset_request",
    outcome: reason === "fallback_email_sent" ? "success" : reason.includes("limit") ? "denied" : "failed",
    reason,
    metadata: {
      provider: typeof provider === "string" ? provider : undefined,
      retryAfterSeconds: typeof retryAfterSeconds === "number" ? retryAfterSeconds : undefined,
    },
  });
}

export async function POST(request: NextRequest) {
  const locale = inferLocaleFromRequest(request);
  const clientIp = resolveClientIp(request.headers);
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const ipRate = await checkSharedRateLimit({
      headers: request.headers,
      key: "auth:reset-request:ip",
      maxRequests: 80,
      windowMs: 10 * 60_000,
    });
    if (!ipRate.allowed) {
      logResetRequest("ip_limit_reached", {
        ip: clientIp,
        retryAfterSeconds: ipRate.retryAfterSeconds,
      });
      return resetFailureResponse(locale, ipRate.retryAfterSeconds);
    }

    const ipEmailRate = await checkSharedRateLimit({
      headers: request.headers,
      key: "auth:reset-request:ip-email",
      identifier: `${clientIp}:${email}`,
      maxRequests: 12,
      windowMs: 10 * 60_000,
    });
    if (!ipEmailRate.allowed) {
      logResetRequest("email_limit_reached", {
        ip: clientIp,
        email,
        retryAfterSeconds: ipEmailRate.retryAfterSeconds,
      });
      return resetFailureResponse(locale, ipEmailRate.retryAfterSeconds);
    }

    const redirectTo = `${getSiteUrl()}/${locale}/reset-password`;
    const localUser = await findUserByEmail(email);
    if (localUser?.passwordHash && localUser.emailVerified === true) {
      // Recover verified legacy accounts that predate provider-backed signup.
      // The random migration password is never exposed or delivered; the user
      // must still prove email ownership through the normal recovery link.
      const admin = createSupabaseAdminClient();
      const existing = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
      if (existing.error) {
        if (existing.error.code !== "user_not_found" && !/user.*not found/i.test(existing.error.message)) {
          return resetFailureResponse(locale);
        }
        const created = await admin.auth.admin.createUser({
          email,
          password: randomBytes(32).toString("base64url"),
          email_confirm: true,
          user_metadata: { full_name: localUser.fullName, preferred_locale: locale },
        });
        if (created.error && created.error.code !== "email_exists" && created.error.code !== "user_already_exists") {
          return resetFailureResponse(locale);
        }
      }
    }
    const supabase = createSupabaseAuthClient({ requestHeaders: request.headers });
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (!error) {
      return NextResponse.json({
        ok: true,
        message: resetGenericMessage(locale),
      }, { headers: AUTH_RESPONSE_HEADERS });
    }
    if (error.code === "user_not_found" || /user.*not found|not.*registered/i.test(error.message)) {
      return NextResponse.json({ ok: true, message: resetGenericMessage(locale) }, { headers: AUTH_RESPONSE_HEADERS });
    }

    const reason = isAuthRateLimitError(error.message) ? "provider_rate_limit" : "provider_error";
    logResetRequest(reason, {
      ip: clientIp,
      email,
      provider: "supabase",
    });

    let linkResult: {
      data?: { properties?: { action_link?: string | null } | null } | null;
      error?: { message?: string; code?: string } | null;
    } | null = null;
    try {
      const adminSupabase = createSupabaseAdminClient();
      linkResult = await adminSupabase.auth.admin.generateLink({
        type: "recovery",
        email,
        options: {
          redirectTo,
        },
      });
    } catch {
      logResetRequest("provider_admin_unavailable", {
        ip: clientIp,
        email,
        provider: "supabase_admin",
      });
      return resetFailureResponse(locale);
    }

    if (!linkResult || linkResult.error) {
      // A missing account still receives the same accepted response as a
      // successful recovery request; infrastructure failures must be visible.
      if (linkResult?.error?.code === "user_not_found"
        || /user.*not found|not.*registered/i.test(linkResult?.error?.message ?? "")) {
        return NextResponse.json({ ok: true, message: resetGenericMessage(locale) }, { headers: AUTH_RESPONSE_HEADERS });
      }
      logResetRequest("provider_generate_link_failed", {
        ip: clientIp,
        email,
        provider: "supabase_admin",
      });
      return resetFailureResponse(locale);
    }

    const actionLink = linkResult.data?.properties?.action_link;
    if (typeof actionLink !== "string" || !actionLink.startsWith("http")) {
      logResetRequest("provider_generate_link_missing", {
        ip: clientIp,
        email,
        provider: "supabase_admin",
      });
      return resetFailureResponse(locale);
    }

    const mail = buildAuthEmail("recovery", locale, actionLink);
    const mailResult = await sendAuthEmailViaResend({
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (!mailResult.ok) {
      logResetRequest(mailResult.reason, {
        ip: clientIp,
        email,
        provider: "resend",
      });
      return resetFailureResponse(locale);
    }

    logResetRequest("fallback_email_sent", {
      ip: clientIp,
      email,
      provider: "resend",
    });
    return NextResponse.json({ ok: true, message: resetGenericMessage(locale) }, { headers: AUTH_RESPONSE_HEADERS });
  } catch {
    return resetFailureResponse(locale);
  }
}
