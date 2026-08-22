import { NextRequest, NextResponse } from "next/server";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";
import { consumeEmailVerificationToken } from "@/lib/alpha-exchange-store";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest) {
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "auth:verify-email",
    maxRequests: 12,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many verification attempts. Please try again shortly." },
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
        return NextResponse.json({ error: "Invalid verification link." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
      }
      const localResult = await consumeEmailVerificationToken(token);
      if (localResult.status === "verified") {
        return NextResponse.json(
          { ok: true, message: "Email verified successfully. You can now sign in." },
          { headers: AUTH_RESPONSE_HEADERS },
        );
      }
      if (localResult.status === "expired") {
        return NextResponse.json(
          { error: "This verification link has expired. Please request a new verification email." },
          { status: 400, headers: AUTH_RESPONSE_HEADERS },
        );
      }
      return NextResponse.json({ error: "Invalid verification link." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    if (!tokenHash || token) {
      return NextResponse.json({ error: "Invalid verification link." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    const tokenType = String(body?.type ?? "signup").trim().toLowerCase();
    const verificationType = tokenType === "invite" ? "invite" : "signup";
    const supabase = createSupabaseAuthClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: verificationType,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }
    return NextResponse.json(
      { ok: true, message: "Email verified successfully. You can now sign in." },
      { headers: AUTH_RESPONSE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Verification failed." },
      { status: 400, headers: AUTH_RESPONSE_HEADERS },
    );
  }
}
