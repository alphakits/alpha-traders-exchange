import { NextRequest, NextResponse } from "next/server";
import { updateNotificationPreferences } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { checkRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  return NextResponse.json({
    preferences: {
      inApp: user.notificationPreferences?.inApp !== false,
      email: user.notificationPreferences?.email === true,
      sms: user.notificationPreferences?.sms === true,
      browserPush: user.notificationPreferences?.browserPush === true,
      browserPushTradeUpdates: user.notificationPreferences?.browserPushTradeUpdates !== false,
      browserPushChatMessages: user.notificationPreferences?.browserPushChatMessages !== false,
      browserPushListings: user.notificationPreferences?.browserPushListings !== false,
      browserPushFeedback: user.notificationPreferences?.browserPushFeedback !== false,
      browserPushAdminAlerts: user.notificationPreferences?.browserPushAdminAlerts === true,
    },
    phone: {
      verified: Boolean(user.verifiedPhone && user.phoneVerifiedAt),
      masked: user.verifiedPhone ? `${user.verifiedPhone.slice(0, 3)}•••${user.verifiedPhone.slice(-2)}` : null,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = checkRateLimit({ headers: request.headers, key: "exchange:notification-preferences", maxRequests: 12, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);

  try {
    const body = await request.json();
    if (body.sms === true && (!user.verifiedPhone || !user.phoneVerifiedAt)) {
      return NextResponse.json({ error: "Verify a phone number before enabling SMS notifications." }, { status: 400 });
    }
    const preferences = await updateNotificationPreferences({
      userId: user.id,
      preferences: {
        inApp: typeof body.inApp === "boolean" ? body.inApp : undefined,
        email: typeof body.email === "boolean" ? body.email : undefined,
        sms: typeof body.sms === "boolean" ? body.sms : undefined,
        browserPush: typeof body.browserPush === "boolean" ? body.browserPush : undefined,
        browserPushTradeUpdates: typeof body.browserPushTradeUpdates === "boolean" ? body.browserPushTradeUpdates : undefined,
        browserPushChatMessages: typeof body.browserPushChatMessages === "boolean" ? body.browserPushChatMessages : undefined,
        browserPushListings: typeof body.browserPushListings === "boolean" ? body.browserPushListings : undefined,
        browserPushFeedback: typeof body.browserPushFeedback === "boolean" ? body.browserPushFeedback : undefined,
        browserPushAdminAlerts: typeof body.browserPushAdminAlerts === "boolean" ? body.browserPushAdminAlerts : undefined,
      },
    });
    return NextResponse.json({ preferences });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update notification preferences." }, { status: 400 });
  }
}
