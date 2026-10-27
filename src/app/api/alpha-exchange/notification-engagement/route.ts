import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { browserPushConfiguration } from "@/lib/browser-push";
import { claimNotificationReminder, snoozeNotificationReminder } from "@/lib/notification-engagement";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const config = browserPushConfiguration();
  return NextResponse.json({
    userId: user.id,
    preferences: { inApp: user.notificationPreferences?.inApp !== false, email: user.notificationPreferences?.email === true, browserPush: user.notificationPreferences?.browserPush === true },
    emailVerified: user.emailVerified === true,
    browserPush: { available: Boolean(config), publicKey: config?.publicKey ?? null },
  }, { headers });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== request.nextUrl.origin)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  }
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "notification-reminder", identifier: user.id, maxRequests: 20, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  const body = await request.json().catch(() => null);
  if (body?.expectedUserId !== undefined && body.expectedUserId !== user.id) {
    return NextResponse.json({ error: "Account changed. Please retry." }, { status: 409, headers });
  }
  if (!body || !["claim", "snooze"].includes(body.action) || (body.needsPush !== undefined && typeof body.needsPush !== "boolean")) {
    return NextResponse.json({ error: "Invalid reminder request." }, { status: 400, headers });
  }
  try {
    if (body.action === "snooze") {
      await snoozeNotificationReminder(user.id);
      return NextResponse.json({ snoozed: true }, { headers });
    }
    const missing = user.notificationPreferences?.inApp === false
      || user.notificationPreferences?.email !== true || user.emailVerified !== true || body.needsPush === true;
    return NextResponse.json({ show: missing && await claimNotificationReminder(user.id) }, { headers });
  } catch {
    return NextResponse.json({ error: "Reminders temporarily unavailable." }, { status: 503, headers });
  }
}
