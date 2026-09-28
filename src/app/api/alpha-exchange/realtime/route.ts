import { NextRequest, NextResponse } from "next/server";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { subscribeRealtimeEvents, type RealtimeEvent } from "@/lib/realtime";
import { realtimeEventForUser } from "@/lib/realtime-event-visibility";
import { SSE_RECONNECT_FRAME, SSE_ROTATION_INTERVAL_MS } from "@/lib/sse-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

  const encoder = new TextEncoder();
  let cancelStream = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let rotation: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        if (rotation) clearTimeout(rotation);
        request.signal.removeEventListener("abort", cleanup);
        unsubscribe();
        try { controller.close(); } catch { /* The consumer may already have closed. */ }
      };
      cancelStream = cleanup;
      const enqueueSafe = (payload: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(payload)); } catch { cleanup(); }
      };
      const send = (event: RealtimeEvent) => {
        if (closed) return;
        const visibleEvent = realtimeEventForUser(event, user);
        if (!visibleEvent) return;
        enqueueSafe(`event: message\ndata: ${JSON.stringify(visibleEvent)}\n\n`);
      };
      unsubscribe = subscribeRealtimeEvents(send);
      keepAlive = setInterval(() => {
        enqueueSafe(": keepalive\n\n");
      }, 15000);
      rotation = setTimeout(() => {
        enqueueSafe(SSE_RECONNECT_FRAME);
        cleanup();
      }, SSE_ROTATION_INTERVAL_MS);

      const signal = request.signal;
      if (signal.aborted) {
        cleanup();
        return;
      }

      signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() { cancelStream(); },
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
