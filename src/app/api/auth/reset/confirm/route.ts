import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function isExpiredOrInvalidTokenError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("expired") || normalized.includes("invalid") || normalized.includes("otp");
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit({
    headers: request.headers,
    key: "auth:reset-confirm",
    maxRequests: 8,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again shortly." }, { status: 429, headers: { ...AUTH_RESPONSE_HEADERS, "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const body = await request.json();
    const tokenHash = String(body?.tokenHash ?? body?.token_hash ?? "").trim();
    const tokenType = String(body?.type ?? "recovery").trim().toLowerCase();
    const newPassword = String(body?.password ?? "");
    const confirmPassword = String(body?.confirmPassword ?? "");

    if (!tokenHash) {
      return NextResponse.json({ error: "Invalid reset link. Please request a new password reset email." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!newPassword || !confirmPassword) {
      return NextResponse.json({ error: "Password and confirmation are required." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const supabase = createSupabaseAuthClient();
    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: tokenType === "recovery" ? "recovery" : "recovery",
    });
    if (verifyError) {
      if (isExpiredOrInvalidTokenError(verifyError.message)) {
        return NextResponse.json({ error: "This reset link is invalid or expired. Please request a new one." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
      }
      return NextResponse.json({ error: "Unable to verify reset link. Please try again." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const accessToken = verifyData?.session?.access_token;
    const refreshToken = verifyData?.session?.refresh_token;
    if (!accessToken || !refreshToken) {
      return NextResponse.json({ error: "This reset link is invalid or expired. Please request a new one." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) {
      return NextResponse.json({ error: "Unable to validate reset session. Please request a new reset link." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (updateError) {
      return NextResponse.json({ error: "Unable to update password. Please try again." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    await supabase.auth.signOut();
    return NextResponse.json({ ok: true, message: "Your password has been updated successfully. Please sign in." }, { headers: AUTH_RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reset password." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  }
}
