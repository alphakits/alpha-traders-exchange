import { NextRequest, NextResponse } from "next/server";
import { createPurchaseRequest, getMyPurchaseRequests } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { hasRole } from "@/lib/roles";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import { isVerified } from "@/lib/verification-bypass";

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
    if (status === 403) {
      console.error({
        reason: message,
        code,
        status: 403,
        user: user.email,
        requestId,
        details: details ?? null,
      });
    }
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
  console.info("[purchase-requests] incoming user", {
    requestId,
    email: user.email,
    role: user.role,
    isPhotoVerified: isVerified(user),
    sellerStatus: user.sellerStatus,
    hasBuyerRole: hasRole(user, "buyer"),
    hasApprovedSellerRole: hasRole(user, "approved_seller"),
    hasAdminRole: hasRole(user, "admin"),
  });
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) {
    return denied(
      "Phone verification is required before marketplace actions.",
      403,
      "PHONE_VERIFICATION_REQUIRED",
      undefined,
      undefined,
      { gate: "requirePhoneVerificationForTrading" },
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

    const buyerName = String(body.buyerName ?? user.fullName).trim();
    const buyerWhatsapp = String(body.buyerWhatsapp ?? user.whatsappNumber).trim();
    if (!buyerName) {
      return denied("Buyer name is required.", 400, "BUYER_NAME_REQUIRED");
    }
    if (!buyerWhatsapp) {
      return denied("Buyer WhatsApp is required.", 400, "BUYER_WHATSAPP_REQUIRED");
    }

    const buyerNotes = String(body.buyerNotes ?? "").slice(0, 2000);
    const usdtAmount = String(body.usdtAmount ?? "").trim();
    if (!usdtAmount) {
      return denied("Trade amount is required.", 400, "TRADE_AMOUNT_REQUIRED");
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
      return denied(error.message, 400, "PURCHASE_REQUEST_VALIDATION_FAILED", undefined, { errorName: error.name });
    }
    return failed("Failed to submit purchase request.");
  }
}
