import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { sanitizePurchaseRequestForActor, TradeBlockedError, updatePurchaseRequestStatus } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { prepareTradeEventEmails, tradeEmailEventForStatus } from "@/lib/marketplace-email-events";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

function isValidRequestStatus(value: string): value is "pending" | "accepted" | "payment_sent" | "funds_received" | "usdt_release_pending" | "usdt_sent" | "completed" | "declined" | "cancelled" {
  return value === "pending" || value === "accepted" || value === "payment_sent" || value === "funds_received" || value === "usdt_release_pending" || value === "usdt_sent" || value === "completed" || value === "declined" || value === "cancelled";
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const routeDebug = process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
  const diagId = `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (routeDebug) {
    console.log("[patch-diag] stage=entry", { diagId, method: request.method, url: request.url });
  }

  const { user, unauthorized } = await requireApiUser();
  if (routeDebug) {
    console.log("[patch-diag] stage=auth", { diagId, authenticated: Boolean(user), userId: user?.id });
  }
  if (!user) return unauthorized;

  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (routeDebug) {
    console.log("[patch-diag] stage=phone-verification", { diagId, phoneBlocked: Boolean(phoneVerificationRequired) });
  }
  if (phoneVerificationRequired) return phoneVerificationRequired;

  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:purchase-request-status",
    maxRequests: 40,
    windowMs: 60_000,
  });
  if (routeDebug) {
    console.log("[patch-diag] stage=rate-limit", { diagId, allowed: rate.allowed });
  }
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many status updates. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const debug = routeDebug;
    const startedAt = Date.now();
    const { requestId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseErr) {
      if (routeDebug) {
        console.error("[patch-diag] stage=body-parse-failed", { diagId, requestId, error: String(parseErr) });
      }
      return NextResponse.json({ error: "Invalid request body.", stage: "body-parse", code: "invalid-body", diagId }, { status: 400 });
    }
    const rawBody = body as Record<string, unknown>;
    const status = String(rawBody.status ?? "").trim();
    const safetyAcknowledged = rawBody.safetyAcknowledged === true;
    if (routeDebug) {
      console.log("[patch-diag] stage=body-parsed", { diagId, requestId, receivedStatus: rawBody.status, parsedStatus: status, safetyAcknowledged });
    }
    const isUsdtSent = status === "usdt_sent";
    const traceId = debug && isUsdtSent ? `usdt-sent:${requestId}:${Date.now()}` : undefined;
    if (routeDebug) {
      console.log("[trade-consistency] PATCH received", {
        requestId,
        actorUserId: user.id,
        actorRole: user.role,
        nextStatus: status,
        safetyAcknowledged,
      });
    }
    if (debug && isUsdtSent) {
      console.log("[usdt-sent-trace] route entry", { traceId, requestId, actorUserId: user.id });
    }
    if (!status) {
      if (routeDebug) {
        console.warn("[patch-diag] stage=early-return status-empty", { diagId, requestId, rawStatus: rawBody.status });
      }
      return NextResponse.json({ error: "Status is required.", stage: "status-empty", code: "status-required", diagId }, { status: 400 });
    }
    if (!isValidRequestStatus(status)) {
      if (routeDebug) {
        console.warn("[patch-diag] stage=early-return status-invalid", { diagId, requestId, status });
      }
      return NextResponse.json({ error: "Invalid purchase request status.", stage: "status-invalid", code: "invalid-status", receivedStatus: status, diagId }, { status: 400 });
    }
    if (routeDebug) {
      console.log("[patch-diag] stage=calling-store", { diagId, requestId, status, actorUserId: user.id, actorRole: user.role });
    }
    if (debug) {
      console.log("[trade-room-action] request", {
        requestId,
        actorUserId: user.id,
        actorRole: user.role,
        payload: { status, safetyAcknowledged },
      });
    }

    const { request: updated, metrics, deferredTrustWrite, additionallyDeclinedRequests = [], statusChanged = false } = await updatePurchaseRequestStatus({
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      nextStatus: status,
      safetyAcknowledged,
      traceId: isUsdtSent ? traceId : undefined,
    });
    if (deferredTrustWrite) {
      after(async () => {
        try {
          await deferredTrustWrite();
        } catch (err: unknown) {
          console.error("[trade-trust-deferred] write failed", {
            requestId,
            actorUserId: user.id,
            nextStatus: status,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }
    // Only fire lifecycle emails when an actual state transition occurred. Idempotent
    // no-op updates (e.g. a retried/duplicated "completed" PATCH when the trade is already
    // review_open/completed/locked) return statusChanged=false and must NOT re-send emails.
    const emailEvent = statusChanged ? tradeEmailEventForStatus(status) : null;
    if (emailEvent || additionallyDeclinedRequests.length > 0) {
      const deliveries = await Promise.all([
        ...additionallyDeclinedRequests.map((declinedRequest) =>
          prepareTradeEventEmails({ event: "trade_rejected", request: declinedRequest }),
        ),
        ...(emailEvent ? [prepareTradeEventEmails({ event: emailEvent, request: updated })] : []),
      ]);
      after(() => Promise.all(deliveries.map((deliverEmails) => deliverEmails())));
    }
    if (routeDebug) {
      console.log("[patch-diag] stage=store-returned", { diagId, requestId, resultStatus: updated.status });
    }
    if (debug && isUsdtSent) {
      console.log("[usdt-sent-trace] before response", { traceId, requestId, updatedStatus: updated.status });
    }
    const routeMs = Date.now() - startedAt;
    const responseBody = { request: sanitizePurchaseRequestForActor(updated, user.id, user.role), metrics };
    const queueMs = Math.max(0, routeMs - metrics.totalMs);
    // Always log server-side timings so production performance is visible in Vercel logs.
    if (routeDebug) {
      console.log("[trade-room-perf] server timings", {
        requestId,
        actorUserId: user.id,
        nextStatus: status,
        stateAfter: updated.status,
        "queueMs (route arrival → store entry)": queueMs,
        "readDbMs": metrics.readDbMs,
        "timelineMs": metrics.timelineMs,
        "chatMs": metrics.chatMs,
        "notificationMs": metrics.notificationMs,
        "sseMs": metrics.sseMs,
        "writeDbMs": metrics.writeDbMs,
        "trustMs": metrics.trustMs,
        "totalDbMs": metrics.totalMs,
        "routeMs (arrival → response)": routeMs,
      });
    }
    return NextResponse.json(responseBody, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Queue-Ms": String(queueMs),
        "X-Trade-Db-Ms": String(metrics.totalMs),
        "X-Trade-Read-Ms": String(metrics.readDbMs),
        "X-Trade-Timeline-Ms": String(metrics.timelineMs ?? 0),
        "X-Trade-Chat-Ms": String(metrics.chatMs ?? 0),
        "X-Trade-Notification-Ms": String(metrics.notificationMs ?? 0),
        "X-Trade-Sse-Ms": String(metrics.sseMs ?? 0),
        "X-Trade-Write-Ms": String(metrics.writeDbMs),
        "X-Trade-Trust-Ms": String(metrics.trustMs),
        "Server-Timing": `route;dur=${routeMs}, queue;dur=${queueMs}, db;dur=${metrics.totalMs}, read;dur=${metrics.readDbMs}, timeline;dur=${metrics.timelineMs ?? 0}, chat;dur=${metrics.chatMs ?? 0}, notify;dur=${metrics.notificationMs ?? 0}, sse;dur=${metrics.sseMs ?? 0}, write;dur=${metrics.writeDbMs}, trust;dur=${metrics.trustMs}`,
      },
    });
  } catch (error) {
    const debug = process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
    const { requestId } = await context.params;
    const tradeError = error instanceof TradeBlockedError ? error : null;
    const message = error instanceof Error ? error.message : "Failed to update request.";
    const rejection = {
      error: message,
      code: tradeError?.code ?? "trade-status-update-failed",
      requestId: tradeError?.purchaseRequestId ?? requestId,
      details: tradeError?.details,
      stage: "store-threw",
    };
    const responseStatus = tradeError ? 409 : 400;
    console.error("[patch-diag] stage=store-threw", {
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      isTradeBlockedError: Boolean(tradeError),
      code: tradeError?.code,
      message,
      details: tradeError?.details,
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.error("[trade-room-action] mutation failed", {
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      message,
      code: tradeError?.code,
      details: tradeError?.details,
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (debug) {
      console.log("[trade-room-action] response", {
        requestId,
        actorUserId: user.id,
        responseStatus,
        responseBody: rejection,
      });
    }
    return NextResponse.json(rejection, { status: responseStatus });
  }
}
