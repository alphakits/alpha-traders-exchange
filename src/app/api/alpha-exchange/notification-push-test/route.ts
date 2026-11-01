import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getCurrentSessionToken } from "@/lib/auth";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import { PushTestError, sendNotificationPushTest } from "@/lib/notification-push-test";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin
      || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  }
  const { user } = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  const rate = await checkSharedRateLimit({
    headers: request.headers, key: "notification-push-test", identifier: user.id,
    maxRequests: 3, windowMs: 5 * 60_000,
  });
  if (!rate.allowed) {
    const response = createRateLimitResponse(rate.retryAfterSeconds);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  if (Number(request.headers.get("content-length") ?? 0) > 1024) {
    return NextResponse.json({ error: "Invalid test request." }, { status: 400, headers });
  }
  const raw = await request.text();
  let body: unknown;
  try { body = raw.length <= 1024 ? JSON.parse(raw) : null; } catch { body = null; }
  if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some(key => key !== "expectedUserId" && key !== "locale")) {
    return NextResponse.json({ error: "Invalid test request." }, { status: 400, headers });
  }
  const input = body as { expectedUserId?: unknown; locale?: unknown };
  if (typeof input.expectedUserId !== "string" || input.expectedUserId !== user.id) {
    return NextResponse.json({ error: "Account changed. Please retry." }, { status: 409, headers });
  }
  if (input.locale !== "en" && input.locale !== "ar") {
    return NextResponse.json({ error: "Invalid test request." }, { status: 400, headers });
  }
  const sessionToken = await getCurrentSessionToken();
  if (!sessionToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  try {
    const result = await sendNotificationPushTest({ userId: user.id, sessionToken, locale: input.locale });
    return NextResponse.json(result, { status: 202, headers });
  } catch (error) {
    if (error instanceof PushTestError && error.code === "session_ended") {
      return NextResponse.json({ error: "Your session ended. Please sign in again." }, { status: 401, headers });
    }
    if (error instanceof PushTestError && error.code === "alerts_disabled") {
      return NextResponse.json({ error: "Enable website alerts before testing." }, { status: 409, headers });
    }
    return NextResponse.json({ error: "Test alert is temporarily unavailable. Please retry." }, { status: 503, headers });
  }
}
