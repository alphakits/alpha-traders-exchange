import { NextRequest, NextResponse } from "next/server";
import { checkSharedRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { getSiteUrl } from "@/lib/site-url";
import { createSupabaseAdminClient, createSupabaseAuthClient, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";
import { buildAuthEmail, sendAuthEmailViaResend } from "@/lib/auth-email-delivery";

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

function logResetRequest(reason: string, details: Record<string, string | number | boolean | null>) {
  if (process.env.NODE_ENV === "test") return;
  console.warn("[auth/reset/request]", { reason, ...details });
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
      return NextResponse.json(
        { ok: true, message: resetGenericMessage(locale) },
        { headers: AUTH_RESPONSE_HEADERS },
      );
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
      return NextResponse.json(
        { ok: true, message: resetGenericMessage(locale) },
        { headers: AUTH_RESPONSE_HEADERS },
      );
    }

    const redirectTo = `${getSiteUrl()}/${locale}/reset-password`;
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

    const reason = isAuthRateLimitError(error.message) ? "provider_rate_limit" : "provider_error";
    logResetRequest(reason, {
      ip: clientIp,
      email,
      provider: "supabase",
    });

    let linkResult: {
      data?: { properties?: { action_link?: string | null } | null } | null;
      error?: { message?: string } | null;
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
      return NextResponse.json(
        { ok: true, message: resetGenericMessage(locale) },
        { headers: AUTH_RESPONSE_HEADERS },
      );
    }

    if (!linkResult || linkResult.error) {
      logResetRequest("provider_generate_link_failed", {
        ip: clientIp,
        email,
        provider: "supabase_admin",
      });
      return NextResponse.json(
        { ok: true, message: resetGenericMessage(locale) },
        { headers: AUTH_RESPONSE_HEADERS },
      );
    }

    const actionLink = linkResult.data?.properties?.action_link;
    if (typeof actionLink !== "string" || !actionLink.startsWith("http")) {
      logResetRequest("provider_generate_link_missing", {
        ip: clientIp,
        email,
        provider: "supabase_admin",
      });
      return NextResponse.json(
        { ok: true, message: resetGenericMessage(locale) },
        { headers: AUTH_RESPONSE_HEADERS },
      );
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
      return NextResponse.json(
        { ok: true, message: resetGenericMessage(locale) },
        { headers: AUTH_RESPONSE_HEADERS },
      );
    }

    logResetRequest("fallback_email_sent", {
      ip: clientIp,
      email,
      provider: "resend",
    });
    return NextResponse.json({ ok: true, message: resetGenericMessage(locale) }, { headers: AUTH_RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to request password reset." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  }
}
