import { NextRequest, NextResponse } from "next/server";
import { createPurchaseRequest, getMyPurchaseRequests } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { hasRole } from "@/lib/roles";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const requests = await getMyPurchaseRequests(user.id, user.role);
  return NextResponse.json({ requests });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const withRequestIdHeaders = (headers?: HeadersInit) => ({ ...(headers ?? {}), "X-Request-Id": requestId });
  const denied = (error: string, status: number, headers?: HeadersInit, metadata?: Record<string, unknown>) => {
    logEvent("warn", {
      event: "exchange_purchase_request_create",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: error,
      metadata: { requestId, ...metadata },
    });
    return NextResponse.json({ error, requestId }, { status, headers: withRequestIdHeaders(headers) });
  };
  const failed = (error: string, metadata?: Record<string, unknown>) => {
    logEvent("error", {
      event: "exchange_purchase_request_create",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error,
      metadata: { requestId, ...metadata },
    });
    return NextResponse.json({ error, requestId }, { status: 500, headers: withRequestIdHeaders() });
  };
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) return phoneVerificationRequired;
  if (!hasRole(user, "buyer") && !hasRole(user, "approved_seller") && !hasRole(user, "admin")) {
    return denied("Buyer verification required.", 403);
  }
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:purchase-request-create",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return denied(
      "Too many requests. Please try again shortly.",
      429,
      { "Retry-After": String(rate.retryAfterSeconds) },
      { retryAfterSeconds: rate.retryAfterSeconds },
    );
  }
  try {
    const body = await request.json();
    const listingId = String(body.listingId ?? "").trim();
    if (!listingId) {
      return denied("Listing ID is required.", 400);
    }

    const buyerName = String(body.buyerName ?? user.fullName).trim();
    const buyerWhatsapp = String(body.buyerWhatsapp ?? user.whatsappNumber).trim();
    if (!buyerName) {
      return denied("Buyer name is required.", 400);
    }
    if (!buyerWhatsapp) {
      return denied("Buyer WhatsApp is required.", 400);
    }

    const buyerNotes = String(body.buyerNotes ?? "").slice(0, 2000);
    const usdtAmount = String(body.usdtAmount ?? "").trim();
    if (!usdtAmount) {
      return denied("Trade amount is required.", 400);
    }
    const bankName = String(body.bankName ?? "").trim();
    const safetyAcknowledged = body.safetyAcknowledged === true;

    const purchase = await createPurchaseRequest({
      buyerId: user.id,
      listingId,
      usdtAmount,
      buyerName,
      buyerWhatsapp,
      buyerNotes,
      bankName: bankName || undefined,
      safetyAcknowledged,
      actorUserId: user.id,
    });
    logEvent("info", {
      event: "exchange_purchase_request_create",
      actorUserId: user.id,
      actorRole: user.role,
      resourceId: purchase.id,
      outcome: "success",
      metadata: { requestId, listingId, paymentMethod: purchase.paymentMethod },
    });
    return NextResponse.json({ purchase, requestId }, { status: 201, headers: withRequestIdHeaders() });
  } catch (error) {
    if (error instanceof Error && error.message.trim()) {
      return denied(error.message, 400, undefined, { errorName: error.name });
    }
    return failed("Failed to submit purchase request.");
  }
}
