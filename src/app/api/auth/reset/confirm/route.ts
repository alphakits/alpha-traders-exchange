import { NextRequest, NextResponse } from "next/server";
import { consumePasswordResetToken, updateUserPassword } from "@/lib/alpha-exchange-store";
import { hashPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const rate = checkRateLimit({
    headers: request.headers,
    key: "auth:reset-confirm",
    maxRequests: 8,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many reset attempts. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const body = await request.json();
    const token = String(body.token ?? "").trim();
    const password = String(body.password ?? "");
    const confirmPassword = String(body.confirmPassword ?? "");

    if (!token || !password || !confirmPassword) {
      return NextResponse.json({ error: "Token and password fields are required." }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }

    const reset = await consumePasswordResetToken(token);
    if (!reset) {
      return NextResponse.json({ error: "Invalid or expired reset token." }, { status: 400 });
    }

    const nextHash = await hashPassword(password);
    await updateUserPassword(reset.userId, nextHash);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reset password." }, { status: 400 });
  }
}
