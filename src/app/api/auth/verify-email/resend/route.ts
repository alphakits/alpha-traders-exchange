import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient, getSupabaseEmailRedirectUrl, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

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
    const supabase = createSupabaseAuthClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: getSupabaseEmailRedirectUrl(locale),
      },
    });
    if (error) {
      console.error("[api/auth/verify-email/resend] supabase resend failed", error);
      return NextResponse.json({ error: error.message }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    return NextResponse.json(
      { message: "Verification email sent. Please check your inbox." },
      { headers: AUTH_RESPONSE_HEADERS },
    );
  } catch (error) {
    console.error("[api/auth/verify-email/resend] handler failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process request." },
      { status: 400, headers: AUTH_RESPONSE_HEADERS },
    );
  }
}
