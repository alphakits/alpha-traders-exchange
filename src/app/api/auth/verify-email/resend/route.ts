import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, resolveClientIp } from "@/lib/rate-limit";
import { createSupabaseAdminClient, getSupabaseEmailRedirectUrl, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";
import { buildAuthEmail, sendAuthEmailViaResend } from "@/lib/auth-email-delivery";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function verificationGenericMessage(locale: "ar" | "en") {
  return locale === "ar"
    ? "إذا كان الحساب موجودًا وغير موثق، فسنرسل رسالة تحقق جديدة."
    : "If the account exists and is unverified, a new verification email has been sent.";
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit({
    headers: request.headers,
    key: "auth:verify-email:resend",
    maxRequests: 5,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const body = await request.json();
    const email = String(body?.email ?? "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email is required." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    const locale = inferLocaleFromRequest(request);
    const ip = resolveClientIp(request.headers);
    let linkResult: {
      data?: { properties?: { action_link?: string | null } | null } | null;
      error?: { message?: string } | null;
    } | null = null;
    try {
      const adminSupabase = createSupabaseAdminClient();
      linkResult = await adminSupabase.auth.admin.generateLink({
        type: "invite",
        email,
        options: {
          redirectTo: getSupabaseEmailRedirectUrl(locale),
        },
      });
    } catch {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[auth/verify-email/resend]", { reason: "provider_admin_unavailable", email, ip });
      }
      return NextResponse.json({ message: verificationGenericMessage(locale) }, { headers: AUTH_RESPONSE_HEADERS });
    }

    if (!linkResult || linkResult.error) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[auth/verify-email/resend]", { reason: "provider_generate_link_failed", email, ip });
      }
      return NextResponse.json({ message: verificationGenericMessage(locale) }, { headers: AUTH_RESPONSE_HEADERS });
    }

    const actionLink = linkResult.data?.properties?.action_link;
    if (typeof actionLink === "string" && actionLink.startsWith("http")) {
      const mail = buildAuthEmail("verification", locale, actionLink);
      const result = await sendAuthEmailViaResend({
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      });
      if (!result.ok && process.env.NODE_ENV !== "test") {
        console.warn("[auth/verify-email/resend]", { reason: result.reason, email, ip });
      }
    }

    return NextResponse.json(
      { message: verificationGenericMessage(locale) },
      { headers: AUTH_RESPONSE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process request." },
      { status: 400, headers: AUTH_RESPONSE_HEADERS },
    );
  }
}
