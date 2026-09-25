import { canBuyerCancelTrade, canSellerCancelTrade, canSellerDeclineTrade } from "@/lib/trade-room-actions";
import { PrivateContactError } from "@/lib/buyer-contact";
import type {
  MobileApiErrorCode,
  MobileLocale,
  MobileTradeDetail,
  MobileTradeMessage,
  MobileTradeSummary,
} from "@alpha-traders/contracts";
import { localizeCardlessWithdrawalMessage, tradeChatStatus } from "@alpha-traders/contracts";
import { tradeChatPublicId, tradeChatSender, type TradeChatContext } from "@/lib/trade-chat-presentation";
import type { TradeRoomData } from "@/lib/alpha-exchange-store";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";
import {
  isBankTransferPaymentMethod,
  isFaceToFacePaymentMethod,
  isCashTradeCompletionAvailable,
  isSellerTradeCompletionAvailable,
  isCashTradePaymentMethod,
  isCashTradeUsdtSentConfirmationAvailable,
} from "@/lib/marketplace-payment-methods";
import { localizeTradeRoomSystemMessage } from "@/lib/trade-room-system-message-localization";
import type { PurchaseRequest, TradeChatMessage } from "@/types/alpha-exchange";

export function isMobileTradeParticipant(request: PurchaseRequest, userId: string) {
  return request.buyerId === userId || request.sellerId === userId;
}

export function toMobileTradeSummary(request: PurchaseRequest, userId: string): MobileTradeSummary {
  const pricePerUsdt = request.pricePerUsdt || request.listingPriceAtRequest || "0";
  return {
    feePolicyVersion: request.feePolicyVersion,
    termsProposal: request.termsProposal,
    id: request.id,
    displayNumber: request.displayNumber,
    side: request.buyerId === userId ? "buyer" : "seller",
    status: request.status,
    usdtAmount: request.usdtAmount,
    fiatAmount: request.fiatAmount,
    pricePerUsdt,
    listingPriceAtRequest: request.listingPriceAtRequest || pricePerUsdt,
    priceMode: request.priceMode === "buyer_offer" ? "buyer_offer" : "listing_price",
    currency: request.currency,
    network: request.network,
    paymentMethod: request.paymentMethod,
    bankName: request.bankName,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function toMobileTradeMessage(
  message: TradeChatMessage,
  userId: string,
  locale: MobileLocale,
  context?: TradeChatContext,
): MobileTradeMessage {
  const sender = message.kind === "system"
    ? "system"
    : message.senderUserId === userId
      ? "you"
      : "counterparty";
  const identity = context ? tradeChatSender(message, context) : undefined;
  return {
    sender,
    ...(context && message.kind !== "system" ? {
      senderPublicId: identity?.publicId,
      // Keep older installed clients compatible with their role-label map.
      participantRole: identity?.role === "owner" ? "support" : identity?.role,
      isOwnerMessage: identity?.role === "owner",
      status: tradeChatStatus(message, context.request),
    } : {}),
    ...(message.credentialKind === "cardless_code" ? { credentialKind: "cardless_code" as const } : {}),
    message: message.kind === "system"
      ? localizeTradeRoomSystemMessage(message.message, locale).text
      : message.credentialKind === "cardless_code"
        ? localizeCardlessWithdrawalMessage(message.message, locale)
        : message.message,
    createdAt: message.createdAt,
  };
}

type MobileTradeActionContext = {
  canOpenDispute: boolean;
  hasOpenDispute: boolean;
};

export function toMobileTradeActions(
  request: PurchaseRequest,
  userId: string,
  context: MobileTradeActionContext = { canOpenDispute: false, hasOpenDispute: false },
): MobileTradeDetail["actions"] {
  const isBuyer = request.buyerId === userId;
  const isSeller = request.sellerId === userId;
  const isCashTrade = isCashTradePaymentMethod(request.paymentMethod);
  return {
    canAccept: isSeller && request.status === "pending" && request.termsProposal?.status !== "pending",
    canDecline: canSellerDeclineTrade(request, userId),
    canCancel: canBuyerCancelTrade(request, userId) || (request.status !== "pending" && canSellerCancelTrade(request, userId)),
    canViewBankDetails: isBuyer
      && Boolean(request.sellerBankAccountId)
      && isBankTransferPaymentMethod(request.paymentMethod)
      && !["pending", "declined", "cancelled"].includes(request.status),
    canMarkPaymentSent: isBuyer
      && isCashTrade
      && request.status === "accepted",
    canUploadPaymentEvidence: isBuyer
      && request.status === "accepted"
      && !isCashTrade,
    canConfirmFunds: isSeller
      && !context.hasOpenDispute && request.termsProposal?.status !== "pending"
      && (request.status === "payment_sent" || (isFaceToFacePaymentMethod(request.paymentMethod) && request.status === "accepted")),
    canBeginRelease: isSeller
      && request.status === "funds_received"
      && !isCashTrade,
    canMarkUsdtSent: isSeller
      && !isSellerTradeCompletionAvailable(request.paymentMethod, request.status)
      && isCashTradeUsdtSentConfirmationAvailable(request.paymentMethod, request.status),
    canUploadReleaseEvidence: isSeller
      && request.status === "usdt_release_pending"
      && !isCashTrade,
    canConfirmReceived: isBuyer
      && request.status === "usdt_sent",
    canCompleteTrade: isSeller && isSellerTradeCompletionAvailable(request.paymentMethod, request.status),
    canCompleteFaceToFace: isSeller
      && isCashTradeCompletionAvailable(request.paymentMethod, request.status),
    canOpenDispute: isBuyer && context.canOpenDispute && !context.hasOpenDispute,
    canSubmitReview: isBuyer
      && ["review_open", "completed", "locked"].includes(request.status)
      && !request.buyerReview,
    canReviewBuyer: isSeller && ["completed", "review_open", "locked"].includes(request.status) && !request.sellerBuyerReview,
    canRespondToReview: isSeller
      && Boolean(request.buyerReview)
      && request.buyerReview?.hidden !== true
      && !request.sellerResponse,
  };
}

export function canExposeBuyerWalletToMobileParticipant(request: PurchaseRequest, userId: string) {
  if (request.buyerId === userId) return true;
  if (request.sellerId !== userId) return false;
  return ["funds_received", "usdt_release_pending", "usdt_sent", "review_open", "completed", "locked"].includes(request.status);
}

export function toMobileTradeDetail(
  room: TradeRoomData,
  userId: string,
  locale: MobileLocale,
): MobileTradeDetail {
  const request = room.request;
  const side = request.buyerId === userId ? "buyer" : "seller";
  const isBuyer = side === "buyer";
  const buyerReview = request.buyerReview
    ? {
        rating: request.buyerReview.rating,
        comment: request.buyerReview.comment,
        createdAt: request.buyerReview.createdAt,
        ...(request.sellerResponse
          ? {
              sellerResponse: {
                message: request.sellerResponse.message,
                createdAt: request.sellerResponse.createdAt,
              },
            }
          : {}),
      }
    : undefined;
  return {
    ...toMobileTradeSummary(request, userId),
    ...(!isBuyer && room.sellerCommissionDueCount > 0 ? { sellerCommissionDue: { count: room.sellerCommissionDueCount, amount: room.sellerCommissionDueAmount } } : {}),
    counterpartyDisplayName: tradeChatPublicId(room, isBuyer ? "seller" : "buyer"),
    participants: { buyerPublicId: tradeChatPublicId(room, "buyer"), sellerPublicId: tradeChatPublicId(room, "seller") },
    receivingWalletAddress: canExposeBuyerWalletToMobileParticipant(request, userId)
      ? request.buyerReceivingWalletAddress
      : undefined,
    timeline: (request.timeline ?? []).map((entry) => ({
      type: entry.type,
      createdAt: entry.createdAt,
    })),
    messages: room.messages.slice(-100).map((message) => toMobileTradeMessage(message, userId, locale, room)),
    hasBuyerEvidence: Boolean(request.buyerEvidence),
    hasSellerEvidence: Boolean(request.sellerEvidence),
    deadlineAt: room.deadlineAt,
    timeRemainingSeconds: room.timeRemainingSeconds,
    hasOpenDispute: room.hasOpenDispute,
    ...(buyerReview ? { buyerReview } : {}),
    ...(request.sellerBuyerReview ? { sellerBuyerReview: { rating: request.sellerBuyerReview.rating, comment: request.sellerBuyerReview.comment, createdAt: request.sellerBuyerReview.createdAt } } : {}),
    actions: toMobileTradeActions(request, userId, {
      canOpenDispute: room.canOpenDispute,
      hasOpenDispute: room.hasOpenDispute,
    }),
  };
}

export function mobileTradeErrorCode(error: unknown): MobileApiErrorCode | null {
  if (error instanceof PrivateContactError) return "PRIVATE_CONTACT_REQUIRED";
  const code = typeof error === "object" && error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const isTradeBlocked = error instanceof Error && error.name === "TradeBlockedError";
  if (isTradeBlocked) {
    if (code === "cardless-verification-required" || code === "CARDLESS_DETAILS_REQUIRED") return "CARDLESS_DETAILS_REQUIRED";
    if (code === "AWAITING_BUYER_CONFIRMATION") return "AWAITING_BUYER_CONFIRMATION";
    if (code === "ACTIVE_TRADE_EXISTS") return "ACTIVE_TRADE_EXISTS";
    if (code === "PURCHASE_REQUEST_ALREADY_SUBMITTED") return "PURCHASE_REQUEST_ALREADY_SUBMITTED";
    if (code === "PENDING_BUYER_FEEDBACK") return "PENDING_BUYER_FEEDBACK";
    if (code === "commission-due" || code === "SELLER_COMMISSION_DUE") return "COMMISSION_DUE";
    if (code === "LISTING_SELLER_LOCKED" || code === "listing-not-found" || code === "listing-already-matched" || code === "listing-not-open") {
      return "LISTING_UNAVAILABLE";
    }
    if (code === "safety-acknowledgment-required") return "SAFETY_ACKNOWLEDGEMENT_REQUIRED";
    if (code === "PRICE_OFFER_INVALID_FORMAT" || code === "PRICE_OFFER_NOT_LOWER" || code === "PRICE_OFFER_BELOW_MINIMUM" || code === "PRICE_OFFERS_ILS_ONLY") {
      return "PRICE_OFFER_INVALID";
    }
    if (code === "purchase-request-not-found") return "TRADE_NOT_FOUND";
    if (code) return "TRADE_ACTION_NOT_ALLOWED";
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (!message) return null;
  if (message === "you are not allowed to access trade evidence." || message === "you are not allowed to send trade room messages.") {
    return "TRADE_NOT_FOUND";
  }
  if (message === DIRECT_CONTACT_CONTENT_ERROR.toLowerCase()) return "DIRECT_CONTACT_BLOCKED";
  if (message.includes("message is too long") || message.includes("message or image is required") || message.includes("invalid message request id")) {
    return "MESSAGE_INVALID";
  }
  if (message.includes("trade not found") || message.includes("purchase request not found")) return "TRADE_NOT_FOUND";
  if (message.includes("listing not found") || message.includes("listing is not available") || message.includes("seller is currently unavailable") || message.includes("own listing")) {
    return "LISTING_UNAVAILABLE";
  }
  if (message.includes("trade amount") || message.includes("minimum trade") || message.includes("maximum trade") || message.includes("remaining listing quantity")) {
    return "TRADE_AMOUNT_INVALID";
  }
  if (message.includes("wallet") || message.includes("address beginning") || message.includes("solana") || message.includes("tron")) {
    return "WALLET_ADDRESS_INVALID";
  }
  if (message.includes("payment method")) return "PAYMENT_METHOD_INVALID";
  if (message.includes("safety") || message.includes("face-to-face")) return "SAFETY_ACKNOWLEDGEMENT_REQUIRED";
  if (message.includes("offer price") || message.includes("price offer")) return "PRICE_OFFER_INVALID";
  if (message.includes("evidence") || message.includes("file type") || message.includes("file payload")) return "EVIDENCE_INVALID";
  if (message.includes("dispute reason")) return "DISPUTE_INVALID";
  if (message.includes("review comment") || message.includes("rating must") || message.includes("response message")) return "REVIEW_INVALID";
  if (message.includes("open dispute already exists")) return "TRADE_ACTION_NOT_ALLOWED";
  if (message.includes("review already submitted") || message.includes("response already submitted") || message.includes("cannot reply")) {
    return "TRADE_ACTION_NOT_ALLOWED";
  }
  if (message.includes("not allowed") || message.includes("only after") || message.includes("only the")) return "TRADE_ACTION_NOT_ALLOWED";
  return null;
}

export function mobileTradeErrorStatus(code: MobileApiErrorCode) {
  if (code === "TRADE_NOT_FOUND") return 404;
  if (
    code === "TRADE_ACTION_NOT_ALLOWED"
    || code === "ACTIVE_TRADE_EXISTS"
    || code === "PURCHASE_REQUEST_ALREADY_SUBMITTED"
    || code === "PENDING_BUYER_FEEDBACK"
    || code === "AWAITING_BUYER_CONFIRMATION"
    || code === "COMMISSION_DUE"
    || code === "LISTING_UNAVAILABLE"
  ) return 409;
  return 400;
}
