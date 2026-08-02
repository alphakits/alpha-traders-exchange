import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getNotificationsForUser } from "@/lib/alpha-exchange-store";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isNotificationEventForUser(event: RealtimeEvent, userId: string) {
  if (event.type === "notification.created" || event.type === "notification.updated") {
    return event.payload.notification.userId === userId;
  }
  // Also refresh when the trade status changes — this fires AFTER writeDb, so the
  // notification that was pushed in the same transaction is now persisted and readable.
  if (event.type === "trade.status_changed") {
    const req = event.payload.request;
    return req?.buyerId === userId || req?.sellerId === userId;
  }
  return false;
}

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSignature = "";
      let closed = false;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      const sendSnapshot = async () => {
        if (closed) return;
        try {
          const snapshot = await getNotificationsForUser({
            userId: user.id,
            limit: 20,
            includeActivity: false,
          });
          if (closed) return;
          const top = snapshot.notifications[0];
          const signature = `${snapshot.unreadCount}:${top?.id ?? ""}:${top?.updatedAt ?? top?.createdAt ?? ""}`;
          if (signature === lastSignature) return;
          lastSignature = signature;
          safeEnqueue(`event: notifications\ndata: ${JSON.stringify({ notifications: snapshot.notifications, unreadCount: snapshot.unreadCount })}\n\n`);
        } catch (error) {
          if (closed) return;
          const message = error instanceof Error ? error.message : "notification_stream_failed";
          safeEnqueue(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
        }
      };

      void sendSnapshot();
      const unsubscribe = subscribeRealtimeEvents((event) => {
        if (!isNotificationEventForUser(event, user.id)) return;
        void sendSnapshot();
      });
      const poll = setInterval(() => {
        void sendSnapshot();
      }, 5000);
      const keepAlive = setInterval(() => {
        safeEnqueue(": keepalive\n\n");
      }, 15000);

      const signal = request.signal;
      if (signal.aborted) {
        clearInterval(poll);
        clearInterval(keepAlive);
        unsubscribe();
        closeStream();
        return;
      }

      signal.addEventListener("abort", () => {
        clearInterval(poll);
        clearInterval(keepAlive);
        unsubscribe();
        closeStream();
      }, { once: true });
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
