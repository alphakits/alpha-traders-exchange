import { NextRequest, NextResponse } from "next/server";
import { updatePurchaseRequestStatus } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

function isValidRequestStatus(value: string): value is "pending" | "accepted" | "payment_sent" | "funds_received" | "usdt_release_pending" | "usdt_sent" | "completed" | "declined" | "cancelled" {
  return value === "pending" || value === "accepted" || value === "payment_sent" || value === "funds_received" || value === "usdt_release_pending" || value === "usdt_sent" || value === "completed" || value === "declined" || value === "cancelled";
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) return phoneVerificationRequired;
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:purchase-request-status",
    maxRequests: 40,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many status updates. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const debug = process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
    const startedAt = Date.now();
    const { requestId } = await context.params;
    const body = await request.json();
    const status = String(body.status ?? "").trim();
    const safetyAcknowledged = body.safetyAcknowledged === true;
    const isUsdtSent = status === "usdt_sent";
    const traceId = debug && isUsdtSent ? `usdt-sent:${requestId}:${Date.now()}` : undefined;
    console.log("[trade-consistency] PATCH received", {
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      nextStatus: status,
      safetyAcknowledged,
    });
    if (debug && isUsdtSent) {
      console.log("[usdt-sent-trace] route entry", { traceId, requestId, actorUserId: user.id });
    }
    if (!status) {
      return NextResponse.json({ error: "Status is required." }, { status: 400 });
    }
    if (!isValidRequestStatus(status)) {
      return NextResponse.json({ error: "Invalid purchase request status." }, { status: 400 });
    }
    if (debug) {
      console.log("[trade-room-action] request", {
        requestId,
        actorUserId: user.id,
        actorRole: user.role,
        payload: { status, safetyAcknowledged },
      });
    }

    const { request: updated, metrics } = await updatePurchaseRequestStatus({
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      nextStatus: status,
      safetyAcknowledged,
      traceId: isUsdtSent ? traceId : undefined,
    });
    if (debug && isUsdtSent) {
      console.log("[usdt-sent-trace] before response", { traceId, requestId, updatedStatus: updated.status });
    }
    const routeMs = Date.now() - startedAt;
    const responseBody = { request: updated, metrics };
    // Always log server-side timings so production performance is visible in Vercel logs.
    console.log("[trade-room-perf] server timings", {
      requestId,
      actorUserId: user.id,
      nextStatus: status,
      stateAfter: updated.status,
      "queueMs (route arrival → store entry)": metrics.readDbMs > 0 ? routeMs - metrics.totalMs : null,
      "readDbMs": metrics.readDbMs,
      "writeDbMs": metrics.writeDbMs,
      "trustMs": metrics.trustMs,
      "totalDbMs": metrics.totalMs,
      "routeMs (arrival → response)": routeMs,
    });
    return NextResponse.json(responseBody, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Db-Ms": String(metrics.totalMs),
        "X-Trade-Read-Ms": String(metrics.readDbMs),
        "X-Trade-Write-Ms": String(metrics.writeDbMs),
        "X-Trade-Trust-Ms": String(metrics.trustMs),
        "Server-Timing": `route;dur=${routeMs}, db;dur=${metrics.totalMs}, read;dur=${metrics.readDbMs}, write;dur=${metrics.writeDbMs}, trust;dur=${metrics.trustMs}`,
      },
    });
  } catch (error) {
    const debug = process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
    const { requestId } = await context.params;
    const message = error instanceof Error ? error.message : "Failed to update request.";
    console.error("[trade-room-action] mutation failed", {
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (debug) {
      console.log("[trade-room-action] response", {
        requestId,
        actorUserId: user.id,
        responseStatus: 400,
        responseBody: { error: message },
      });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
