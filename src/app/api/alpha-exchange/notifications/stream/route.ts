import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getNotificationsForUser } from "@/lib/alpha-exchange-store";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Trade Room conversation alerts are recipient-critical. Keep the existing
// notification SSE reconciliation responsive across separate server instances
// while the in-process subscription continues to handle the local hot path.
const CROSS_INSTANCE_RECONCILIATION_MS = 5_000;

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
      let snapshotInFlight = false;
      let snapshotQueued = false;
      let unsubscribe: () => void = () => {};
      let poll: ReturnType<typeof setInterval> | null = null;
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        closed = true;
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
        unsubscribe();
      };

      const safeEnqueue = (chunk: string) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          // A runtime may close the stream before its AbortSignal is delivered.
          // Tear down this connection immediately so its reconciliation timers
          // cannot outlive the client.
          cleanup();
          return false;
        }
      };

      const closeStream = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      const sendSnapshot = async () => {
        if (closed) return;
        if (snapshotInFlight) {
          snapshotQueued = true;
          return;
        }
        snapshotInFlight = true;
        try {
          const snapshot = await getNotificationsForUser({
            userId: user.id,
            limit: 20,
            includeActivity: false,
            strongConsistency: true,
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
        } finally {
          snapshotInFlight = false;
          if (snapshotQueued && !closed) {
            snapshotQueued = false;
            void sendSnapshot();
          }
        }
      };

      void sendSnapshot();
      unsubscribe = subscribeRealtimeEvents((event) => {
        if (!isNotificationEventForUser(event, user.id)) return;
        void sendSnapshot();
      });
      // Keep the established SSE snapshot reconciliation path for cases where
      // the local event bus cannot span a server instance or a client reconnects.
      poll = setInterval(() => {
        void sendSnapshot();
      }, CROSS_INSTANCE_RECONCILIATION_MS);
      keepAlive = setInterval(() => {
        safeEnqueue(": keepalive\n\n");
      }, 15000);

      const signal = request.signal;
      if (signal.aborted) {
        closeStream();
        return;
      }

      signal.addEventListener("abort", () => {
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
