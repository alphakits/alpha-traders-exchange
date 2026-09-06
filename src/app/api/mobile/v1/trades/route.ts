import { after, NextRequest } from "next/server";
import { createPurchaseRequest, getMyPurchaseRequests } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import {
  isMobileTradeParticipant,
  mobileTradeErrorCode,
  mobileTradeErrorStatus,
  toMobileTradeSummary,
} from "@/lib/mobile-trades";
import { prepareTradeEventEmails } from "@/lib/marketplace-email-events";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { hasRole } from "@/lib/roles";
import { logEvent } from "@/lib/structured-logging";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const USDT_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;
const PRICE_PATTERN = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const trades = (await getMyPurchaseRequests(auth.user.id, auth.user.role))
      // Admin/owner accounts may inspect all trades on the web. The native app
      // intentionally remains participant-only.
      .filter((trade) => isMobileTradeParticipant(trade, auth.user.id))
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 100)
      .map((trade) => toMobileTradeSummary(trade, auth.user.id));
    return mobileJson({ trades }, requestId);
  } catch (error) {
    logEvent("error", {
      event: "mobile_trades_list",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}

export async function POST(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    if (!hasRole(auth.user, "buyer") && !hasRole(auth.user, "approved_seller")) {
      return mobileError("BUYER_ROLE_REQUIRED", requestId, locale, 403);
    }
    if (!auth.user.fullName.trim()) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const body = await readMobileJsonBody(request);
    const listingId = String(body?.listingId ?? "").trim();
    const usdtAmount = String(body?.usdtAmount ?? "").trim();
    const receivingWalletAddress = String(body?.receivingWalletAddress ?? "").trim();
    const paymentMethod = String(body?.paymentMethod ?? "").trim();
    const priceMode = String(body?.priceMode ?? "listing_price").trim();
    const offeredPrice = String(body?.offeredPrice ?? "").trim();
    const safetyAcknowledged = body?.safetyAcknowledged === true;
    if (
      !RESOURCE_ID_PATTERN.test(listingId)
      || !USDT_AMOUNT_PATTERN.test(usdtAmount)
      || !receivingWalletAddress
      || receivingWalletAddress.length > 128
      || !paymentMethod
      || paymentMethod.length > 80
      || (priceMode !== "listing_price" && priceMode !== "buyer_offer")
      || (priceMode === "buyer_offer" && !PRICE_PATTERN.test(offeredPrice))
    ) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:trade:create",
      identifier: auth.user.id,
      maxRequests: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const created = await createPurchaseRequest({
      buyerId: auth.user.id,
      listingId,
      usdtAmount,
      buyerName: auth.user.fullName.trim(),
      buyerReceivingWalletAddress: receivingWalletAddress,
      paymentMethod,
      safetyAcknowledged,
      priceMode,
      offeredPrice: priceMode === "buyer_offer" ? offeredPrice : undefined,
      actorUserId: auth.user.id,
    });

    try {
      const deliverTradeEmails = await prepareTradeEventEmails({
        event: "new_buy_request",
        request: created.request,
      });
      after(deliverTradeEmails);
    } catch (emailError) {
      logEvent("error", {
        event: "mobile_trade_email_schedule",
        actorUserId: auth.user.id,
        resourceId: created.request.id,
        outcome: "failed",
        reason: "create_post_commit_schedule_failed",
        metadata: { errorType: emailError instanceof Error ? emailError.name : typeof emailError },
      });
    }

    logEvent("info", {
      event: "mobile_trade_create",
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      resourceId: created.request.id,
      outcome: "success",
      metadata: { listingId, priceMode, requestId },
    });
    return mobileJson(
      { trade: toMobileTradeSummary(created.request, auth.user.id) },
      requestId,
      { status: 201 },
    );
  } catch (error) {
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, requestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_create",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
