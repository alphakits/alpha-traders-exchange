import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetToken, findUserByEmail } from "@/lib/alpha-exchange-store";
import { checkRateLimit } from "@/lib/rate-limit";

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

    const user = await findUserByEmail(email);
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    const resetToken = `${randomUUID()}-${randomUUID()}`;
    await createPasswordResetToken(user.id, resetToken);

    if (process.env.NODE_ENV !== "production" && process.env.ALPHA_EXCHANGE_EXPOSE_RESET_TOKEN === "true") {
      return NextResponse.json({ ok: true, resetToken });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create reset token." }, { status: 400 });
  }
}
