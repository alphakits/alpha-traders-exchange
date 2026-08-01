import { NextRequest, NextResponse } from "next/server";
import { getFirstActionableTradeForUser, getFirstActiveTradeForUser, resolveTradeRoomRequestForNotification } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const { searchParams } = new URL(request.url);
  const includePending = searchParams.get("includePending") === "1" || searchParams.get("includePending") === "true";
  const sourceNotificationId = String(searchParams.get("notificationId") ?? "").trim() || null;

  if (sourceNotificationId) {
    const resolved = await resolveTradeRoomRequestForNotification({
      userId: user.id,
      role: user.role,
      notificationId: sourceNotificationId,
      includePendingFallback: includePending,
    });
    const resolvedRequestId = resolved.request?.id ?? null;
    const destination = resolvedRequestId ? `/trade-room/${resolvedRequestId}` : null;
    console.log("[trade-room-open] notification resolution", {
      userId: user.id,
      role: user.role,
      notificationId: sourceNotificationId,
      includePending,
      relatedRequestId: resolved.notification?.relatedRequestId ?? null,
      relatedListingId: resolved.notification?.relatedListingId ?? null,
      relatedTradeId: resolved.notification?.relatedTradeId ?? null,
      destination,
      reason: resolved.reason,
      consideredStatuses: resolved.consideredStatuses,
      resolvedStatus: resolved.request?.status ?? null,
      participantTradeStatuses: resolved.participantTradeStatuses ?? [],
    });
    return NextResponse.json({
      activeRequestId: resolvedRequestId,
      destination,
      reason: resolved.reason,
      participantTradeStatuses: resolved.participantTradeStatuses ?? [],
      notification: resolved.notification
        ? {
          id: resolved.notification.id,
          relatedRequestId: resolved.notification.relatedRequestId ?? null,
          relatedListingId: resolved.notification.relatedListingId ?? null,
          relatedTradeId: resolved.notification.relatedTradeId ?? null,
        }
        : null,
    });
  }

  const activeTrade = includePending
    ? await getFirstActionableTradeForUser(user.id, user.role)
    : await getFirstActiveTradeForUser(user.id, user.role);
  console.log("[trade-room-open] active trade lookup", {
    userId: user.id,
    role: user.role,
    includePending,
    activeRequestId: activeTrade?.id ?? null,
    activeStatus: activeTrade?.status ?? null,
  });
  return NextResponse.json({
    activeRequestId: activeTrade?.id ?? null,
    destination: activeTrade?.id ? `/trade-room/${activeTrade.id}` : null,
  });
}
