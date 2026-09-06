import type {
  MobileApiErrorCode,
  MobileLocale,
  MobileTradeDetail,
  MobileTradeMessage,
  MobileTradeSummary,
} from "@alpha-traders/contracts";
import type { TradeRoomData } from "@/lib/alpha-exchange-store";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";
import { localizeTradeRoomSystemMessage } from "@/lib/trade-room-system-message-localization";
import type { PurchaseRequest, TradeChatMessage } from "@/types/alpha-exchange";

export function isMobileTradeParticipant(request: PurchaseRequest, userId: string) {
  return request.buyerId === userId || request.sellerId === userId;
}

export function toMobileTradeSummary(request: PurchaseRequest, userId: string): MobileTradeSummary {
  const pricePerUsdt = request.pricePerUsdt || request.listingPriceAtRequest || "0";
  return {
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
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function toMobileTradeMessage(
  message: TradeChatMessage,
  userId: string,
  locale: MobileLocale,
): MobileTradeMessage {
  const sender = message.kind === "system"
    ? "system"
    : message.senderUserId === userId
      ? "you"
      : "counterparty";
  return {
    sender,
    message: message.kind === "system"
      ? localizeTradeRoomSystemMessage(message.message, locale).text
      : message.message,
    createdAt: message.createdAt,
  };
}

export function toMobileTradeDetail(
  room: TradeRoomData,
  userId: string,
  locale: MobileLocale,
): MobileTradeDetail {
  const request = room.request;
  const side = request.buyerId === userId ? "buyer" : "seller";
  const isBuyer = side === "buyer";
  const isSeller = side === "seller";
  return {
    ...toMobileTradeSummary(request, userId),
    counterpartyDisplayName: isBuyer ? room.counterpart.sellerName : room.counterpart.buyerName,
    receivingWalletAddress: request.buyerReceivingWalletAddress,
    timeline: (request.timeline ?? []).map((entry) => ({
      type: entry.type,
      createdAt: entry.createdAt,
    })),
    messages: room.messages.slice(-100).map((message) => toMobileTradeMessage(message, userId, locale)),
    hasBuyerEvidence: Boolean(request.buyerEvidence),
    hasSellerEvidence: Boolean(request.sellerEvidence),
    deadlineAt: room.deadlineAt,
    timeRemainingSeconds: room.timeRemainingSeconds,
    hasOpenDispute: room.hasOpenDispute,
    actions: {
      canAccept: isSeller && request.status === "pending",
      canDecline: isSeller && request.status === "pending",
      canCancel: isBuyer
        && (request.status === "pending" || (request.status === "accepted" && !request.buyerEvidence)),
      canViewBankDetails: isBuyer
        && Boolean(request.sellerBankAccountId)
        && !["pending", "declined", "cancelled"].includes(request.status),
      canUploadPaymentEvidence: isBuyer && request.status === "accepted",
      canConfirmFunds: isSeller && request.status === "payment_sent",
      canBeginRelease: isSeller && request.status === "funds_received",
      canUploadReleaseEvidence: isSeller && request.status === "usdt_release_pending",
      canConfirmReceived: isBuyer && request.status === "usdt_sent",
    },
  };
}

export function mobileTradeErrorCode(error: unknown): MobileApiErrorCode | null {
  const code = typeof error === "object" && error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const isTradeBlocked = error instanceof Error && error.name === "TradeBlockedError";
  if (isTradeBlocked) {
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
