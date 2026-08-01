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
    const { requestId } = await context.params;
    const body = await request.json();
    const status = String(body.status ?? "").trim();
    const traceId = `usdt-sent:${requestId}:${Date.now()}`;
    const isUsdtSent = status === "usdt_sent";
    if (isUsdtSent) {
      console.log("[usdt-sent-trace] route entry", { traceId, requestId, actorUserId: user.id });
    }
    if (!status) {
      return NextResponse.json({ error: "Status is required." }, { status: 400 });
    }
    if (!isValidRequestStatus(status)) {
      return NextResponse.json({ error: "Invalid purchase request status." }, { status: 400 });
    }

    const updated = await updatePurchaseRequestStatus({
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      nextStatus: status,
      traceId: isUsdtSent ? traceId : undefined,
    });
    if (isUsdtSent) {
      console.log("[usdt-sent-trace] before response", { traceId, requestId, updatedStatus: updated.status });
    }
    return NextResponse.json({ request: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update request." }, { status: 400 });
  }
}
