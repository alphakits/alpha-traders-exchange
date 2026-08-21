import { NextRequest } from "next/server";
import { getTradeRoomData } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEBUG = process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";

function isRelevantTradeRoomEvent(event: RealtimeEvent, requestId: string) {
  if (event.type === "trade.status_changed") {
    if (event.payload.requestId === requestId) return true;
    if (event.payload.request?.id === requestId) return true;
    return false;
  }
  if (event.type === "trade.message_created") {
    return event.payload.requestId === requestId;
  }
  return false;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const { requestId } = await context.params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let snapshotInFlight = false;
      let snapshotQueued = false;
      const enqueueSafe = (payload: string) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(payload));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const closeSafe = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Stream can already be closed by the runtime when abort races with send.
        }
      };
      const sendSnapshot = async (trigger: "init" | "event" | "keepalive", publishedAtEpochMs?: number) => {
        if (closed) return;
        if (snapshotInFlight) {
          snapshotQueued = true;
          return;
        }
        snapshotInFlight = true;
        const snapshotStartMs = Date.now();
        try {
          const room = await getTradeRoomData({
            purchaseRequestId: requestId,
            actorUserId: user.id,
            actorRole: user.role,
            markMessagesRead: false,
            strongConsistency: false,
          });
          const snapshotMs = Date.now() - snapshotStartMs;
          const sentAtEpochMs = Date.now();
          const envelope = {
            ...room,
            _timing: {
              trigger,
              publishedAtEpochMs: publishedAtEpochMs ?? null,
              snapshotMs,
              sentAtEpochMs,
              publishToSentMs: publishedAtEpochMs ? sentAtEpochMs - publishedAtEpochMs : null,
            },
          };
          if (DEBUG) {
            console.log("[trade-room-stream] snapshot", {
              requestId,
              trigger,
              snapshotMs,
              publishToSentMs: envelope._timing.publishToSentMs,
            });
          }
          enqueueSafe(`event: trade-room\ndata: ${JSON.stringify(envelope)}\n\n`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "trade_room_stream_failed";
          enqueueSafe(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
        } finally {
          snapshotInFlight = false;
          if (snapshotQueued && !closed) {
            snapshotQueued = false;
            void sendSnapshot("event");
          }
        }
      };

      void sendSnapshot("init");
      const unsubscribe = subscribeRealtimeEvents((event) => {
        if (closed) return;
        if (!isRelevantTradeRoomEvent(event, requestId)) return;
        const publishedAt = event.type === "trade.status_changed" ? event.payload.publishedAtEpochMs : undefined;
        void sendSnapshot("event", publishedAt);
      });

      const keepAlive = setInterval(() => {
        if (!enqueueSafe(": keepalive\n\n")) return;
        void sendSnapshot("keepalive");
      }, 15_000);

      const signal = request.signal;
      if (signal.aborted) {
        clearInterval(keepAlive);
        unsubscribe();
        closeSafe();
        return;
      }

      signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        unsubscribe();
        closeSafe();
      }, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
