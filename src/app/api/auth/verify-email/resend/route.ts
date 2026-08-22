import { NextRequest, NextResponse } from "next/server";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient, getSupabaseEmailRedirectUrl, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";
import { logEvent } from "@/lib/structured-logging";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function verificationGenericMessage(locale: "ar" | "en") {
  return locale === "ar"
    ? "إذا كان الحساب موجودًا وغير موثق، فسنرسل رسالة تحقق جديدة."
    : "If the account exists and is unverified, a new verification email has been sent.";
}

function verificationDeliveryFailedMessage(locale: "ar" | "en") {
  return locale === "ar"
    ? "تعذر إرسال رسالة التحقق الآن. يُرجى المحاولة مرة أخرى بعد قليل."
    : "We could not send a verification email right now. Please try again shortly.";
}

export async function POST(request: NextRequest) {
  const rate = await checkSharedRateLimit({
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
    const supabase = createSupabaseAuthClient({ requestHeaders: request.headers });
    let resendError: { message?: string } | null = null;
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: getSupabaseEmailRedirectUrl(locale),
        },
      });
      resendError = error;
    } catch (error) {
      resendError = error instanceof Error ? { message: error.message } : { message: "unexpected_resend_error" };
    }

    if (resendError) {
      if (process.env.NODE_ENV !== "test") {
        logEvent("warn", {
          event: "auth_verify_email_resend",
          outcome: "failed",
          reason: "provider_resend_failed",
          metadata: { provider: "supabase" },
        });
      }
      return NextResponse.json(
        { error: verificationDeliveryFailedMessage(locale) },
        { status: 503, headers: AUTH_RESPONSE_HEADERS },
      );
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
