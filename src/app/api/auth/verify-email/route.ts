import { NextRequest, NextResponse } from "next/server";
import { consumeEmailVerificationToken } from "@/lib/alpha-exchange-store";
import { checkRateLimit } from "@/lib/rate-limit";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest) {
  const rate = checkRateLimit({
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
    if (!token || token.length < 32 || token.length > 256) {
      return NextResponse.json({ error: "Invalid verification link." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
    }

    const result = await consumeEmailVerificationToken(token);
    if (result.status === "verified") {
      return NextResponse.json(
        { ok: true, message: "Email verified successfully. You can now sign in." },
        { headers: AUTH_RESPONSE_HEADERS },
      );
    }
    if (result.status === "expired") {
      return NextResponse.json(
        { error: "This verification link has expired. Please request a new verification email." },
        { status: 400, headers: AUTH_RESPONSE_HEADERS },
      );
    }
    return NextResponse.json({ error: "Invalid verification link." }, { status: 400, headers: AUTH_RESPONSE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Verification failed." },
      { status: 400, headers: AUTH_RESPONSE_HEADERS },
    );
  }
}
