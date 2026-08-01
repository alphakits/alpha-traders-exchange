import { NextRequest, NextResponse } from "next/server";
import { getNotificationsForUser, markAllNotificationsRead } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { checkRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import type { NotificationCategory, NotificationState } from "@/types/alpha-exchange";

function isNotificationCategory(value: string): value is NotificationCategory {
  return value === "trade" || value === "listing" || value === "account" || value === "trust" || value === "application" || value === "dispute" || value === "report" || value === "system" || value === "review";
}

function isNotificationState(value: string): value is NotificationState {
  return value === "read" || value === "unread" || value === "archived";
}

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const { searchParams } = new URL(request.url);
  const categoryRaw = String(searchParams.get("category") ?? "").trim();
  const unreadOnlyRaw = String(searchParams.get("unreadOnly") ?? "").trim();
  const limitRaw = String(searchParams.get("limit") ?? "").trim();
  const offsetRaw = String(searchParams.get("offset") ?? "").trim();
  const includeActivityRaw = String(searchParams.get("includeActivity") ?? "").trim();
  const stateRaw = String(searchParams.get("state") ?? "").trim();
  const query = String(searchParams.get("q") ?? "");
  const category = isNotificationCategory(categoryRaw) ? categoryRaw : undefined;
  const unreadOnly = unreadOnlyRaw === "1" || unreadOnlyRaw === "true";
  const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;
  const offset = Number.isFinite(Number(offsetRaw)) ? Number(offsetRaw) : undefined;
  const includeActivity = !(includeActivityRaw === "0" || includeActivityRaw === "false");
  const state = isNotificationState(stateRaw) ? stateRaw : undefined;
  const payload = await getNotificationsForUser({
    userId: user.id,
    category,
    unreadOnly,
    query,
    limit,
    offset,
    includeActivity,
    state,
  });
  return NextResponse.json(payload);
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = checkRateLimit({ headers: request.headers, key: "exchange:notifications-mark-all-read", maxRequests: 12, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);

  try {
    const body = await request.json();
    const action = String(body.action ?? "").trim();
    if (action !== "mark_all_read") {
      return NextResponse.json({ error: "Invalid notification action." }, { status: 400 });
    }
    await markAllNotificationsRead(user.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update notifications." }, { status: 400 });
  }
}
