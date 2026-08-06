import { NextRequest, NextResponse } from "next/server";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { sanitizePurchaseRequestForActor } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function eventForUser(event: RealtimeEvent, user: NonNullable<Awaited<ReturnType<typeof requireApiSellerWorkspaceActor>>["user"]>) {
  if (event.type !== "trade.status_changed" && event.type !== "trade.request_created" && event.type !== "trade.message_created") {
    return event;
  }
  const isAdmin = hasRole(user, "admin") || hasRole(user, "owner");
  if (event.type === "trade.message_created") return isAdmin ? event : null;
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

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RealtimeEvent) => {
        const visibleEvent = eventForUser(event, user);
        if (!visibleEvent) return;
        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(visibleEvent)}\n\n`));
      };
      const unsubscribe = subscribeRealtimeEvents(send);
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);

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

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
