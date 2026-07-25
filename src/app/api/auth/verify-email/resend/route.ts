import { NextRequest, NextResponse } from "next/server";
import { createEmailVerificationTokenForEmail } from "@/lib/alpha-exchange-store";
import { sendVerificationEmail } from "@/lib/auth-email";
import { checkRateLimit } from "@/lib/rate-limit";

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
      return NextResponse.json(
        { message: "If your account exists and is not verified, a new verification email has been sent." },
        { headers: AUTH_RESPONSE_HEADERS },
      );
    }

    const issued = await createEmailVerificationTokenForEmail(email);
    if (issued && issued.skipped !== "already_verified" && issued.token) {
      try {
        await sendVerificationEmail({
          to: issued.user.email,
          fullName: issued.user.fullName,
          token: issued.token,
        });
      } catch (error) {
        console.error("[auth/verify-email/resend] Failed to send verification email:", error);
      }
    }

    return NextResponse.json(
      { message: "If your account exists and is not verified, a new verification email has been sent." },
      { headers: AUTH_RESPONSE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process request." },
      { status: 400, headers: AUTH_RESPONSE_HEADERS },
    );
  }
}
