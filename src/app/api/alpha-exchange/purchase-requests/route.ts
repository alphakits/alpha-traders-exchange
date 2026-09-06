import { after, NextRequest, NextResponse } from "next/server";
import { createPurchaseRequest, getMyPurchaseRequests } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { hasRole } from "@/lib/roles";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import { prepareTradeEventEmails } from "@/lib/marketplace-email-events";
import { tradeDestination } from "@/lib/action-destinations";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;
  const requests = await getMyPurchaseRequests(user.id, user.role);
  return NextResponse.json({ requests }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  const requestId = crypto.randomUUID();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const withRequestIdHeaders = (headers?: HeadersInit) => ({ ...(headers ?? {}), "X-Request-Id": requestId });
  const denied = (
    message: string,
    status: number,
    code: string,
    headers?: HeadersInit,
    metadata?: Record<string, unknown>,
    details?: Record<string, unknown>,
  ) => {
    logEvent("warn", {
      event: "exchange_purchase_request_create",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: message,
      metadata: { requestId, code, ...metadata },
    });
    return NextResponse.json(
      {
        code,
        message,
        details: details ?? null,
        requestId,
      },
      { status, headers: withRequestIdHeaders(headers) },
    );
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
    return NextResponse.json({ code: "PURCHASE_REQUEST_FAILED", message: error, details: null, requestId }, { status: 500, headers: withRequestIdHeaders() });
  };
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) {
    return denied(
      "Email verification is required before marketplace actions.",
      403,
      "EMAIL_VERIFICATION_REQUIRED",
      undefined,
      undefined,
      { gate: "requireEmailVerificationForTrading" },
    );
  }
  if (!hasRole(user, "buyer") && !hasRole(user, "approved_seller") && !hasRole(user, "admin")) {
    return denied(
      "Buyer role required.",
      403,
      "BUYER_ROLE_REQUIRED",
      undefined,
      undefined,
      { role: user.role, sellerStatus: user.sellerStatus },
    );
  }
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "exchange:purchase-request-create",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return denied(
      "Too many requests. Please try again shortly.",
      429,
      "RATE_LIMITED",
      { "Retry-After": String(rate.retryAfterSeconds) },
      { retryAfterSeconds: rate.retryAfterSeconds },
    );
  }
  try {
    const body = await request.json();
    const listingId = String(body.listingId ?? "").trim();
    if (!listingId) {
      return denied("Listing ID is required.", 400, "LISTING_ID_REQUIRED");
    }

    // Trade identity is server-derived. Direct contact fields are neither
    // accepted nor persisted for Buyer ↔ Seller requests.
    const buyerName = user.fullName.trim();
    if (!buyerName) {
      return denied("Buyer name is required.", 400, "BUYER_NAME_REQUIRED");
    }
    const buyerReceivingWalletAddress = String(body.buyerReceivingWalletAddress ?? "").trim();
    if (!buyerReceivingWalletAddress) {
      return denied("Receiving wallet address is required.", 400, "RECEIVING_WALLET_REQUIRED");
    }
    if (buyerReceivingWalletAddress.length > 128) {
      return denied("Receiving wallet address is too long.", 400, "RECEIVING_WALLET_INVALID");
    }
    const usdtAmount = String(body.usdtAmount ?? "").trim();
    const paymentMethod = String(body.paymentMethod ?? "").trim();
    if (!usdtAmount) {
      return denied("Trade amount is required.", 400, "TRADE_AMOUNT_REQUIRED");
    }
    const bankName = String(body.bankName ?? "").trim();
    const safetyAcknowledged = body.safetyAcknowledged === true;
    const rawPriceMode = String(body.priceMode ?? "listing_price").trim();
    if (rawPriceMode !== "listing_price" && rawPriceMode !== "buyer_offer") {
      return denied("Invalid price mode.", 400, "PRICE_MODE_INVALID");
    }
    const offeredPrice = rawPriceMode === "buyer_offer" ? String(body.offeredPrice ?? "").trim() : undefined;

    const created = await createPurchaseRequest({
      buyerId: user.id,
      listingId,
      usdtAmount,
      buyerName,
      buyerReceivingWalletAddress,
      paymentMethod: paymentMethod || undefined,
      bankName: bankName || undefined,
      safetyAcknowledged,
      priceMode: rawPriceMode,
      offeredPrice,
      actorUserId: user.id,
    });
    const { request: purchase, metrics } = created;
    try {
      const deliverTradeEmails = await prepareTradeEventEmails({ event: "new_buy_request", request: purchase });
      after(deliverTradeEmails);
    } catch (emailScheduleError) {
      // The purchase request and in-app notification are already durable. An
      // email preparation failure must never turn that successful commit into
      // a misleading 4xx response that encourages the Buyer to submit again.
      logEvent("error", {
        event: "trade_lifecycle_email_schedule",
        actorUserId: user.id,
        actorRole: user.role,
        resourceId: purchase.id,
        outcome: "failed",
        reason: "new_buy_request_post_commit_schedule_failed",
        metadata: { errorType: emailScheduleError instanceof Error ? emailScheduleError.name : typeof emailScheduleError },
      });
    }
    const routeMs = Date.now() - routeStartedAt;
    const queueMs = Math.max(0, routeMs - metrics.totalMs);
    logEvent("info", {
      event: "exchange_purchase_request_create",
      actorUserId: user.id,
      actorRole: user.role,
      resourceId: purchase.id,
      outcome: "success",
      metadata: { requestId, listingId, paymentMethod: purchase.paymentMethod },
    });
    return NextResponse.json(
      { purchase, requestId, metrics, destination: tradeDestination(purchase, user.id) },
      {
        status: 201,
        headers: withRequestIdHeaders({
          "X-Trade-Route-Ms": String(routeMs),
          "X-Trade-Queue-Ms": String(queueMs),
          "X-Trade-Db-Ms": String(metrics.totalMs),
          "X-Trade-Read-Ms": String(metrics.readDbMs),
          "X-Trade-Validation-Ms": String(metrics.validationMs),
          "X-Trade-Logic-Ms": String(metrics.businessMs),
          "X-Trade-Write-Ms": String(metrics.writeDbMs),
          "X-Trade-Sse-Ms": String(metrics.sseMs),
          "Server-Timing": `route;dur=${routeMs}, queue;dur=${queueMs}, db;dur=${metrics.totalMs}, read;dur=${metrics.readDbMs}, validate;dur=${metrics.validationMs}, logic;dur=${metrics.businessMs}, write;dur=${metrics.writeDbMs}, sse;dur=${metrics.sseMs}`,
        }),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.message.trim()) {
      const blocked = error as Error & { code?: string; purchaseRequestId?: string; details?: Record<string, unknown> };
      const code = blocked.code ?? "PURCHASE_REQUEST_VALIDATION_FAILED";
      const details: Record<string, unknown> = { ...(blocked.details ?? {}), errorName: error.name };
      if (blocked.purchaseRequestId) details.purchaseRequestId = blocked.purchaseRequestId;
      return denied(error.message, 400, code, undefined, undefined, details);
    }
    return failed("Failed to submit purchase request.");
  }
}
