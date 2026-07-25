import { NextRequest, NextResponse } from "next/server";
import { createEmailVerificationTokenForEmail } from "@/lib/alpha-exchange-store";
import { sendVerificationEmail } from "@/lib/auth-email";
import { checkRateLimit } from "@/lib/rate-limit";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: NextRequest) {
  console.info("[api/auth/verify-email/resend] request received");
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
    console.info("[api/auth/verify-email/resend] payload parsed", {
      hasEmail: Boolean(email),
      email,
    });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.info("[api/auth/verify-email/resend] invalid email payload");
      return NextResponse.json(
        { message: "If your account exists and is not verified, a new verification email has been sent." },
        { headers: AUTH_RESPONSE_HEADERS },
      );
    }

    const issued = await createEmailVerificationTokenForEmail(email);
    console.info("[api/auth/verify-email/resend] token issuance result", {
      foundUser: Boolean(issued),
      skipped: issued && "skipped" in issued ? issued.skipped : null,
      hasToken: Boolean(issued && "token" in issued && issued.token),
    });
    if (issued && issued.skipped !== "already_verified" && issued.token) {
      try {
        await sendVerificationEmail({
          to: issued.user.email,
          fullName: issued.user.fullName,
          token: issued.token,
        });
        console.info("[api/auth/verify-email/resend] verification email sent");
      } catch (error) {
        console.error("[auth/verify-email/resend] Failed to send verification email:", error);
        return NextResponse.json(
          { error: "Failed to send verification email. Please try again shortly." },
          { status: 502, headers: AUTH_RESPONSE_HEADERS },
        );
      }
    }

    return NextResponse.json(
      { message: "If your account exists and is not verified, a new verification email has been sent." },
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
