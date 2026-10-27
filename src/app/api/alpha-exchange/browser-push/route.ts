import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getCurrentSessionToken } from "@/lib/auth";
import { updateNotificationPreferences } from "@/lib/alpha-exchange-store";
import { browserPushConfiguration, parseBrowserPushSubscription, removeBrowserPush, saveBrowserPush } from "@/lib/browser-push";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== request.nextUrl.origin)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  }
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "browser-push-registration", identifier: user.id, maxRequests: 12, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  const body = await request.json().catch(() => null);
  if (body?.expectedUserId !== undefined && body.expectedUserId !== user.id) {
    return NextResponse.json({ error: "Account changed. Please retry." }, { status: 409, headers });
  }
  const subscription = parseBrowserPushSubscription(body?.subscription);
  if (!subscription || !["subscribe", "refresh", "unsubscribe"].includes(body?.action) || !["ar", "en"].includes(body?.locale)) {
    return NextResponse.json({ error: "Invalid browser push registration." }, { status: 400, headers });
  }
  try {
    if (body.action === "unsubscribe") {
      await removeBrowserPush(user.id, subscription.endpoint);
      return NextResponse.json({ registered: false }, { headers });
    }
    if (!browserPushConfiguration()) return NextResponse.json({ error: "Browser push is unavailable." }, { status: 503, headers });
    const sessionToken = await getCurrentSessionToken();
    if (!sessionToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
    await saveBrowserPush({ userId: user.id, sessionToken, subscription, locale: body.locale });
    // Background renewal never turns a deliberately disabled preference on.
    if (body.action === "subscribe") await updateNotificationPreferences({ userId: user.id, preferences: { browserPush: true, inApp: true } });
    return NextResponse.json({ registered: true }, { headers });
  } catch {
    return NextResponse.json({ error: "Could not save browser notifications. Please retry." }, { status: 503, headers });
  }
}
