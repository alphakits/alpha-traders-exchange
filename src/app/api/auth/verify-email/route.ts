import { NextRequest, NextResponse } from "next/server";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";
import { consumeEmailVerificationToken } from "@/lib/alpha-exchange-store";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const VERIFICATION_COPY = {
  ar: {
    rateLimited: "محاولات تحقق كثيرة جدًا. يُرجى المحاولة مرة أخرى بعد قليل.",
    invalid: "رابط التحقق غير صالح.",
    verified: "تم توثيق البريد الإلكتروني بنجاح. يمكنك تسجيل الدخول الآن.",
    expired: "انتهت صلاحية رابط التحقق. يُرجى طلب رسالة تحقق جديدة.",
    failed: "تعذر توثيق البريد الإلكتروني. يُرجى طلب رابط تحقق جديد.",
  },
  en: {
    rateLimited: "Too many verification attempts. Please try again shortly.",
    invalid: "Invalid verification link.",
    verified: "Email verified successfully. You can now sign in.",
    expired: "This verification link has expired. Please request a new verification email.",
    failed: "Email verification failed. Please request a new verification link.",
  },
} as const;

export async function POST(request: NextRequest) {
  const locale = resolveSupportedRequestLocale(request.headers);
  const copy = VERIFICATION_COPY[locale];
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "auth:verify-email",
    maxRequests: 12,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: copy.rateLimited },
      { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const body = await request.json();
    const token = String(body?.token ?? "").trim();
    const tokenHash = String(body?.tokenHash ?? body?.token_hash ?? "").trim();
    // Local-password accounts use an opaque, store-backed raw token. Supabase
    // confirmation links use token_hash exclusively; never send one path's
    // token material to the other provider.
    if (token && !tokenHash) {
      if (token.length < 32 || token.length > 256) {
        return NextResponse.json({ error: copy.invalid }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
      }
      const localResult = await consumeEmailVerificationToken(token);
      if (localResult.status === "verified") {
        return NextResponse.json(
          { ok: true, message: copy.verified },
          { headers: AUTH_RESPONSE_HEADERS },
        );
      }
      if (localResult.status === "expired") {
        return NextResponse.json(
          { error: copy.expired },
          { status: 400, headers: AUTH_RESPONSE_HEADERS },
        );
      }
      return NextResponse.json({ error: copy.invalid }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!tokenHash || token) {
      return NextResponse.json({ error: copy.invalid }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    const tokenType = String(body?.type ?? "signup").trim().toLowerCase();
    const verificationType = tokenType === "invite" ? "invite" : "signup";
    const supabase = createSupabaseAuthClient({ requestHeaders: request.headers });
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: verificationType,
    });
    if (error) {
      return NextResponse.json({ error: copy.failed }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    return NextResponse.json(
      { ok: true, message: copy.verified },
      { headers: AUTH_RESPONSE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: copy.failed },
      { status: 400, headers: AUTH_RESPONSE_HEADERS },
    );
  }
}
