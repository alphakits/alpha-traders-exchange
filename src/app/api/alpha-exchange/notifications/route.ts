import { NextRequest, NextResponse } from "next/server";
import { getNotificationsForUser, markAllNotificationsRead } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import type { NotificationCategory } from "@/types/alpha-exchange";

function isNotificationCategory(value: string): value is NotificationCategory {
  return value === "trade" || value === "listing" || value === "account" || value === "trust" || value === "application" || value === "dispute" || value === "report" || value === "system";
}

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const { searchParams } = new URL(request.url);
  const categoryRaw = String(searchParams.get("category") ?? "").trim();
  const unreadOnlyRaw = String(searchParams.get("unreadOnly") ?? "").trim();
  const query = String(searchParams.get("q") ?? "");
  const category = isNotificationCategory(categoryRaw) ? categoryRaw : undefined;
  const unreadOnly = unreadOnlyRaw === "1" || unreadOnlyRaw === "true";
  const payload = await getNotificationsForUser({
    userId: user.id,
    category,
    unreadOnly,
    query,
  });
  return NextResponse.json(payload);
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

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
