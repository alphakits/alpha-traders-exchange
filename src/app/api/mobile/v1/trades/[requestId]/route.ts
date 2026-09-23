import { after, NextRequest } from "next/server";
import { TradeBlockedError, updateTradeTerms, recalculateCardlessTradeAmount, getTradeRoomData, getTradeRoomRevision, updatePurchaseRequestStatus } from "@/lib/alpha-exchange-store";
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
  toMobileTradeActions,
  toMobileTradeDetail,
  toMobileTradeSummary,
} from "@/lib/mobile-trades";
import { prepareTradeEventEmails, tradeEmailEventForStatus } from "@/lib/marketplace-email-events";
import { checkRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import type { PurchaseRequestStatus } from "@/types/alpha-exchange";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MOBILE_MUTABLE_STATUSES = new Set<PurchaseRequestStatus>([
  "accepted",
  "declined",
  "cancelled",
  "payment_sent",
  "funds_received",
  "usdt_release_pending",
  "usdt_sent",
  "completed",
]);

async function participantRoom(
  requestId: string,
  userId: string,
  role: Parameters<typeof getTradeRoomData>[0]["actorRole"],
  markMessagesRead = false,
) {
  const room = await getTradeRoomData({
    purchaseRequestId: requestId,
    actorUserId: userId,
    actorRole: role,
    markMessagesRead,
    strongConsistency: true,
  });
  return isMobileTradeParticipant(room.request, userId) ? room : null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const params = await context.params;
  if (!RESOURCE_ID_PATTERN.test(params.requestId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const room = await participantRoom(params.requestId, auth.user.id, auth.user.role, true);
    if (!room) return mobileError("TRADE_NOT_FOUND", requestId, locale, 404);
    return mobileJson({ trade: toMobileTradeDetail(room, auth.user.id, locale) }, requestId);
  } catch (error) {
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, requestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_detail",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const params = await context.params;
  if (!RESOURCE_ID_PATTERN.test(params.requestId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const revision = await getTradeRoomRevision({
      purchaseRequestId: params.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
    });
    if (revision.buyerId !== auth.user.id && revision.sellerId !== auth.user.id) {
      return mobileError("TRADE_NOT_FOUND", requestId, locale, 404);
    }

    const body = await readMobileJsonBody(request);
    const action = String(body?.action ?? "").trim();
    if (["counter_offer", "propose_amount", "accept_amount", "decline_terms", "withdraw_terms"].includes(action)) {
      const rate = checkRateLimit({ headers: request.headers, key: "mobile:trade:terms", identifier: auth.user.id, maxRequests: 20, windowMs: 60_000 });
      if (!rate.allowed) return mobileError("RATE_LIMITED", requestId, locale, 429);
      const updated = await updateTradeTerms({ requestId: params.requestId, actorUserId: auth.user.id, action: action as Parameters<typeof updateTradeTerms>[0]["action"], value: String(body?.value ?? ""), proposalId: String(body?.proposalId ?? ""), expectedUpdatedAt: String(body?.expectedUpdatedAt ?? ""), safetyAcknowledged: body?.safetyAcknowledged === true });
      return mobileJson({ trade: toMobileTradeSummary(updated, auth.user.id), actions: toMobileTradeActions(updated, auth.user.id) }, requestId);
    }
    if (action === "recalculate_cardless_amount") {
      const rate = checkRateLimit({ headers: request.headers, key: "mobile:trade:adjust", identifier: auth.user.id, maxRequests: 20, windowMs: 60_000 });
      if (!rate.allowed) return mobileError("RATE_LIMITED", requestId, locale, 429);
      const updated = await recalculateCardlessTradeAmount({ requestId: params.requestId, actorUserId: auth.user.id, ilsAmount: typeof body?.ilsAmount === "string" ? body.ilsAmount : undefined });
      return mobileJson({ trade: toMobileTradeSummary(updated, auth.user.id), actions: toMobileTradeActions(updated, auth.user.id) }, requestId);
    }
    if (action && action !== "accept_counter_offer" && action !== "complete_cash_trade" && action !== "complete_trade" && action !== "complete_face_to_face" && action !== "submit_cardless_code") {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }
    const isSellerCompletion = action === "complete_trade";
    const isCashTradeCompletion = action === "complete_cash_trade" || action === "complete_face_to_face";
    const isCardlessCodeSubmission = action === "submit_cardless_code";
    const nextStatus = (action === "accept_counter_offer" ? "accepted" : (isCashTradeCompletion || isSellerCompletion) ? "completed" : isCardlessCodeSubmission ? "payment_sent" : String(body?.status ?? "")) as PurchaseRequestStatus;
    if (!MOBILE_MUTABLE_STATUSES.has(nextStatus)) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const rate = checkRateLimit({
      headers: request.headers,
      key: "mobile:trade:status:v2",
      identifier: auth.user.id,
      maxRequests: 40,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const updated = await updatePurchaseRequestStatus({
      requestId: params.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      acceptCounterOfferId: action === "accept_counter_offer" ? String(body?.proposalId ?? "") : undefined,
      nextStatus,
      completionMode: isSellerCompletion ? "seller" : isCashTradeCompletion ? "cash_trade" : undefined,
      usdtSentConfirmed: body?.usdtSentConfirmed === true,
      safetyAcknowledged: body?.safetyAcknowledged === true,
      cardlessWithdrawalCode: isCardlessCodeSubmission ? String(body?.withdrawalCode ?? "") : undefined,
      cardlessVerificationKind: isCardlessCodeSubmission ? String(body?.verificationKind ?? "") : undefined,
      cardlessVerificationValue: isCardlessCodeSubmission ? String(body?.verificationValue ?? "") : undefined,
      clientOperationId: isCardlessCodeSubmission ? String(body?.clientOperationId ?? "") : undefined,
    });

    if (updated.deferredTrustWrite) {
      after(async () => {
        try {
          await updated.deferredTrustWrite?.();
        } catch (error) {
          logEvent("error", {
            event: "mobile_trade_deferred_trust",
            actorUserId: auth.user.id,
            resourceId: params.requestId,
            outcome: "failed",
            reason: "post_response_write_failed",
            metadata: { errorType: error instanceof Error ? error.name : typeof error },
          });
        }
      });
    }

    const emailEvent = updated.statusChanged ? tradeEmailEventForStatus(nextStatus) : null;
    if (emailEvent || updated.additionallyDeclinedRequests?.length) {
      after(async () => {
        try {
          const deliveries = await Promise.all([
            ...(updated.additionallyDeclinedRequests ?? []).map((declinedRequest) =>
              prepareTradeEventEmails({ event: "trade_rejected", request: declinedRequest }),
            ),
            ...(emailEvent
              ? [prepareTradeEventEmails({ event: emailEvent, request: updated.request })]
              : []),
          ]);
          await Promise.allSettled(deliveries.map((deliver) => deliver()));
        } catch (emailError) {
          logEvent("error", {
            event: "mobile_trade_email_schedule",
            actorUserId: auth.user.id,
            resourceId: params.requestId,
            outcome: "failed",
            reason: "status_post_commit_schedule_failed",
            metadata: { errorType: emailError instanceof Error ? emailError.name : typeof emailError },
          });
        }
      });
    }

    return mobileJson({
      trade: toMobileTradeSummary(updated.request, auth.user.id),
      actions: toMobileTradeActions(updated.request, auth.user.id),
    }, requestId);
  } catch (error) {
    if (error instanceof TradeBlockedError && ["trade-terms-invalid", "stale-counter-offer", "trade-terms-pending"].includes(error.code)) {
      return mobileJson({ error: { code: "INVALID_REQUEST", message: locale === "ar" ? "تعذر تأكيد تغيير الشروط. تحقق من المبلغ وحدود العرض وحدّث الصفقة. للسحب دون بطاقة يجب مطابقة مبلغ رمز المشتري." : error.message } }, requestId, { status: 409 });
    }
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, requestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_status",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
