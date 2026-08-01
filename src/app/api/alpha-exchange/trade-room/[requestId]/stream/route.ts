import { NextRequest } from "next/server";
import { getTradeRoomData } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
      const sendSnapshot = async () => {
        try {
          const room = await getTradeRoomData({
            purchaseRequestId: requestId,
            actorUserId: user.id,
            actorRole: user.role,
            markMessagesRead: false,
          });
          controller.enqueue(encoder.encode(`event: trade-room\ndata: ${JSON.stringify(room)}\n\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : "trade_room_stream_failed";
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`));
        }
      };

      void sendSnapshot();
      const unsubscribe = subscribeRealtimeEvents((event) => {
        if (!isRelevantTradeRoomEvent(event, requestId)) return;
        void sendSnapshot();
      });

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
        void sendSnapshot();
      }, 15_000);

      const signal = request.signal;
      if (signal.aborted) {
        clearInterval(keepAlive);
        unsubscribe();
        controller.close();
        return;
      }

      signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        unsubscribe();
        controller.close();
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
