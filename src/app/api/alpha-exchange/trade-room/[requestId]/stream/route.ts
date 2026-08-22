import { NextRequest } from "next/server";
import { getTradeRoomData } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";
import { allowsRuntimeDiagnostics } from "@/lib/runtime-safety";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEBUG = allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
// The in-process event bus supplies the same-instance hot path. This existing
// SSE snapshot stream also reconciles the durable canonical state often enough
// for a participant connected through another server instance to see a chat
// message or Poke promptly, without adding another client realtime system.
const CROSS_INSTANCE_RECONCILIATION_MS = 5_000;

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
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;
  const { requestId } = await context.params;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let snapshotInFlight = false;
      let snapshotQueued = false;
      let unsubscribe: (() => void) | null = null;
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
        unsubscribe?.();
        unsubscribe = null;
        try {
          controller.close();
        } catch {
          // Stream can already be closed by the runtime when abort races with send.
        }
      };
      const enqueueSafe = (payload: string) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(payload));
          return true;
        } catch {
          cleanup();
          return false;
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
            // Local realtime events already update the writer's cache. The
            // periodic SSE reconciliation must bypass that per-instance cache
            // so another server instance observes the durable message/Poke.
            strongConsistency: trigger !== "event",
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
      unsubscribe = subscribeRealtimeEvents((event) => {
        if (closed) return;
        if (!isRelevantTradeRoomEvent(event, requestId)) return;
        const publishedAt = event.type === "trade.status_changed" ? event.payload.publishedAtEpochMs : undefined;
        void sendSnapshot("event", publishedAt);
      });

      keepAlive = setInterval(() => {
        if (!enqueueSafe(": keepalive\n\n")) return;
        void sendSnapshot("keepalive");
      }, CROSS_INSTANCE_RECONCILIATION_MS);

      const signal = request.signal;
      if (signal.aborted) {
        cleanup();
        return;
      }

      signal.addEventListener("abort", () => {
        cleanup();
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
