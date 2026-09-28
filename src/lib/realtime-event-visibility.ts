import {
  sanitizeNotificationForClient,
  sanitizePurchaseRequestForActor,
} from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import type { RealtimeEvent } from "@/lib/realtime";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

type RealtimeViewer = Pick<AlphaExchangeUser, "id" | "role" | "roles" | "sellerStatus">;

function notificationEventForRecipient(event: RealtimeEvent, userId: string): RealtimeEvent | null {
  if (event.type === "notification.deleted") {
    return event.payload.userId === userId ? event : null;
  }
  if (event.type !== "notification.created" && event.type !== "notification.updated") return null;

  const notification = event.payload.notification;
  if (notification.userId !== userId || notification.whatsappChannelOnly === true) return null;
  return {
    ...event,
    payload: { notification: sanitizeNotificationForClient(notification) },
  } as RealtimeEvent;
}

export function realtimeEventForUser(event: RealtimeEvent, user: RealtimeViewer): RealtimeEvent | null {
  if (
    event.type === "notification.created"
    || event.type === "notification.updated"
    || event.type === "notification.deleted"
  ) {
    return notificationEventForRecipient(event, user.id);
  }

  const isAdmin = hasRole(user, "admin") || hasRole(user, "owner");
  if (event.type === "trade.message_created" || event.type === "trade.message_updated") {
    return isAdmin ? event : null;
  }
  if (event.type !== "trade.status_changed" && event.type !== "trade.request_created") {
    return event;
  }

  const tradeRequest = event.payload.request;
  if (!tradeRequest) return isAdmin ? event : null;
  if (!isAdmin && tradeRequest.buyerId !== user.id && tradeRequest.sellerId !== user.id) return null;
  return {
    ...event,
    payload: {
      ...event.payload,
      request: sanitizePurchaseRequestForActor(tradeRequest, user.id, user.role),
    },
  } as RealtimeEvent;
}
