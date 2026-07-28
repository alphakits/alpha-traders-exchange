import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseAuthClient, getSupabaseEmailRedirectUrl, inferLocaleFromRequest } from "@/lib/supabase-auth-provider";

export async function POST(request: NextRequest) {
  const rate = checkRateLimit({
    headers: request.headers,
    key: "auth:reset-request",
    maxRequests: 5,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many reset requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const body = await request.json();
    const email = String(body.email ?? "").trim();
    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400 });
    }

    const locale = inferLocaleFromRequest(request);
    const supabase = createSupabaseAuthClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getSupabaseEmailRedirectUrl(locale),
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      message: "If the account exists, a password reset email has been sent.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to request password reset." }, { status: 400 });
  }
}
