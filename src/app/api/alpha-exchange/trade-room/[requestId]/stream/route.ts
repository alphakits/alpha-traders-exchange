import { NextRequest } from "next/server";
import { getTradeRoomData, getTradeRoomRevision, type TradeRoomData } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";
import { allowsRuntimeDiagnostics } from "@/lib/runtime-safety";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEBUG = allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
// Same-instance writes arrive immediately through the event bus. A tiny,
// indexed row check covers other server instances within one second; the full
// Trade Room snapshot is fetched only when that exact trade changed.
const CROSS_INSTANCE_REVISION_POLL_MS = 1_000;
const SSE_KEEPALIVE_MS = 15_000;

function revisionKey(room: Pick<TradeRoomData["request"], "id" | "status" | "updatedAt">) {
  return `${room.id}:${room.status}:${room.updatedAt}`;
}

function isRelevantTradeRoomEvent(event: RealtimeEvent, requestId: string) {
  if (event.type === "trade.status_changed") {
    if (event.payload.requestId === requestId) return true;
    if (event.payload.request?.id === requestId) return true;
    return false;
  }
  if (event.type === "trade.message_created" || event.type === "trade.message_updated") {
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

  // Resolve authorization before constructing a 200 SSE response. Previously,
  // an outsider received 200 first and only then saw an error event from inside
  // the stream, which leaked resource existence and started needless timers.
  const initialSnapshotStartedAt = Date.now();
  let initialSnapshot: TradeRoomData;
  try {
    initialSnapshot = await getTradeRoomData({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      actorRole: user.role,
      markMessagesRead: false,
      strongConsistency: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load trade room.";
    const status = message === "Trade not found."
      ? 404
      : message === "You are not allowed to access trade evidence."
        ? 403
        : 400;
    return Response.json(
      {
        error: status === 403 ? "You are not allowed to access this Trade Room." : message,
        code: status === 404 ? "TRADE_NOT_FOUND" : status === 403 ? "TRADE_FORBIDDEN" : "TRADE_ROOM_LOAD_FAILED",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
  const initialSnapshotMs = Date.now() - initialSnapshotStartedAt;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let snapshotInFlight = false;
      let snapshotQueued = false;
      let revisionInFlight = false;
      let unsubscribe: (() => void) | null = null;
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let revisionPoll: ReturnType<typeof setInterval> | null = null;
      let pendingInitialSnapshot: TradeRoomData | null = initialSnapshot;
      let lastKnownRevision = revisionKey(initialSnapshot.request);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
        if (revisionPoll) {
          clearInterval(revisionPoll);
          revisionPoll = null;
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
      const sendSnapshot = async (trigger: "init" | "event" | "reconcile", publishedAtEpochMs?: number) => {
        if (closed) return;
        if (snapshotInFlight) {
          snapshotQueued = true;
          return;
        }
        snapshotInFlight = true;
        const snapshotStartMs = Date.now();
        try {
          const room = trigger === "init" && pendingInitialSnapshot
            ? pendingInitialSnapshot
            : await getTradeRoomData({
                purchaseRequestId: requestId,
                actorUserId: user.id,
                actorRole: user.role,
                markMessagesRead: false,
                // This selects the one-query Trade Room repository path. It is
                // both canonical and cheaper than the old full snapshot read.
                strongConsistency: true,
              });
          const snapshotMs = trigger === "init" && pendingInitialSnapshot
            ? initialSnapshotMs
            : Date.now() - snapshotStartMs;
          pendingInitialSnapshot = null;
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
          lastKnownRevision = revisionKey(room.request);
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
        enqueueSafe(": keepalive\n\n");
      }, SSE_KEEPALIVE_MS);

      revisionPoll = setInterval(() => {
        if (closed || revisionInFlight) return;
        revisionInFlight = true;
        void getTradeRoomRevision({
          purchaseRequestId: requestId,
          actorUserId: user.id,
          actorRole: user.role,
        }).then(async (revision) => {
          const currentRevision = `${revision.id}:${revision.status}:${revision.updatedAt}`;
          if (!closed && currentRevision !== lastKnownRevision) {
            await sendSnapshot("reconcile");
          }
        }).catch((error) => {
          // A transient revision-read failure must not tear down an otherwise
          // healthy stream. The next one-second poll retries automatically.
          if (DEBUG) {
            console.log("[trade-room-stream] revision poll failed", {
              requestId,
              errorName: error instanceof Error ? error.name : "unknown",
            });
          }
        }).finally(() => {
          revisionInFlight = false;
        });
      }, CROSS_INSTANCE_REVISION_POLL_MS);

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
