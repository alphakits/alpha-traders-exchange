import { PrivateContactError } from "@/lib/buyer-contact";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";
import { after, NextRequest, NextResponse } from "next/server";
import { createPurchaseRequest, getMyPurchaseRequests, sanitizePurchaseRequestForActor, TradeBlockedError } from "@/lib/alpha-exchange-store";
import { DemandError, parseDemandMatchBinding } from "@/lib/usdt-demand-policy";
import { commissionPaymentDestination } from "@/lib/commission-payment-destination";
import { getWalletAddressValidationError } from "@/lib/wallet-address";
import { requireApiUser, requireMarketplaceVerificationForTrading } from "@/lib/api-auth";
import { hasRole } from "@/lib/roles";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import { prepareTradeEventEmails } from "@/lib/marketplace-email-events";
import { tradeDestination } from "@/lib/action-destinations";

// These are deliberately fixed messages for typed canonical trade blockers.
// Do not expose arbitrary error.details or storage/driver exception text.
const demandTradeBlockMessages: Record<string, string> = {
  AWAITING_BUYER_CONFIRMATION: "Your previous trade is waiting for the seller to complete it. Open the Trade Room to continue.",
  ACTIVE_TRADE_EXISTS: "Complete or cancel your current trade before starting another purchase.",
  PURCHASE_REQUEST_ALREADY_SUBMITTED: "Continue this purchase in the existing Trade Room.",
  PENDING_BUYER_FEEDBACK: "Complete your previous trade feedback before starting a new purchase.",
  SELLER_COMMISSION_DUE: "Pay your pending seller commission before starting another purchase.",
  USER_INTERACTION_BLOCKED: "A user block prevents this new trade.",
  LISTING_SELLER_LOCKED: "This seller is temporarily unavailable for new purchases.",
  LISTING_BANK_ACCOUNT_UNAVAILABLE: "This listing no longer has a valid payout account. Choose another listing.",
  LISTING_CHANGED: "This listing changed. Refresh the request and review the latest terms.",
  LISTING_AMOUNT_CHANGED: "The available amount or trade limits changed. Refresh the request and review the latest terms.",
  LISTING_UNAVAILABLE: "This listing is no longer available for a new buyer.",
  SELLER_TRADE_LIMIT: "This seller has 3 active trades. Wait for a trade to finish.",
  "listing-amount-unavailable": "This amount is reserved by other active trades. Choose an available amount.",
  "trade-commission-precision": "Trade quantity must produce a positive 1% fee at six-decimal USDT precision and remain within supported amount limits.",
  CARDLESS_BANK_REQUIRED: "Choose the bank that issued your withdrawal code.",
  CARDLESS_PAYMENT_AMOUNT_MISMATCH: "ATM code amount must match the full payment total shown in your review.",
  CARDLESS_DETAILS_REQUIRED: "Enter the withdrawal code, ID number or birth date, and exact ILS withdrawal amount matching this trade.",
};
const demandValidationMessages = new Set([
  "Buyer identity mismatch.", "Listing not found.", "Unsupported receiving network.",
  "Selected payment method is invalid.", "Selected payment method is not available for this listing.",
  "Please acknowledge the Face-to-Face privacy and safety notice before continuing.",
  "Listing is not available for a new buyer right now.", "You cannot submit a purchase request to your own listing.",
  "Seller is currently unavailable for new buyer matches.",
  "Trade amount must be a valid positive USDT amount with no more than six decimal places.",
  "Requested amount exceeds the remaining listing quantity.", "Listing price is invalid.",
  "Trade amount must produce a payment total of at least 0.01 in the listing currency.",
  ...(["TRC20", "BEP20", "ERC20", "SOL"] as const).map(network => getWalletAddressValidationError(network, "invalid")),
]);

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireMarketplaceVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;
  const requests = await getMyPurchaseRequests(user.id, user.role);
  return NextResponse.json({ requests }, {
    status: 200,
    headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" },
  });
}

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  const requestId = crypto.randomUUID();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const withRequestIdHeaders = (headers?: HeadersInit) => ({ "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", ...(headers ?? {}), "X-Request-Id": requestId });
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
  const failed = (error: string, metadata?: Record<string, unknown>, status = 500) => {
    logEvent("error", {
      event: "exchange_purchase_request_create",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: error,
      metadata: { requestId, ...metadata },
    });
    return NextResponse.json({ code: "PURCHASE_REQUEST_FAILED", message: error, details: null, requestId }, { status, headers: withRequestIdHeaders() });
  };
  const verificationRequired = requireMarketplaceVerificationForTrading(user);
  if (verificationRequired) {
    const verification = await verificationRequired.json() as { error: string; code: string };
    return denied(
      verification.error,
      verificationRequired.status,
      verification.code,
      undefined,
      undefined,
      { gate: "requireMarketplaceVerificationForTrading" },
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
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:purchase-request-create:v2",
    identifier: user.id,
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
  let demandOrigin = false;
  try {
    const body = await request.json();
    demandOrigin = Boolean(body && typeof body === "object" && ["usdtDemandId", "usdtDemandOfferId", "usdtDemandRevision"].some(key => Object.hasOwn(body, key)));
    const demandBinding = demandOrigin ? parseDemandMatchBinding(body) : null;
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

    if (body?.feePolicyVersion !== "buyer_seller_1pct_v1") return denied("Refresh and review the 1% buyer fee before confirming your trade.", 409, "FEE_POLICY_REVIEW_REQUIRED");

    const created = await createPurchaseRequest({
      usdtDemandId: demandBinding?.usdtDemandId,
      usdtDemandOfferId: demandBinding?.usdtDemandOfferId,
      usdtDemandRevision: demandBinding?.usdtDemandRevision,
      feePolicyVersion: "buyer_seller_1pct_v1",
      buyerId: user.id,
      listingId,
      usdtAmount,
      buyerName,
      buyerReceivingWalletAddress,
      receivingNetwork: body?.receivingNetwork == null ? undefined : String(body.receivingNetwork),
      cardlessWithdrawalCode: String(body?.cardlessWithdrawalCode ?? ""),
      cardlessVerificationKind: String(body?.cardlessVerificationKind ?? ""),
      cardlessVerificationValue: String(body?.cardlessVerificationValue ?? ""),
      cardlessIlsAmount: String(body?.cardlessIlsAmount ?? ""),
      paymentMethod: paymentMethod || undefined,
      bankName: bankName || undefined,
      safetyAcknowledged,
      priceMode: rawPriceMode,
      offeredPrice,
      actorUserId: user.id,
    });
    const { request: purchase, metrics } = created;
    const responsePurchase = sanitizePurchaseRequestForActor(purchase, user.id, user.role);
    if (!created.replayed) after(async () => {
      try {
        const deliverTradeEmails = await prepareTradeEventEmails({ event: "new_buy_request", request: purchase });
        await deliverTradeEmails();
      } catch (emailScheduleError) {
        // Recipient lookup and provider delivery are strictly post-response.
        // A slow email system can never delay or roll back a durable request.
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
    });
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
      { purchase: responsePurchase, requestId, metrics, destination: tradeDestination(responsePurchase, user.id) },
      {
        status: 201,
        headers: withRequestIdHeaders({
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
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
    if (error instanceof PrivateContactError) {
      const message = resolveSupportedRequestLocale(request.headers, "en") === "ar"
        ? "أضف رقم هاتف أو واتساب صالحًا في ملفك الشخصي حتى يتمكن المالك من التواصل معك عند الحاجة. الرقم خاص بك وبالمالك فقط."
        : error.message;
      return denied(message, 400, error.code);
    }
    if (demandOrigin) {
      if (error instanceof DemandError) return denied(error.message, 400, error.code);
      if (error instanceof TradeBlockedError && Object.hasOwn(demandTradeBlockMessages, error.code)) {
        const details: Record<string, unknown> = { errorName: "TradeBlockedError" };
        const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
        if (safeId(error.purchaseRequestId)) details.purchaseRequestId = error.purchaseRequestId;
        if (error.code === "SELLER_COMMISSION_DUE" && safeId(error.details?.commissionId)) {
          details.commissionId = error.details.commissionId;
          details.actionHref = commissionPaymentDestination(error.details.commissionId);
        }
        return denied(demandTradeBlockMessages[error.code], 400, error.code, undefined, undefined, details);
      }
      if (error instanceof Error && (demandValidationMessages.has(error.message)
        || /^(Minimum|Maximum) trade for this listing is \d{1,12}(?:\.\d{1,6})? USDT\.$/.test(error.message))) {
        return denied(error.message, 400, "PURCHASE_REQUEST_VALIDATION_FAILED");
      }
      return failed("The trade could not be opened. Refresh the request and try again.", { demandOrigin: true }, 503);
    }
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
