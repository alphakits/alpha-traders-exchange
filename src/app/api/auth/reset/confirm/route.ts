import { NextRequest, NextResponse } from "next/server";
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
    return NextResponse.json(
      { error: "Use the password reset link sent by email to complete password changes." },
      { status: 410 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reset password." }, { status: 400 });
  }
}
