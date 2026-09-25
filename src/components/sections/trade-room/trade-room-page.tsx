"use client";
import { sellerFeeResponsibilityNotice } from "@alpha-traders/contracts";

import { AttentionSiren } from "@/components/ui/attention-siren";
import { publicAccountName } from "@/lib/public-account-identity";

import { formatMoneyNumber } from "@/lib/accent-text";
import { currencyText } from "@/components/ui/currency-text";
import { ACTION_FEEDBACK_REVEALED, ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { AlertTriangle, BellRing, CheckCircle2, ChevronDown, Clock3, Copy, LoaderCircle, MessageCircle, Paperclip, ShieldCheck, Upload } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { navigateOrRevealResult } from "@/lib/client-success-navigation";
import { publishTradeHeaderActivity, toTradeHeaderActivity } from "@/lib/trade-header-activity";
import { commissionPaymentDestination } from "@/lib/commission-payment-destination";
import { TradeTermsPanel } from "./trade-terms-panel";
import { TradeChatMessageLabel, TradeChatMessageStatus } from "./trade-chat-message-label";
import { tradeChatPublicId } from "@/lib/trade-chat-presentation";
import { useTradeChatReadReceipts, type TradeChatReceipt } from "./use-trade-chat-read-receipts";
import { OwnerTradeHistoryPage } from "./owner-trade-history";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MarketplaceListing, PurchaseRequest, TradeChatMessage, TradeTimelineEntry, UserRole } from "@/types/alpha-exchange";
import { formatTradeId } from "@/lib/format-id";
import {
  acquireTradeRoomMutation,
  canBuyerCancelTrade,
  canSellerCancelTrade,
  canSellerDeclineTrade,
  releaseTradeRoomMutation,
} from "@/lib/trade-room-actions";
import { clearTradeRoomCache, readTradeRoomCache, writeTradeRoomCache } from "@/lib/trade-room-client";
import { postTradeReview, TradeReviewTimeoutError } from "@/lib/trade-review-client";
import { isBankTransferPaymentMethod, isCardlessAtmPaymentMethod, isCashTradePaymentMethod, isCashTradeUsdtSentConfirmationAvailable, isFaceToFacePaymentMethod, isSellerTradeCompletionAvailable, isSellerEvidenceRequiredForPaymentMethod, normalizeMarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import { getIsraeliBankDisplayName, parseIsraeliBankSelection } from "@/lib/israeli-banks";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { localizeTradeRoomSystemMessage } from "@/lib/trade-room-system-message-localization";
import { UserSafetyActions } from "@/components/account/user-safety-actions";
import { CardlessWithdrawalFields } from "./cardless-withdrawal-fields";
import { localizeCardlessWithdrawalMessage, parseCardlessWithdrawalDetails, calculateCardlessUsdtAmount, getCardlessCashAmountOptions, parseCardlessCashAmount, type CardlessVerificationKind } from "@alpha-traders/contracts";

type Locale = "ar" | "en";

type TradeRoomData = {
  request: PurchaseRequest;
  listing: MarketplaceListing | null;
  counterpart: { buyerName: string; sellerName: string; buyerPublicId?: string; sellerPublicId?: string };
  messages: TradeChatMessage[];
  poke: {
    available: boolean;
    canPoke: boolean;
    cooldownUntil: string | null;
    cooldownRemainingSeconds: number;
    counterpartRole: "buyer" | "seller" | null;
  };
  deadlineAt: string | null;
  timeRemainingSeconds: number | null;
  releaseDeadlineActive: boolean;
  releaseDeadlineOverdue: boolean;
  isOverdue: boolean;
  hasOpenDispute: boolean;
  canOpenDispute: boolean;
  sellerCommissionDueAmount: number;
  sellerCommissionDueCount: number;
  sellerPayableCommissionId?: string;
  sellerPayableCommissionAmount?: number;
  _timing?: {
    trigger?: string;
    publishedAtEpochMs?: number | null;
    snapshotMs?: number;
    sentAtEpochMs?: number;
    publishToSentMs?: number | null;
  };
};

type TradeRoomBankDetails = {
  requestId: string;
  tradeId: string;
  bankAccountId: string;
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
  accountLast4: string;
};

type TradeRoomChatPostPayload = {
  code?: string;
  error?: string;
  message?: TradeChatMessage;
};

type ActorSession = {
  id: string;
  role: UserRole;
  fullName: string;
};

type TradeRoomPageProps = {
  locale: Locale;
  requestId: string;
  actor: ActorSession;
};

type StepId = "request" | "accepted" | "payment" | "verifying" | "release" | "completed";

type PrimaryStatus = "accepted" | "declined" | "payment_sent" | "funds_received" | "usdt_release_pending" | "usdt_sent" | "completed";

type StatusPrimaryAction = {
  label: string;
  successLabel: string;
  mode: "status";
  nextStatus: PrimaryStatus;
  command?: "complete_cash_trade" | "complete_trade";
  confirmationMessage?: string;
  requiresEvidenceSide?: "buyer" | "seller";
};

type UploadPrimaryAction = {
  label: string;
  successLabel: string;
  mode: "upload";
  uploadSide: "buyer" | "seller";
};

type PrimaryAction = StatusPrimaryAction | UploadPrimaryAction;

type TradeRoomDeepLinkTarget = "status-banner" | "action-required" | "evidence" | "chat";

const ALLOWED_EVIDENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const ALLOWED_CHAT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_EVIDENCE_SIZE_BYTES = 8 * 1024 * 1024;
const CHAT_SEND_TIMEOUT_MS = 12_000;
const TRADE_ROOM_RECONNECT_BASE_MS = 1_000;
const TRADE_ROOM_RECONNECT_MAX_MS = 15_000;
const TRADE_ROOM_DEBUG = process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
const COMPLETED_TRADE_STATUSES = new Set<PurchaseRequest["status"]>(["review_open", "completed", "locked"]);
const PERF_LOG = process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";

type TradeStep = { id: StepId; icon: string; label: { en: string; ar: string } };

const STEP_ORDER: TradeStep[] = [
  { id: "request", icon: "📝", label: { en: "Request Submitted", ar: "تم إرسال الطلب" } },
  { id: "accepted", icon: "🤝", label: { en: "Seller Accepted", ar: "وافق البائع" } },
  { id: "payment", icon: "💳", label: { en: "Buyer Sent Payment", ar: "أرسل المشتري الدفع" } },
  { id: "verifying", icon: "🔍", label: { en: "Seller Confirmed Payment", ar: "أكد البائع استلام الدفع" } },
  { id: "release", icon: "₮", label: { en: "USDT Sent", ar: "تم إرسال USDT" } },
  { id: "completed", icon: "⭐", label: { en: "Trade Completed", ar: "اكتملت الصفقة" } },
];

const CASH_TRADE_STEP_ORDER: TradeStep[] = [
  { id: "request", icon: "📝", label: { en: "Request Submitted", ar: "تم إرسال الطلب" } },
  { id: "accepted", icon: "🤝", label: { en: "Seller Accepted", ar: "وافق البائع" } },
  { id: "payment", icon: "💵", label: { en: "Buyer Confirmed Cash", ar: "أكد المشتري تسليم النقد" } },
  { id: "verifying", icon: "✅", label: { en: "Seller Confirmed Cash", ar: "أكد البائع استلام النقد" } },
  { id: "release", icon: "₮", label: { en: "USDT Sent", ar: "تم إرسال USDT" } },
  { id: "completed", icon: "⭐", label: { en: "Trade Completed", ar: "اكتملت الصفقة" } },
];

const CARDLESS_ATM_TRADE_STEP_ORDER: TradeStep[] = CASH_TRADE_STEP_ORDER.map((step) => (
  step.id === "payment"
    ? { ...step, label: { en: "Buyer Confirmed Code", ar: "أكد المشتري إرسال الرمز" } }
    : step
));

function tradeStepLabel(step: TradeStep | undefined, isAr: boolean, isPriceOffer: boolean) {
  if (!step) return "";
  if (step.id === "request" && isPriceOffer) return isAr ? "تم إرسال عرض السعر" : "Price Offer Submitted";
  return isAr ? step.label.ar : step.label.en;
}

function toNumber(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  return Number(normalized.replace(/[^\d.]/g, "")) || 0;
}

function formatUsdtAmount(value: string | number | null | undefined) {
  return `${toNumber(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function readApiErrorFallback(payload: unknown, fallback: string, isAr = false) {
  if (payload && typeof payload === "object") {
    const candidate = payload as { error?: unknown; message?: unknown };
    if (typeof candidate.error === "string" && candidate.error.trim()) {
      return !isAr || /[\u0600-\u06ff]/.test(candidate.error) ? candidate.error : fallback;
    }
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return !isAr || /[\u0600-\u06ff]/.test(candidate.message) ? candidate.message : fallback;
    }
  }
  return fallback;
}

function localizedCaughtError(error: unknown, fallback: string, isAr: boolean) {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  if (!isAr || /[\u0600-\u06ff]/.test(error.message)) return error.message;
  return fallback;
}

function createTradeRoomClientMessageId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function tradeRoomChatAttemptSignature(
  message: string,
  image: Pick<File, "name" | "size" | "type" | "lastModified"> | null,
) {
  return JSON.stringify([
    message.trim(),
    image ? [image.name, image.size, image.type, image.lastModified] : null,
  ]);
}

export function resolveTradeRoomChatAttempt(
  previous: { signature: string; clientMessageId: string } | null,
  signature: string,
  createId: () => string = createTradeRoomClientMessageId,
) {
  return previous?.signature === signature
    ? previous
    : { signature, clientMessageId: createId() };
}

function readTradeRoomChatError(
  payload: { code?: string; error?: string } | null,
  isAr: boolean,
) {
  if (payload?.code === "DIRECT_CONTACT_BLOCKED") {
    return isAr
      ? "لحمايتك، لا يمكن إرسال رقم هاتف أو بريد إلكتروني أو WhatsApp أو بيانات تواصل خارجية. أبقِ المحادثة داخل غرفة الصفقة."
      : "For your security, phone numbers, email, WhatsApp, and other external contact details cannot be sent. Keep the conversation inside this Trade Room.";
  }
  return readApiErrorFallback(payload, isAr ? "تعذر إرسال الرسالة. حاول مرة أخرى." : "Message was not sent. Please try again.", isAr);
}

function isRetryableChatResponse(status: number) {
  return status === 408 || status === 425 || status === 502 || status === 503 || status === 504;
}

function paymentMethodDisplayLabel(method: string, isAr: boolean) {
  const normalized = normalizeMarketplacePaymentMethod(method) ?? method;
  if (!isAr) return normalized;
  if (normalized === "Bank Transfer") return "تحويل بنكي";
  if (normalized === "Face-to-Face (Meet in Person)") return "لقاء شخصي";
  if (normalized === "Cardless ATM Withdrawal") return "سحب من الصراف دون بطاقة";
  return normalized;
}

function bankSelectionDisplayLabel(rawValue: string, locale: Locale) {
  const banks = parseIsraeliBankSelection(rawValue);
  if (!banks.length) return getIsraeliBankDisplayName(rawValue, locale);
  return banks.map((bank) => getIsraeliBankDisplayName(bank, locale)).join(locale === "ar" ? "، " : ", ");
}

function tradeStatusLabel(status: PurchaseRequest["status"], isAr: boolean, isOverdue = false, isCashTrade = false) {
  if (isCashTrade) {
    if (status === "accepted") return isAr ? "بانتظار تأكيد المشتري" : "Waiting for buyer confirmation";
    if (status === "payment_sent") return isAr ? "بانتظار تأكيد استلام النقد" : "Waiting for cash receipt confirmation";
    if (status === "funds_received" || status === "usdt_release_pending") return isAr ? "تم فتح المحفظة — بانتظار تأكيد إرسال USDT" : "Wallet revealed — waiting for USDT sent confirmation";
    if (status === "usdt_sent") return isAr ? "تم إرسال USDT — بانتظار إكمال البائع" : "USDT sent — waiting for seller completion";
  }
  if (status === "pending") return isAr ? "في انتظار القبول" : "Waiting for acceptance";
  if (status === "accepted") return isAr ? "في انتظار دفع المشتري" : "Waiting for buyer payment";
  if (status === "payment_sent") return isAr ? "في انتظار تأكيد البائع" : "Waiting for seller confirmation";
  if (status === "funds_received") return isAr ? "البائع أكّد استلام الأموال" : "Seller confirmed funds received";
  if (status === "usdt_release_pending" && isOverdue) return isAr ? "متأخرة — مهلة إصدار USDT انتهت" : "Overdue — USDT release deadline exceeded";
  if (status === "usdt_release_pending") return isAr ? "جاري إرسال USDT" : "USDT release in progress";
  if (status === "usdt_sent") return isAr ? "تم إرسال USDT — أكمل الصفقة" : "USDT sent — complete the trade";
  if (status === "review_open" || status === "completed" || status === "locked") return isAr ? "الصفقة مكتملة" : "Trade completed";
  if (status === "declined") return isAr ? "تم رفض الطلب" : "Request declined";
  if (status === "cancelled") return isAr ? "تم إلغاء الطلب" : "Request cancelled";
  return status;
}

function getStepId(status: PurchaseRequest["status"]): StepId {
  return STEP_ORDER[getTradeProgressIndex(status)].id;
}

export function getTradeProgressIndex(status: PurchaseRequest["status"]) {
  // Progress describes completed milestones, not the action still being requested.
  if (status === "accepted") return 1;
  if (status === "payment_sent") return 2;
  if (status === "funds_received" || status === "usdt_release_pending") return 3;
  if (status === "usdt_sent") return 4;
  if (COMPLETED_TRADE_STATUSES.has(status)) return 5;
  return 0;
}

export function getPrimaryAction(request: PurchaseRequest, actorUserId: string, isAr: boolean, sellerEvidenceRequired: boolean): PrimaryAction | null {
  const isSeller = request.sellerId === actorUserId;
  const isBuyer = request.buyerId === actorUserId;
  const isCashTrade = isCashTradePaymentMethod(request.paymentMethod);
  const isAtm = isCardlessAtmPaymentMethod(request.paymentMethod);
  if (!isSeller && !isBuyer) return null;
  if (request.termsProposal?.status === "pending") return null;

  if (request.status === "pending" && isSeller) {
    return {
      label: request.priceMode === "buyer_offer" ? (isAr ? "قبول عرض السعر" : "Accept Price Offer") : (isAr ? "قبول الطلب" : "Accept Trade"),
      successLabel: request.priceMode === "buyer_offer" ? (isAr ? "تم قبول عرض السعر" : "Price Offer Accepted") : (isAr ? "تم قبول الطلب" : "Trade Accepted"),
      mode: "status",
      nextStatus: "accepted",
      confirmationMessage: isAr ? `سترسل ${request.usdtAmount} USDT على شبكة ${request.network}. ${isAtm ? "بعد القبول تظهر بيانات السحب ويبدأ جمع النقد؛ لا يتاح الإلغاء العادي." : "هل توافق؟"}` : `You will send ${request.usdtAmount} USDT on ${request.network}. ${isAtm ? "Acceptance reveals the withdrawal details and starts cash collection; normal cancellation is no longer available." : "Accept these terms?"}`,
    };
  }

  if (isCashTrade && request.status === "accepted" && isBuyer) {
    return {
      label: isAtm
        ? (isAr ? "إرسال بيانات السحب وتأكيدها" : "Send & Confirm Withdrawal Details")
        : (isAr ? "سلّمت النقد للبائع" : "I Handed Over the Cash"),
      successLabel: isAtm
        ? (isAr ? "تم إرسال بيانات السحب" : "Withdrawal Details Sent")
        : (isAr ? "تم تأكيد تسليم النقد" : "Cash Handover Confirmed"),
      mode: "status",
      nextStatus: "payment_sent",
      confirmationMessage: isAtm
        ? (isAr
            ? "هل راجعت رمز السحب ورقم الهوية أو تاريخ الميلاد؟ سيتم إرسال البيانات للبائع الآن. بعد الإرسال لا يمكن الإلغاء العادي."
            : "Have you checked the withdrawal code and ID number or date of birth? Both details will be sent to the seller now. Normal cancellation is locked after submission.")
        : (isAr
            ? "أكد فقط بعد تسليم النقد المتفق عليه للبائع وجهًا لوجه. لا يلزم رفع صورة. بعد التأكيد لا يمكن إلغاء الصفقة العادية."
            : "Confirm only after handing the agreed cash to the seller in person. No photo is required. Normal cancellation is locked after confirmation."),
    };
  }

  if (isCashTrade && (request.status === "payment_sent" || (!isAtm && request.status === "accepted")) && isSeller) {
    return {
      label: isAtm
        ? (isAr ? "استلمت النقد من الصراف" : "I Collected the ATM Cash")
        : (isAr ? "استلمت النقد" : "I Received the Cash"),
      successLabel: isAr ? "تم تأكيد استلام النقد" : "Cash Receipt Confirmed",
      mode: "status",
      nextStatus: "funds_received",
      confirmationMessage: isAtm
        ? (isAr
            ? "أكد فقط بعد سحب النقد فعليًا من الصراف. بعد التأكيد سيظهر عنوان محفظة المشتري لإرسال USDT."
            : "Confirm only after you physically collect the cash from the ATM. The buyer wallet will be revealed after confirmation.")
        : (isAr
            ? "أكد فقط بعد استلام النقد فعليًا من المشتري. بعد التأكيد سيظهر عنوان محفظة المشتري لإرسال USDT."
            : "Confirm only after you physically receive the cash from the buyer. The buyer wallet will be revealed after confirmation."),
    };
  }

  if (isSeller && isSellerTradeCompletionAvailable(request.paymentMethod, request.status)) {
    return {
      label: isAr ? "تحديد الصفقة كمكتملة" : "Mark Trade as Completed",
      successLabel: isAr ? "تم إكمال الصفقة" : "Trade Completed",
      mode: "status",
      nextStatus: "completed",
      command: "complete_trade",
      confirmationMessage: request.feePolicyVersion === "buyer_seller_1pct_v1"
        ? `${isAr ? "أؤكد استلام الدفع وإرسال كامل USDT إلى محفظة المشتري الصحيحة. الإكمال نهائي." : "I confirm payment was received and the full USDT amount was sent to the correct buyer wallet. Completion is final."} ${sellerFeeResponsibilityNotice(isAr ? "ar" : "en")}`
        : request.status !== "usdt_sent"
        ? (isAr ? "أؤكد أنني استلمت النقد وأرسلت كامل USDT إلى محفظة المشتري على الشبكة الصحيحة. إكمال الصفقة يفتح التقييم ويسجل عمولة 1% ولا يمكن إلغاؤه. هل تريد الإكمال؟" : "I confirm I received the cash and sent the full USDT amount to the buyer wallet on the correct network. Completing opens feedback and records the 1% commission. This cannot be cancelled. Complete trade?")
        : isAr
        ? "لقد أكدت بالفعل إرسال USDT. سيؤدي هذا الإجراء النهائي إلى إكمال الصفقة وفتح التقييم وتسجيل عمولة 1%. لا يحتاج المشتري إلى تأكيد الاستلام، ولا يمكن التراجع أو الإلغاء بعد ذلك."
        : "You already confirmed USDT was sent. This final action completes the trade, opens review, and records the 1% commission. Buyer confirmation is not required, and this cannot be undone or cancelled.",
    };
  }

  if (isCashTrade && isSeller && isCashTradeUsdtSentConfirmationAvailable(request.paymentMethod, request.status)) {
    return {
      label: isAr ? "تأكيد إرسال USDT" : "Confirm USDT Sent",
      successLabel: isAr ? "تم تأكيد إرسال USDT" : "USDT Sent Confirmed",
      mode: "status",
      nextStatus: "usdt_sent",
      confirmationMessage: isAr
        ? "تحقق من الشبكة وعنوان محفظة المشتري والمبلغ الكامل. أكد فقط بعد إرسال كامل USDT. بعد التأكيد سيظهر زر منفصل لإكمال الصفقة، ولن يكون الإلغاء ممكنًا."
        : "Verify the network, buyer wallet, and full amount. Confirm only after sending all USDT. A separate completion button appears next, and cancellation remains unavailable.",
    };
  }

  if (isCashTrade && isBuyer && request.status === "usdt_sent") {
    return {
      label: isAr ? "تأكيد استلام USDT" : "Confirm USDT Received",
      successLabel: isAr ? "تم تأكيد الاستلام" : "Receipt Confirmed",
      mode: "status", nextStatus: "completed",
      confirmationMessage: isAr ? "أكد فقط بعد وصول كامل مبلغ USDT إلى محفظتك على الشبكة الصحيحة." : "Confirm only after the full USDT amount arrives in your wallet on the correct network.",
    };
  }
  // Cash trades never use evidence uploaders.
  if (isCashTrade) return null;

  if (request.status === "accepted" && isBuyer) {
    if (!request.buyerEvidence) {
      return {
        label: isAr ? "رفع إيصال الدفع" : "Upload Payment Receipt",
        successLabel: isAr ? "تم إرسال الدفع" : "Payment Submitted",
        mode: "upload",
        uploadSide: "buyer",
      };
    }
    return {
      label: isAr ? "إرسال الدفع" : "Submit Payment",
      successLabel: isAr ? "تم إرسال الدفع" : "Payment Submitted",
      mode: "status",
      nextStatus: "payment_sent",
      requiresEvidenceSide: "buyer",
    };
  }
  if (request.status === "payment_sent" && isSeller) {
    return {
      label: isAr ? "تأكيد استلام الأموال" : "Confirm Money Received",
      successLabel: isAr ? "تم تأكيد استلام الأموال" : "Money Received",
      mode: "status",
      nextStatus: "funds_received",
    };
  }
  if (request.status === "funds_received" && isSeller) {
    return {
      label: isAr ? "إصدار USDT" : "Release USDT",
      successLabel: isAr ? "بدأ إصدار USDT" : "USDT Release Started",
      mode: "status",
      nextStatus: "usdt_release_pending",
    };
  }
  if (request.status === "usdt_release_pending" && isSeller) {
    if (sellerEvidenceRequired && !request.sellerEvidence) {
      return {
        label: isAr ? "إصدار USDT" : "Release USDT",
        successLabel: isAr ? "تم إصدار USDT" : "USDT Released",
        mode: "upload",
        uploadSide: "seller",
      };
    }
    return {
      label: isAr ? "تأكيد إرسال USDT" : "Mark USDT Sent",
      successLabel: isAr ? "تم إصدار USDT" : "USDT Released",
      mode: "status",
      nextStatus: "usdt_sent",
      requiresEvidenceSide: sellerEvidenceRequired ? "seller" : undefined,
    };
  }
  if (request.status === "usdt_sent" && isBuyer) {
    return {
      label: isAr ? "تأكيد استلام USDT" : "Confirm USDT Received",
      successLabel: isAr ? "تم تأكيد استلام USDT" : "USDT Receipt Confirmed",
      mode: "status",
      nextStatus: "completed",
    };
  }
  return null;
}

function getWaitingEstimate(request: PurchaseRequest, isSeller: boolean, isAr: boolean, isOverdue: boolean) {
  const isCashTrade = isCashTradePaymentMethod(request.paymentMethod);
  const isAtm = isCardlessAtmPaymentMethod(request.paymentMethod);
  if (isCashTrade && request.status === "accepted") {
    return isSeller
      ? (isAtm ? (isAr ? "حتى يؤكد المشتري إرسال الرمز" : "Until the buyer confirms the code") : (isAr ? "استلم النقد ثم أكد الاستلام" : "Receive the cash, then confirm receipt"))
      : isAtm
        ? (isAr ? "أرسل الرمز ثم أكد فورًا" : "Send the code, then confirm now")
        : (isAr ? "سلّم النقد ثم أكد فورًا" : "Hand over cash, then confirm now");
  }
  if (isCashTrade && request.status === "payment_sent") {
    return isSeller
      ? (isAr ? "تحقق من النقد ثم أكد فورًا" : "Verify the cash, then confirm now")
      : (isAr ? "حتى يؤكد البائع استلام النقد" : "Until the seller confirms cash receipt");
  }
  if (isCashTrade && isCashTradeUsdtSentConfirmationAvailable(request.paymentMethod, request.status)) {
    return isSeller
      ? isFaceToFacePaymentMethod(request.paymentMethod)
        ? (isAr ? "أرسل USDT ثم أكمل الصفقة" : "Send USDT, then complete the trade")
        : (isAr ? "أرسل USDT ثم أكد الإرسال" : "Send USDT, then confirm it was sent")
      : (isAr ? "حتى يرسل البائع USDT ويؤكد الإرسال" : "Until the seller sends USDT and confirms it");
  }
  if (request.status === "usdt_sent") {
    return isSeller
      ? (isAr ? "أكمل الصفقة الآن" : "Complete the trade now")
      : (isAr ? "حتى يكمل البائع الصفقة" : "Until the seller completes the trade");
  }
  if (request.status === "pending") return isAr ? "حتى يراجع البائع الطلب" : "Until the seller reviews the request";
  if (request.status === "accepted") return isSeller
    ? (isAr ? "حتى يرسل المشتري إثبات الدفع" : "Until the buyer submits payment proof")
    : (isAr ? "نفّذ الدفع وارفع الإيصال الآن" : "Pay and upload the receipt now");
  if (request.status === "payment_sent") return isSeller
    ? (isAr ? "تحقق من حسابك الآن" : "Verify your account now")
    : (isAr ? "عادةً بضع دقائق للتحقق" : "Usually a few minutes for verification");
  if (request.status === "funds_received") return isSeller
    ? (isAr ? "ابدأ إصدار USDT الآن" : "Start the USDT release now")
    : (isAr ? "حتى يبدأ البائع الإصدار" : "Until the seller starts the release");
  if (request.status === "usdt_release_pending") {
    if (isOverdue) return isAr ? "المهلة منتهية — يلزم الإجراء فورًا" : "Deadline exceeded — action is required now";
    return isAr ? "ضمن مهلة إصدار مدتها 45 دقيقة" : "Within the 45-minute release window";
  }
  return isAr ? "لا يوجد وقت انتظار" : "No waiting time";
}

function getDeliveryConfirmation(request: PurchaseRequest, isAr: boolean) {
  if (request.status === "pending") {
    return isAr ? "تم إرسال إشعار للبائع. تتم معالجة البريد الإلكتروني في الخلفية." : "Seller notification sent. Email delivery is processed in the background.";
  }
  if (request.status === "accepted" || request.status === "declined") {
    return isAr ? "تم إرسال إشعار للمشتري. تتم معالجة البريد الإلكتروني في الخلفية." : "Buyer notification sent. Email delivery is processed in the background.";
  }
  if (request.status === "payment_sent") {
    return isAr ? "تم إرسال إشعار للبائع. تتم معالجة البريد الإلكتروني في الخلفية." : "Seller notification sent. Email delivery is processed in the background.";
  }
  if (request.status === "usdt_sent") {
    return isAr ? "تم إرسال إشعار للمشتري. تتم معالجة البريد الإلكتروني في الخلفية." : "Buyer notification sent. Email delivery is processed in the background.";
  }
  if (request.status === "review_open" || request.status === "completed" || request.status === "locked" || request.status === "cancelled") {
    return isAr ? "تم إرسال إشعار للطرفين. تتم معالجة البريد الإلكتروني في الخلفية." : "Both parties notified. Email delivery is processed in the background.";
  }
  return isAr ? "تتم مزامنة التحديثات مباشرة داخل غرفة الصفقة." : "Updates are synchronized live in the Trade Room.";
}

function getStatusBannerContent(request: PurchaseRequest, isSeller: boolean, isAr: boolean, primaryAction: PrimaryAction | null, isOverdue: boolean) {
  if (request.termsProposal?.status === "pending") return {
    icon: "↔", title: isAr ? "اقتراح تعديل الصفقة" : "Proposed trade terms",
    headline: isSeller ? (isAr ? "بانتظار رد المشتري" : "Waiting for buyer response") : (isAr ? "راجع اقتراح البائع" : "Review the seller's proposal"),
    detail: isAr ? "راجع الكمية والسعر والإجمالي أدناه قبل المتابعة." : "Review the exact amount, price and total below before continuing.",
    yourAction: isSeller ? (isAr ? "انتظر الرد أو اسحب الاقتراح" : "Wait for a response or withdraw") : (isAr ? "وافق أو ارفض الاقتراح" : "Accept or decline the proposal"),
    counterpartyAction: isSeller ? (isAr ? "المشتري يراجع الاقتراح" : "Buyer reviews the proposal") : (isAr ? "البائع ينتظر ردك" : "Seller waits for your response"),
    tradeStatus: isAr ? "بانتظار الموافقة" : "Awaiting agreement",
  };

  const isCashTrade = isCashTradePaymentMethod(request.paymentMethod);
  const isAtm = isCardlessAtmPaymentMethod(request.paymentMethod);
  const currentStatus = tradeStatusLabel(request.status, isAr, isOverdue, isCashTrade);
  if (isCashTrade && request.status === "accepted") {
    return isSeller
      ? {
          icon: isAtm ? "🏧" : "💵",
          title: isAtm ? (isAr ? "صفقة سحب دون بطاقة" : "Cardless ATM Trade") : (isAr ? "صفقة لقاء شخصي" : "Face-to-Face Trade"),
          headline: isAtm ? (isAr ? "بانتظار تأكيد المشتري" : "Waiting for Buyer Confirmation") : (isAr ? "أكد استلام النقد" : "Confirm Cash Receipt"),
          detail: isAtm
            ? (isAr ? "على المشتري إرسال رمز السحب ثم الضغط على زر التأكيد. لا يلزم رفع صورة." : "The buyer must send the withdrawal code, then tap confirmation. No photo is required.")
            : (isAr ? "بعد استلام النقد من المشتري يمكنك تأكيد الاستلام مباشرة. لا يلزم رفع صورة." : "After receiving the buyer’s cash, you can confirm receipt directly. No photo is required."),
          yourAction: isAtm ? (isAr ? "انتظر تأكيد المشتري" : "Wait for buyer confirmation") : (isAr ? "استلمت النقد" : "I Received the Cash"),
          counterpartyAction: isAtm ? (isAr ? "إرسال رمز السحب وتأكيده" : "Send and confirm the withdrawal code") : (isAr ? "تسليم النقد وتأكيده" : "Hand over and confirm the cash"),
          tradeStatus: currentStatus,
        }
      : {
          icon: isAtm ? "🏧" : "💵",
          title: isAtm ? (isAr ? "صفقة سحب دون بطاقة" : "Cardless ATM Trade") : (isAr ? "صفقة لقاء شخصي" : "Face-to-Face Trade"),
          headline: isAtm ? (isAr ? "أرسل رمز السحب ثم أكد" : "Send the Withdrawal Code, Then Confirm") : (isAr ? "سلّم النقد ثم أكد" : "Hand Over the Cash, Then Confirm"),
          detail: isAtm
            ? (isAr ? "بعد إرسال الرمز الصحيح للبائع اضغط الزر أدناه. لا يلزم رفع صورة." : "After sending the correct code to the seller, tap the button below. No photo is required.")
            : (isAr ? "بعد تسليم النقد للبائع وجهًا لوجه اضغط الزر أدناه. لا يلزم رفع صورة." : "After handing the cash to the seller in person, tap the button below. No photo is required."),
          yourAction: primaryAction?.label ?? (isAr ? "تأكيد التسليم" : "Confirm handover"),
          counterpartyAction: isAr ? "البائع ينتظر تأكيدك" : "Seller is waiting for your confirmation",
          tradeStatus: currentStatus,
        };
  }
  if (isCashTrade && request.status === "payment_sent") {
    return isSeller
      ? {
          icon: "✅",
          title: isAr ? "الإجراء المطلوب الآن" : "Action Required Now",
          headline: isAtm ? (isAr ? "اسحب النقد ثم أكد الاستلام" : "Collect the ATM Cash, Then Confirm") : (isAr ? "استلم النقد ثم أكد" : "Receive the Cash, Then Confirm"),
          detail: isAtm
            ? (isAr ? "لا تؤكد قبل خروج كامل المبلغ من الصراف. بعد التأكيد سيظهر عنوان محفظة المشتري." : "Do not confirm until the full amount is collected from the ATM. The buyer wallet appears after confirmation.")
            : (isAr ? "لا تؤكد قبل استلام كامل المبلغ فعليًا. بعد التأكيد سيظهر عنوان محفظة المشتري." : "Do not confirm until you physically receive the full amount. The buyer wallet appears after confirmation."),
          yourAction: primaryAction?.label ?? (isAr ? "تأكيد استلام النقد" : "Confirm cash received"),
          counterpartyAction: isAr ? "المشتري أكّد التسليم" : "Buyer confirmed the handover",
          tradeStatus: currentStatus,
        }
      : {
          icon: "⏳",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار البائع لتأكيد استلام النقد" : "Waiting for Seller to Confirm the Cash",
          detail: isAr ? "تم حفظ تأكيدك وإبلاغ البائع. لا يلزم رفع أي صورة." : "Your confirmation is saved and the seller was notified. No photo is required.",
          yourAction: isAr ? "لا يوجد إجراء الآن" : "No action now",
          counterpartyAction: isAr ? "البائع يتحقق من النقد" : "Seller is verifying the cash",
          tradeStatus: currentStatus,
        };
  }
  if (isCashTrade && isCashTradeUsdtSentConfirmationAvailable(request.paymentMethod, request.status)) {
    return isSeller
      ? {
          icon: "₮",
          title: isAr ? "الإجراء المطلوب الآن" : "Action Required Now",
          headline: isAr ? "المحفظة ظاهرة — أرسل USDT ثم أكد" : "Wallet Revealed — Send USDT, Then Confirm",
          detail: isFaceToFacePaymentMethod(request.paymentMethod)
            ? (isAr ? "أرسل كامل USDT إلى المحفظة أدناه، ثم أكمل الصفقة. لا يلزم انتظار المشتري أو رفع صورة." : "Send the full USDT amount to the wallet below, then complete the trade. No buyer wait or photo is required.")
            : (isAr ? "أرسل كامل USDT إلى المحفظة أدناه، ثم أكد الإرسال." : "Send the full USDT amount to the wallet below, then confirm it was sent."),
          yourAction: primaryAction?.label ?? (isAr ? "تأكيد إرسال USDT" : "Confirm USDT Sent"),
          counterpartyAction: isAr ? "المشتري ينتظر USDT" : "Buyer is waiting for USDT",
          tradeStatus: currentStatus,
        }
      : {
          icon: "⏳",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار البائع لإرسال USDT" : "Waiting for Seller to Send USDT",
          detail: isAr ? "أكد البائع استلام النقد وظهر له عنوان محفظتك. سيرسل USDT ثم يؤكد الإرسال." : "The seller confirmed the cash and can now see your wallet. The seller will send USDT and confirm it was sent.",
          yourAction: isAr ? "تحقق من محفظتك" : "Watch your wallet",
          counterpartyAction: isAr ? "البائع يرسل USDT ثم يؤكد" : "Seller sends USDT, then confirms",
          tradeStatus: currentStatus,
        };
  }
  if (request.status === "usdt_sent") {
    return isSeller
      ? {
          icon: "✅",
          title: isAr ? "الإجراء النهائي" : "Final Seller Action",
          headline: isAr ? "تم تأكيد إرسال USDT — أكمل الصفقة" : "USDT Sent Confirmed — Complete the Trade",
          detail: isAr ? "تم حفظ تأكيد إرسال USDT. اضغط الزر أدناه لإكمال الصفقة وفتح التقييم. لا يلزم انتظار المشتري، ولا يمكن الإلغاء." : "Your USDT-sent confirmation is saved. Tap below to complete the trade and open feedback. You do not need to wait for the buyer, and cancellation is unavailable.",
          yourAction: primaryAction?.label ?? (isAr ? "تحديد الصفقة كمكتملة" : "Mark Trade as Completed"),
          counterpartyAction: isAr ? "لا يلزم تأكيد المشتري" : "No buyer confirmation required",
          tradeStatus: currentStatus,
        }
      : {
          icon: "⏳",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "أكد البائع إرسال USDT" : "Seller Confirmed USDT Sent",
          detail: isAr ? "تحقق من محفظتك. يمكنك تأكيد الاستلام الآن، أو يستطيع البائع إكمال الصفقة دون انتظارك." : "Check your wallet. You can confirm receipt now, or the seller can complete the trade independently.",
          yourAction: isAr ? "تأكيد استلام USDT" : "Confirm USDT Received",
          counterpartyAction: isAr ? "البائع يكمل الصفقة" : "Seller completes the trade",
          tradeStatus: currentStatus,
        };
  }
  if (request.status === "pending") {
    return isSeller
      ? {
          icon: "🤝",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار قبولك للطلب" : "Waiting for You to Accept the Trade",
          detail: isAr ? "بمجرد القبول سيُفتح مسار الصفقة للمشتري." : "Once you accept, the buyer can begin the guided trade flow.",
          yourAction: primaryAction?.label ?? (isAr ? "قبول الطلب" : "Accept Trade"),
          counterpartyAction: isAr ? "المشتري بانتظار موافقتك" : "Buyer is waiting for your approval",
          tradeStatus: currentStatus,
        }
      : {
          icon: "⏳",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار البائع لمراجعة الطلب" : "Waiting for Seller to Review the Request",
          detail: isAr ? "سوف تتلقى تحديثًا فور قبول البائع." : "You will be updated as soon as the seller accepts.",
          yourAction: isAr ? "لا يوجد إجراء الآن" : "No action yet",
          counterpartyAction: isAr ? "البائع يراجع الطلب" : "Seller is reviewing the request",
          tradeStatus: currentStatus,
        };
  }
  if (request.status === "accepted") {
    return isSeller
      ? {
          icon: "💳",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار المشتري لرفع الإيصال" : "Waiting for Buyer to Upload Receipt",
          detail: isAr ? "بعد رفع الإيصال سيتم إبلاغك لتأكيد استلام الأموال." : "Once the receipt is uploaded, you’ll be prompted to confirm the money was received.",
          yourAction: isAr ? "انتظر تحديث المشتري" : "Wait for buyer update",
          counterpartyAction: request.buyerEvidence
            ? (isAr ? "المشتري أرسل الإيصال" : "Buyer has uploaded the payment receipt")
            : (isAr ? "المشتري يجب أن يرفع الإيصال" : "Buyer needs to upload the payment receipt"),
          tradeStatus: currentStatus,
        }
      : {
          icon: "🧾",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "ارفع إيصال الدفع للمتابعة" : "Upload Your Payment Receipt to Continue",
          detail: isAr ? "أرسل الدفع باستخدام تفاصيل دفع البائع، ثم ارفع الإيصال." : "Send payment using the seller's payment details, then upload the receipt.",
          yourAction: primaryAction?.label ?? (isAr ? "رفع إيصال الدفع" : "Upload Payment Receipt"),
          counterpartyAction: isAr ? "البائع بانتظار إثبات الدفع" : "Seller is waiting for your payment proof",
          tradeStatus: currentStatus,
        };
  }
  if (request.status === "payment_sent") {
    return isSeller
      ? {
          icon: "✅",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "أكد استلام الأموال" : "Confirm Money Received",
          detail: isAr ? "تحقق من وصول الدفع إلى حسابك البنكي. لا ترسل USDT قبل التأكد." : "Verify payment has arrived in your bank account. Do not release USDT until it is confirmed.",
          yourAction: primaryAction?.label ?? (isAr ? "تأكيد استلام الأموال" : "Confirm Money Received"),
          counterpartyAction: isAr ? "المشتري أرسل الدفع" : "Buyer has already submitted payment",
          tradeStatus: currentStatus,
        }
      : {
          icon: "⏳",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار البائع لتأكيد الدفع" : "Waiting for Seller to Confirm Payment",
          detail: isAr ? "إثباتك محفوظ وتم إبلاغ البائع." : "Your proof is saved and the seller has been notified.",
          yourAction: isAr ? "لا يوجد إجراء الآن" : "No action now",
          counterpartyAction: isAr ? "البائع يجب أن يؤكد استلام الأموال" : "Seller needs to confirm the money was received",
          tradeStatus: currentStatus,
        };
  }
  if (request.status === "funds_received") {
    return isSeller
      ? {
          icon: "₮",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "إصدار USDT هو الإجراء التالي" : "Release USDT is the Next Step",
          detail: isAr ? "أرسل USDT المشتراة فقط إلى محفظة المشتري المعروضة أدناه." : "Send the purchased USDT ONLY to the buyer wallet shown below.",
          yourAction: primaryAction?.label ?? (isAr ? "إصدار USDT" : "Release USDT"),
          counterpartyAction: isAr ? "المشتري بانتظار تحويل USDT" : "Buyer is waiting for USDT release",
          tradeStatus: currentStatus,
        }
      : {
          icon: "⏳",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار البائع لإصدار USDT" : "Waiting for Seller to Release USDT",
          detail: isAr ? "تم تأكيد استلام الأموال. سيبدأ عدّاد الإصدار عند تحرك البائع." : "Funds were confirmed. The release timer starts when the seller begins the release step.",
          yourAction: isAr ? "لا يوجد إجراء الآن" : "No action now",
          counterpartyAction: isAr ? "البائع سيبدأ إصدار USDT" : "Seller will begin USDT release",
          tradeStatus: currentStatus,
        };
  }
  if (request.status === "usdt_release_pending") {
    return isSeller
      ? {
          icon: "🚀",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "أكمل إصدار USDT الآن" : "Finish Releasing USDT Now",
          detail: isAr ? "أرسل USDT فقط إلى المحفظة أدناه، ثم ارفع الإثبات وأكمل المرحلة." : "Send USDT ONLY to the wallet shown below, then upload proof and complete the release.",
          yourAction: primaryAction?.label ?? (isAr ? "إصدار USDT" : "Release USDT"),
          counterpartyAction: isAr ? "المشتري بانتظار التأكيد النهائي" : "Buyer is waiting for your final confirmation",
          tradeStatus: currentStatus,
        }
      : {
          icon: "⏳",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار البائع لإنهاء إصدار USDT" : "Waiting for Seller to Finish Releasing USDT",
          detail: isAr ? "البائع في مرحلة الإصدار الآن." : "The seller is currently completing the release step.",
          yourAction: isAr ? "لا يوجد إجراء الآن" : "No action now",
          counterpartyAction: isAr ? "البائع ينهي إصدار USDT" : "Seller is finishing the USDT release",
          tradeStatus: currentStatus,
        };
  }
  if (request.status === "declined") {
    return {
      icon: "✕",
      title: isAr ? "الحالة النهائية" : "Final Status",
      headline: isAr ? "رفض البائع طلب الصفقة" : "Seller Rejected the Trade Request",
      detail: isAr ? "تم إغلاق الطلب ولم تعد هناك أي دفعة مطلوبة." : "The request is closed and no payment is required.",
      yourAction: isAr ? "ارجع إلى السوق لاختيار عرض آخر" : "Return to the marketplace to choose another listing",
      counterpartyAction: isAr ? "لا يوجد إجراء مطلوب" : "No further action is required",
      tradeStatus: currentStatus,
    };
  }
  if (request.status === "cancelled") {
    return {
      icon: "✕",
      title: isAr ? "الحالة النهائية" : "Final Status",
      headline: isAr ? "تم إلغاء الصفقة" : "Trade Cancelled",
      detail: isAr ? "تم إغلاق الصفقة وإيقاف جميع الخطوات التالية." : "The trade is closed and all remaining steps have stopped.",
      yourAction: isAr ? "ارجع إلى السوق عندما تكون مستعدًا" : "Return to the marketplace when you are ready",
      counterpartyAction: isAr ? "لا يوجد إجراء مطلوب" : "No further action is required",
      tradeStatus: currentStatus,
    };
  }
  return {
    icon: "⭐",
    title: isAr ? "الحالة الحالية" : "Current Status",
    headline: isAr ? "اكتملت الصفقة" : "Trade Completed",
    detail: isAr ? "يمكنك الآن مراجعة السجل أو تقييم الطرف الآخر." : "You can now review the trade history or leave feedback.",
    yourAction: isAr ? "لا يوجد إجراء الآن" : "No action now",
    counterpartyAction: isAr ? "تم إكمال جميع الخطوات" : "All steps are complete",
    tradeStatus: currentStatus,
  };
}

function getTurnPanel(request: PurchaseRequest, isSeller: boolean, isAr: boolean) {
  if (request.status === "declined" || request.status === "cancelled") {
    return {
      isYourTurn: false,
      title: isAr ? "تم إغلاق الصفقة" : "TRADE CLOSED",
      detail: isAr ? "لا يوجد إجراء مطلوب لهذه الصفقة." : "No further action is available for this trade.",
    };
  }
  if (request.status === "review_open" || request.status === "completed" || request.status === "locked") {
    return {
      isYourTurn: false,
      title: isAr ? "اكتملت الصفقة" : "TRADE COMPLETE",
      detail: isAr ? "تمت العملية بنجاح ويمكنك مراجعة السجل." : "The trade finished successfully and is now in history/review state.",
    };
  }

  const isCashTrade = isCashTradePaymentMethod(request.paymentMethod);
  const isAtm = isCardlessAtmPaymentMethod(request.paymentMethod);
  if (isCashTrade && request.status === "accepted") {
    return isSeller
      ? {
          isYourTurn: !isAtm,
          title: isAtm ? (isAr ? "بانتظار المشتري" : "WAITING FOR BUYER") : (isAr ? "دورك الآن" : "YOUR TURN"),
          detail: isAtm ? (isAr ? "المشتري سيرسل رمز السحب ثم يؤكده." : "Buyer will send and confirm the withdrawal code.") : (isAr ? "أكد الاستلام بعد استلام النقد فعلياً من المشتري." : "Confirm receipt after physically receiving the buyer’s cash."),
        }
      : {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAtm ? (isAr ? "أرسل رمز السحب ثم أكد بالزر. لا صورة مطلوبة." : "Send the withdrawal code, then confirm with the button. No photo is needed.") : (isAr ? "سلّم النقد ثم أكد بالزر. لا صورة مطلوبة." : "Hand over the cash, then confirm with the button. No photo is needed."),
        };
  }
  if (isCashTrade && request.status === "payment_sent") {
    return isSeller
      ? {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAtm ? (isAr ? "اسحب النقد من الصراف ثم أكد الاستلام." : "Collect the ATM cash, then confirm receipt.") : (isAr ? "استلم النقد ثم أكد الاستلام." : "Receive the cash, then confirm receipt."),
        }
      : {
          isYourTurn: false,
          title: isAr ? "بانتظار البائع" : "WAITING FOR SELLER",
          detail: isAr ? "البائع يتحقق من استلام النقد." : "Seller is verifying the cash receipt.",
        };
  }
  if (isCashTrade && isCashTradeUsdtSentConfirmationAvailable(request.paymentMethod, request.status)) {
    return isSeller
      ? {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isFaceToFacePaymentMethod(request.paymentMethod)
            ? (isAr ? "ظهر عنوان المحفظة. أرسل كامل USDT ثم حدّد الصفقة كمكتملة؛ لا صورة مطلوبة." : "The wallet is revealed. Send the full USDT amount, then mark the trade completed; no photo is needed.")
            : (isAr ? "ظهر عنوان المحفظة. أرسل USDT ثم أكد الإرسال؛ لا صورة مطلوبة." : "The wallet is revealed. Send USDT, then confirm it was sent; no photo is needed."),
        }
      : {
          isYourTurn: false,
          title: isAr ? "بانتظار البائع" : "WAITING FOR SELLER",
          detail: isAr ? "البائع يرسل USDT وسيؤكد الإرسال بعد ذلك." : "Seller is sending USDT and will confirm it afterward.",
        };
  }
  if (request.status === "usdt_sent") {
    return isSeller
      ? {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAr ? "تم تأكيد إرسال USDT. أكمل الصفقة الآن؛ لا تنتظر المشتري." : "USDT sent is confirmed. Complete the trade now; do not wait for the buyer.",
        }
      : {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAr ? "تحقق من محفظتك ثم أكد استلام USDT." : "Check your wallet, then confirm USDT received.",
        };
  }

  if (request.status === "pending") {
    return isSeller
      ? {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAr ? "راجع الطلب ثم اقبله لبدء الصفقة." : "Review the request and accept it to start the trade.",
        }
      : {
          isYourTurn: false,
          title: isAr ? "بانتظار البائع" : "WAITING FOR SELLER",
          detail: isAr ? "البائع يراجع طلبك الآن." : "Seller is reviewing your request.",
        };
  }

  if (request.status === "accepted") {
    return isSeller
      ? {
          isYourTurn: false,
          title: isAr ? "بانتظار المشتري" : "WAITING FOR BUYER",
          detail: isAr ? "المشتري سيرفع إيصال الدفع ثم يرسل تأكيد الدفع." : "Buyer will upload the payment receipt, then submit payment.",
        }
      : {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAr ? "ارفع إيصال الدفع ثم أرسل تأكيد الدفع." : "Upload the payment receipt, then submit payment.",
        };
  }

  if (request.status === "payment_sent") {
    return isSeller
      ? {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAr ? "تحقق من الدفعة ثم أكد الاستلام." : "Verify payment and confirm funds received.",
        }
      : {
          isYourTurn: false,
          title: isAr ? "بانتظار البائع" : "WAITING FOR SELLER",
          detail: isAr ? "البائع يتحقق من الدفعة الآن." : "Seller is verifying your payment.",
        };
  }

  if (request.status === "funds_received" || request.status === "usdt_release_pending") {
    return isSeller
      ? {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAr ? "أكمل إرسال USDT ثم أكد الإرسال." : "Complete USDT release and mark it sent.",
        }
      : {
          isYourTurn: false,
          title: isAr ? "بانتظار البائع" : "WAITING FOR SELLER",
          detail: isAr ? "البائع ينفذ إرسال USDT." : "Seller is processing USDT release.",
        };
  }

  return isSeller
    ? {
        isYourTurn: false,
        title: isAr ? "بانتظار المشتري" : "WAITING FOR BUYER",
        detail: isAr ? "المشتري يؤكد استلام USDT." : "Buyer needs to confirm USDT receipt.",
      }
    : {
        isYourTurn: true,
        title: isAr ? "دورك الآن" : "YOUR TURN",
        detail: isAr ? "تحقق من وصول USDT ثم أكد الاستلام." : "Verify USDT arrived and confirm receipt.",
      };
}

function timelineStepForEvent(event: TradeTimelineEntry): StepId {
  if (event.type === "request_submitted" || event.type === "price_offer_submitted") return "request";
  if (event.type === "request_accepted" || event.type === "price_offer_accepted") return "accepted";
  if (event.type === "payment_sent" || event.type === "buyer_evidence_uploaded") return "payment";
  if (event.type === "bank_details_revealed" || event.type === "trade_inactivity_warning_sent") return "payment";
  if (event.type === "seller_confirmed_funds") return "verifying";
  if (event.type === "usdt_release_started" || event.type === "usdt_sent" || event.type === "seller_evidence_uploaded") return "release";
  if (event.type === "trade_closed_manually") return "completed";
  return "completed";
}

function timelineEventLabel(event: TradeTimelineEntry, isAr: boolean) {
  if (isAr) {
    const labels: Record<TradeTimelineEntry["type"], string> = {
      request_submitted: "تم إرسال طلب الشراء",
      price_offer_submitted: "تم إرسال عرض السعر",
      request_accepted: "وافق البائع على الطلب",
      price_offer_accepted: "وافق البائع على عرض السعر",
      payment_sent: "أكد المشتري إرسال الدفعة",
      seller_confirmed_funds: "أكد البائع استلام الدفعة",
      usdt_release_started: "بدأ البائع إرسال USDT",
      usdt_sent: "أكد البائع إرسال USDT",
      trade_completed: "اكتملت الصفقة بنجاح",
      trade_timed_out: "انتهت مهلة الصفقة",
      trade_locked: "تم إغلاق الصفقة",
      review_unlocked: "أصبح بإمكانك إضافة تقييم",
      dispute_opened: "تم فتح نزاع لهذه الصفقة",
      dispute_resolved: "تم حل النزاع ويمكن متابعة الصفقة",
      commission_recorded: "تم تسجيل عمولة الصفقة",
      commission_paid: "تم دفع عمولة الصفقة",
      buyer_evidence_uploaded: "رفع المشتري إثبات الدفع",
      seller_evidence_uploaded: "رفع البائع إثبات إرسال USDT",
      request_declined: "رفض البائع الطلب",
      price_offer_declined: "رفض البائع عرض السعر",
      request_cancelled: "تم إلغاء الطلب",
      buyer_confirmed_receipt: "أكد المشتري استلام USDT",
      buyer_confirmation_overdue: "تأخر تأكيد المشتري",
      trade_closed_manually: "تم إغلاق الصفقة يدويًا",
      trade_inactivity_warning_sent: "تم إرسال تحذير بسبب عدم النشاط في الصفقة",
      bank_details_revealed: "تم فتح تفاصيل الحساب البنكي داخل غرفة الصفقة",
    };
    return labels[event.type];
  }
  if (event.type === "bank_details_revealed") {
    return "Trade bank details viewed in the trade room";
  }
  if (event.type === "trade_inactivity_warning_sent") {
    return "Inactivity warning was sent for this trade";
  }
  if (event.type === "trade_closed_manually") {
    return "Trade closed manually";
  }
  return event.message;
}

export function groupTradeTimelineEntries(entries: TradeTimelineEntry[], isAr: boolean) {
  const groups: Array<{ event: TradeTimelineEntry; count: number }> = [];
  const newestFirst = [...entries].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  for (const event of newestFirst) {
    const previous = groups.at(-1);
    if (
      previous
      && previous.event.type === event.type
      && timelineEventLabel(previous.event, isAr) === timelineEventLabel(event, isAr)
    ) {
      previous.count += 1;
      continue;
    }
    groups.push({ event, count: 1 });
  }

  return groups;
}

function encodeFileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read file."));
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function applyRequestToRoom(room: TradeRoomData, nextRequest: PurchaseRequest): TradeRoomData {
  const deadlineAt = nextRequest.usdtReleaseDeadlineAt ?? null;
  const timeRemainingSeconds = deadlineAt ? Math.max(0, Math.floor((new Date(deadlineAt).getTime() - Date.now()) / 1000)) : null;
  const releaseDeadlineActive = nextRequest.status === "usdt_release_pending";
  const releaseDeadlineOverdue = Boolean(releaseDeadlineActive && timeRemainingSeconds !== null && timeRemainingSeconds <= 0);
  const isOverdue = releaseDeadlineOverdue || nextRequest.timeoutReason === "USDT release SLA expired.";
  return {
    ...room,
    request: nextRequest,
    deadlineAt,
    timeRemainingSeconds,
    releaseDeadlineActive,
    releaseDeadlineOverdue,
    isOverdue,
  };
}

export function tradeRoomSnapshotSignature(room: TradeRoomData) {
  const messages = room.messages ?? [];
  const messageSignature = messages
    .map((message) => [
      message.id,
      message.createdAt,
      message.sentAt ?? "",
      message.deliveredAt ?? "",
      message.seenAt ?? "",
      message.deletedAt ?? "",
      message.imageUrl ?? "",
      message.readByUserIds.join(","),
    ].join("~"))
    .join("^");
  const timelineSignature = (room.request.timeline ?? [])
    .map((entry) => [entry.id, entry.type, entry.createdAt, entry.message].join("~"))
    .join("^");
  return [
    room.request.id,
    room.request.status,
    room.request.updatedAt,
    room.request.completedAt ?? "",
    room.request.buyerEvidence?.id ?? "",
    room.request.sellerEvidence?.id ?? "",
    room.counterpart.buyerPublicId ?? "",
    room.counterpart.sellerPublicId ?? "",
    messageSignature,
    timelineSignature,
    room.deadlineAt ?? "",
    room.sellerCommissionDueAmount,
    room.sellerCommissionDueCount,
    room.sellerPayableCommissionId ?? "",
    room.sellerPayableCommissionAmount ?? 0,
    room.hasOpenDispute,
    room.canOpenDispute,
    room.poke?.available ?? false,
    room.poke?.canPoke ?? false,
    room.poke?.cooldownUntil ?? "",
    room.poke?.cooldownRemainingSeconds ?? 0,
    room.poke?.counterpartRole ?? "",
  ].join("|");
}

function applyOptimisticStatusFields(nextRequest: PurchaseRequest, nextStatus: PrimaryStatus, now: Date) {
  const nowIso = now.toISOString();
  const requestStatus = nextStatus === "completed" ? "review_open" : nextStatus;
  nextRequest.status = requestStatus;
  nextRequest.updatedAt = nowIso;
  if (nextStatus === "payment_sent") nextRequest.paymentSentAt = nowIso;
  if (nextStatus === "funds_received") nextRequest.fundsReceivedAt = nowIso;
  if (nextStatus === "usdt_release_pending") {
    nextRequest.usdtReleaseStartedAt = nowIso;
    nextRequest.usdtReleaseDeadlineAt = new Date(now.getTime() + 45 * 60 * 1000).toISOString();
  }
  if (nextStatus === "usdt_sent") nextRequest.usdtSentAt = nowIso;
  if (nextStatus === "completed") {
    nextRequest.completedAt = nowIso;
    nextRequest.lockedAt = nowIso;
    nextRequest.reviewUnlockedAt = nowIso;
  }
}

function buildOptimisticRoom(
  room: TradeRoomData,
  nextStatus: PrimaryStatus,
  actor: ActorSession,
  command?: StatusPrimaryAction["command"],
) {
  const now = new Date();
  const nextRequest: PurchaseRequest = {
    ...room.request,
    timeline: [...(room.request.timeline ?? [])],
  };
  applyOptimisticStatusFields(nextRequest, nextStatus, now);
  const timelineByStatus: Record<PrimaryStatus, Pick<TradeTimelineEntry, "type" | "message">> = {
    accepted: { type: "request_accepted", message: "Seller accepted request" },
    declined: { type: "request_declined", message: "Seller declined request" },
    payment_sent: { type: "payment_sent", message: "Buyer marked payment sent" },
    funds_received: { type: "seller_confirmed_funds", message: "Seller confirmed funds received" },
    usdt_release_pending: { type: "usdt_release_started", message: "Seller started USDT release" },
    usdt_sent: { type: "usdt_sent", message: "Seller marked USDT sent" },
    completed: { type: "buyer_confirmed_receipt", message: "Buyer confirmed USDT receipt" },
  };
  const cashTrade = isCashTradePaymentMethod(room.request.paymentMethod);
  const cardlessAtm = isCardlessAtmPaymentMethod(room.request.paymentMethod);
  const timelineEvent = command === "complete_trade"
    ? { type: "trade_completed" as const, message: "Seller confirmed trade completed" }
    : command === "complete_cash_trade"
    ? { type: "trade_completed" as const, message: `Seller marked the ${cardlessAtm ? "Cardless ATM" : "Face-to-Face"} trade complete.` }
    : cashTrade && nextStatus === "payment_sent"
      ? { type: "payment_sent" as const, message: cardlessAtm ? "Buyer confirmed the cardless withdrawal code was sent" : "Buyer confirmed the cash was handed to the seller" }
      : cashTrade && nextStatus === "funds_received"
        ? { type: "seller_confirmed_funds" as const, message: cardlessAtm ? "Seller confirmed ATM cash collected" : "Seller confirmed cash received" }
        : timelineByStatus[nextStatus];
  nextRequest.timeline.push({
    id: `optimistic-${nextStatus}-${now.getTime()}`,
    type: timelineEvent.type,
    actorUserId: actor.id,
    actorRole: actor.role,
    message: timelineEvent.message,
    createdAt: now.toISOString(),
  });
  return applyRequestToRoom(room, nextRequest);
}

export function resolveTradeRoomGuidanceTarget(input: {
  priorState: string | null;
  currentState: string;
  status: PurchaseRequest["status"];
  action: string | null;
  hash: string | null;
}): TradeRoomDeepLinkTarget {
  const currentTarget = "action-required";
  // A live transition supersedes the URL that originally opened the room.
  if (input.priorState && input.priorState !== input.currentState) return currentTarget;
  return resolveDeepLinkTarget(input.action, input.hash) ?? currentTarget;
}

function resolveDeepLinkTarget(actionParam: string | null, hash: string | null): TradeRoomDeepLinkTarget | null {
  // Existing notification URLs may still carry #evidence. Upload controls now
  // belong to the current step, so those action links must land there too.
  if (actionParam === "upload-payment-receipt" || actionParam === "upload-seller-evidence") return "action-required";
  const normalizedHash = hash?.trim().replace(/^#/, "") || "";
  if (normalizedHash === "status-banner" || normalizedHash === "action-required" || normalizedHash === "evidence" || normalizedHash === "chat") {
    return normalizedHash;
  }
  if (!actionParam) return null;
  if (actionParam === "accept-trade"
    || actionParam === "confirm-cash-payment"
    || actionParam === "confirm-money-received"
    || actionParam === "release-usdt"
    || actionParam === "confirm-usdt-sent"
    || actionParam === "complete-cash-trade"
    || actionParam === "send-usdt-complete"
    || actionParam === "confirm-usdt-received") {
    return "action-required";
  }
  return "status-banner";
}

function timestampOrNull(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function latestTradeRoomActivityAt(room: TradeRoomData) {
  const timestamps = [
    timestampOrNull(room.request.updatedAt),
    timestampOrNull(room.request.completedAt),
    timestampOrNull(room.request.buyerEvidence?.uploadedAt),
    timestampOrNull(room.request.sellerEvidence?.uploadedAt),
    ...room.messages
      .filter((message) => !message.id.startsWith("optimistic-"))
      .map((message) => timestampOrNull(message.createdAt)),
    ...(room.request.timeline ?? [])
      .filter((entry) => !entry.id.startsWith("optimistic-"))
      .map((entry) => timestampOrNull(entry.createdAt)),
  ].filter((timestamp): timestamp is number => timestamp !== null);
  return timestamps.length ? Math.max(...timestamps) : null;
}

export function shouldIgnoreRegressiveSnapshot(currentRoom: TradeRoomData, incomingRoom: TradeRoomData, completionLocked: boolean) {
  const currentStatus = currentRoom.request.status;
  const incomingStatus = incomingRoom.request.status;
  const currentIsCompleted = COMPLETED_TRADE_STATUSES.has(currentStatus);
  const incomingIsCompleted = COMPLETED_TRADE_STATUSES.has(incomingStatus);
  const currentActivityAt = latestTradeRoomActivityAt(currentRoom);
  const incomingActivityAt = latestTradeRoomActivityAt(incomingRoom);

  if (currentActivityAt !== null && incomingActivityAt !== null && incomingActivityAt < currentActivityAt) {
    return true;
  }

  if (completionLocked && currentIsCompleted && !incomingIsCompleted) {
    return true;
  }

  if (currentIsCompleted && !incomingIsCompleted) {
    const currentCompletedAtMs = timestampOrNull(currentRoom.request.completedAt);
    const incomingCompletedAtMs = timestampOrNull(incomingRoom.request.completedAt);
    if (currentCompletedAtMs !== null && (incomingCompletedAtMs === null || incomingCompletedAtMs < currentCompletedAtMs)) {
      return true;
    }
    const currentUpdatedAtMs = timestampOrNull(currentRoom.request.updatedAt);
    const incomingUpdatedAtMs = timestampOrNull(incomingRoom.request.updatedAt);
    if (currentUpdatedAtMs !== null && incomingUpdatedAtMs !== null && incomingUpdatedAtMs < currentUpdatedAtMs) {
      return true;
    }
  }

  return false;
}

export function mergeTradeRoomMessages(
  messages: TradeChatMessage[],
  incomingMessage: TradeChatMessage,
  optimisticMessageId?: string,
) {
  const byId = new Map<string, TradeChatMessage>();
  for (const message of messages) {
    if (message.id !== optimisticMessageId) byId.set(message.id, message);
  }
  byId.set(incomingMessage.id, incomingMessage);
  return [...byId.values()].sort((left, right) => {
    const leftTimestamp = timestampOrNull(left.createdAt) ?? 0;
    const rightTimestamp = timestampOrNull(right.createdAt) ?? 0;
    return leftTimestamp - rightTimestamp || left.id.localeCompare(right.id);
  });
}

/**
 * Server snapshots remain authoritative for trade lifecycle, Poke, and
 * counterparty activity even while the local user has one optimistic chat
 * message awaiting its POST response. Preserve only that temporary bubble;
 * never retain a stale request/timeline/poke snapshot wholesale.
 */
export function mergeTradeRoomSnapshotPreservingOptimisticMessages(
  currentRoom: TradeRoomData,
  incomingRoom: TradeRoomData,
) {
  const optimisticMessages = (currentRoom.messages ?? []).filter((message) => message.id.startsWith("optimistic-"));
  if (!optimisticMessages.length) return incomingRoom;

  let messages = [...(incomingRoom.messages ?? [])];
  for (const optimisticMessage of optimisticMessages) {
    const alreadyConfirmed = messages.some((message) => (
      message.id === optimisticMessage.id
      || (Boolean(optimisticMessage.clientMessageId)
        && message.clientMessageId === optimisticMessage.clientMessageId
        && message.senderUserId === optimisticMessage.senderUserId
        && message.purchaseRequestId === optimisticMessage.purchaseRequestId)
    ));
    if (!alreadyConfirmed) {
      messages = mergeTradeRoomMessages(messages, optimisticMessage);
    }
  }
  return { ...incomingRoom, messages };
}

export function shouldRestartTradeRoomStreamAfterPageShow(event: Pick<PageTransitionEvent, "persisted">) {
  return event.persisted;
}

export function getTradeRoomReconnectDelayMs(attempt: number) {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    TRADE_ROOM_RECONNECT_BASE_MS * (2 ** Math.min(safeAttempt - 1, 4)),
    TRADE_ROOM_RECONNECT_MAX_MS,
  );
}

export function revealTradeRoomDeepLinkTarget(target: HTMLElement) {
  const header = document.querySelector<HTMLElement>("header");
  const headerBottom = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
  const rect = target.getBoundingClientRect();
  const viewportTop = window.visualViewport?.offsetTop ?? 0;
  const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
  const desiredTop = Math.max(headerBottom, viewportTop) + 16;
  const visibleBottom = rect.top + Math.min(rect.height, 160);
  if (rect.top < desiredTop || visibleBottom > viewportBottom - 24) {
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - desiredTop), behavior: "auto" });
  }
  target.focus({ preventScroll: true });
}

export function isTradeRoomChatNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number) {
  return scrollHeight - scrollTop - clientHeight <= 80;
}

export function shouldAutoScrollTradeRoomChat(wasNearBottom: boolean, forceScroll: boolean) {
  return wasNearBottom || forceScroll;
}

export function shouldShowTradeRoomNewMessageIndicator(input: {
  initialized: boolean;
  wasNearBottom: boolean;
  hasNewCounterpartyMessage: boolean;
}) {
  return input.initialized && !input.wasNearBottom && input.hasNewCounterpartyMessage;
}

export function getTradeRoomSessionKey(actorUserId: string, requestId: string) {
  return `${actorUserId}:${requestId}`;
}

export function canRevealTradeRoomBankDetails(request: PurchaseRequest | null, isSeller: boolean) {
  return Boolean(
    request
    && !isSeller
    && Boolean(request.sellerBankAccountId)
    && isBankTransferPaymentMethod(request.paymentMethod)
    && request.status !== "pending"
    && request.status !== "declined"
    && request.status !== "cancelled",
  );
}

export function TradeRoomPage(props: TradeRoomPageProps) {
  const searchParams = useSearchParams();
  // The history API resolves owner access from the canonical account. Never
  // fall through to participant hooks when a stale session role opens history.
  if (searchParams.get("view") === "history") {
    return <OwnerTradeHistoryPage key={getTradeRoomSessionKey(props.actor.id, props.requestId)} locale={props.locale} requestId={props.requestId} />;
  }
  return <TradeRoomPageSession key={getTradeRoomSessionKey(props.actor.id, props.requestId)} {...props} />;
}

function TradeRoomPageSession({
  locale,
  requestId,
  actor,
}: TradeRoomPageProps) {
  const isAr = locale === "ar";
  const dateLocale = isAr ? "ar-IL-u-nu-latn" : "en-IL";
  const router = useRouter();
  const canonicalSession = useOptionalCanonicalSession();
  const hasCanonicalSession = Boolean(canonicalSession);
  const canonicalSessionResolving = canonicalSession?.isResolving ?? false;
  const canonicalSessionUserId = canonicalSession?.user?.id ?? null;
  const refreshCanonicalSession = canonicalSession?.refresh;
  const canonicalSessionReady = !hasCanonicalSession || (!canonicalSessionResolving && canonicalSessionUserId === actor.id);
  const openCommissionPayNow = useCallback((commissionId?: string) => {
    // Commission payment is intentionally handled by the single canonical
    // marketplace flow, which displays and verifies the selected rail's exact
    // network-specific destination. Do not retain an external generic-wallet
    // fallback here.
    const payableCommissionId = commissionId?.trim();
    if (!payableCommissionId) return;
    router.push(commissionPaymentDestination(payableCommissionId));
  }, [router]);
  const searchParams = useSearchParams();
  const [room, setRoom] = useState<TradeRoomData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback, statusMessageFeedbackKey] = useActionFeedbackState<{ message: string; stage: PurchaseRequest["status"] } | null>(null);
  const statusMessage = statusFeedback?.stage === room?.request.status ? statusFeedback?.message ?? null : null;
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError, actionErrorFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [cardlessCode, setCardlessCode] = useState("");
  const [cardlessVerificationKind, setCardlessVerificationKind] = useState<CardlessVerificationKind>("id_number");
  const [cardlessVerificationValue, setCardlessVerificationValue] = useState("");
  useEffect(() => {
    setCardlessCode("");
    setCardlessVerificationKind("id_number");
    setCardlessVerificationValue("");
  }, [actor.id, requestId]);
  const [stepPulse, setStepPulse] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErrorMessage, setChatErrorMessage, chatErrorMessageFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [pokeBusy, setPokeBusy] = useState(false);
  const [pokeResult, setPokeResult] = useState<{ message: string; error: boolean } | null>(null);
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [chatImage, setChatImage] = useState<File | null>(null);
  const [hasUnreadChatMessages, setHasUnreadChatMessages] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [showDisputeComposer, setShowDisputeComposer] = useState(false);
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamCycle, setStreamCycle] = useState(0);
  const [selectedStep, setSelectedStep] = useState<StepId>("request");
  const [buyerEvidenceFile, setBuyerEvidenceFile] = useState<File | null>(null);
  const [sellerEvidenceFile, setSellerEvidenceFile] = useState<File | null>(null);
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState<"buyer" | "seller" | null>(null);
  const [clockTick, setClockTick] = useState(Date.now());
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewCommentError, setReviewCommentError, reviewCommentErrorFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [reviewDeferred, setReviewDeferred] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [buyerCompletionSuccessActive, setBuyerCompletionSuccessActive] = useState(false);
  const [buyerRedirectPending, setBuyerRedirectPending] = useState(false);
  const [buyerSuccessFadingOut, setBuyerSuccessFadingOut] = useState(false);
  const [walletQrDataUrl, setWalletQrDataUrl] = useState<string | null>(null);
  const [walletCopied, setWalletCopied] = useState(false);
  const [bankDetails, setBankDetails] = useState<TradeRoomBankDetails | null>(null);
  const [bankDetailsBusy, setBankDetailsBusy] = useState(false);
  const [bankDetailsError, setBankDetailsError, bankDetailsErrorFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [showManualCloseComposer, setShowManualCloseComposer] = useState(false);
  const [manualCloseReason, setManualCloseReason] = useState("");
  const [manualCloseExplanation, setManualCloseExplanation] = useState("");
  const [manualCloseBusy, setManualCloseBusy] = useState(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const streamReconnectAttemptsRef = useRef(0);
  const actionNoticeTimeoutRef = useRef<number | null>(null);
  const actionInFlightRef = useRef<string | null>(null);
  const pokeInFlightRef = useRef<string | null>(null);
  const chatMessageInFlightRef = useRef(false);
  const pendingChatAttemptRef = useRef<{ signature: string; clientMessageId: string } | null>(null);
  const buyerRedirectTimeoutRef = useRef<number | null>(null);
  const buyerRedirectFadeTimeoutRef = useRef<number | null>(null);
  const buyerEvidenceInputRef = useRef<HTMLInputElement | null>(null);
  const sellerEvidenceInputRef = useRef<HTMLInputElement | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const reviewCommentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatWasNearBottomRef = useRef(true);
  const forceChatScrollRef = useRef(false);
  const knownChatMessageIdsRef = useRef<Set<string>>(new Set());
  const chatMessagesInitializedRef = useRef(false);
  const statusBannerRef = useRef<HTMLDivElement | null>(null);
  const actionRequiredRef = useRef<HTMLDivElement | null>(null);
  const actionFeedbackRef = useRef<HTMLDivElement | null>(null);
  const evidenceSectionRef = useRef<HTMLDivElement | null>(null);
  const chatSectionRef = useRef<HTMLDivElement | null>(null);
  const previousStatusRef = useRef<PurchaseRequest["status"] | null>(null);
  // Performance timing refs — record timestamps so useLayoutEffect can log render latency.
  const perfClickTsRef = useRef<number | null>(null);
  const perfFetchStartTsRef = useRef<number | null>(null);
  const perfSseReceivedTsRef = useRef<number | null>(null);
  const perfSsePublishedAtRef = useRef<number | null>(null);
  const roomRef = useRef<TradeRoomData | null>(null);
  const lastRoomSyncAtRef = useRef(0);
  const lastResumeAtRef = useRef(0);
  const backgroundRefreshInFlightRef = useRef(false);
  const applyChatReceipts = useCallback((receipts: TradeChatReceipt[]) => {
    const current = roomRef.current;
    if (!current || current.request.id !== requestId || !receipts.length) return;
    const byId = new Map(receipts.map(receipt => [receipt.id, receipt]));
    const next = { ...current, messages: current.messages.map(message => {
      const receipt = byId.get(message.id);
      return receipt ? { ...message, ...receipt, readByUserIds: [...new Set([...message.readByUserIds, ...receipt.readByUserIds])] } : message;
    }) };
    roomRef.current = next;
    setRoom(next);
    writeTradeRoomCache(requestId, actor.id, next);
  }, [actor.id, requestId]);
  useTradeChatReadReceipts({
    container: chatScrollRef, requestId, actorId: actor.id, messages: room?.messages ?? [], onReceipts: applyChatReceipts,
    enabled: canonicalSessionReady && Boolean(room && (room.request.buyerId === actor.id || room.request.sellerId === actor.id)),
  });
  const setStatusMessage = useCallback((message: string | null) => {
    const stage = roomRef.current?.request.status;
    setStatusFeedback(message && stage ? { message, stage } : null);
  }, [setStatusFeedback]);
  const deferredSseRoomRef = useRef<TradeRoomData | null>(null);
  const lastDeepLinkHandledRef = useRef<string | null>(null);
  const lastGuidedTradeStateRef = useRef<string | null>(null);
  const lastGuidedFeedbackRef = useRef("");
  const buyerCompletionLockRef = useRef(false);
  const reviewSubmitInFlightRef = useRef(false);
  const reviewFormVisibleRef = useRef(false);

  const logReviewDiagnostic = useCallback((stage: string, detail?: Record<string, unknown>) => {
    const payload = {
      stage,
      requestId,
      ts: new Date().toISOString(),
      ...(detail ?? {}),
    };
    if (typeof window !== "undefined") {
      type WindowWithReviewDiag = Window & { __reviewSubmitDiag?: unknown[] };
      const diagWindow = window as WindowWithReviewDiag;
      const existing = Array.isArray(diagWindow.__reviewSubmitDiag) ? diagWindow.__reviewSubmitDiag : [];
      diagWindow.__reviewSubmitDiag = [...existing.slice(-199), payload];
    }
  }, [requestId]);

  const fetchRoom = useCallback(async (silent = false) => {
    if (!canonicalSessionReady) return null;
    if (!silent) {
      setIsLoading(true);
      setErrorMessage(null);
    }
    try {
      const startedAt = performance.now();
      const response = await fetch(`/api/alpha-exchange/trade-room/${requestId}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const payload = (await response.json()) as TradeRoomData & { error?: string; message?: string };
      if (!response.ok) {
        if (response.status === 401) void refreshCanonicalSession?.({ force: true });
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          roomRef.current = null;
          setRoom(null);
          clearTradeRoomCache(requestId, actor.id);
        }
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر تحميل غرفة الصفقة." : "Failed to load trade room.", isAr));
      }
      setErrorMessage(null);
      lastRoomSyncAtRef.current = Date.now();
      const apiLatencyMs = Math.round(performance.now() - startedAt);
      const routeMs = Number(response.headers.get("X-Trade-Route-Ms") ?? "0");
      const dbMs = Number(response.headers.get("X-Trade-Db-Ms") ?? routeMs);
      if (TRADE_ROOM_DEBUG) {
        console.log("[trade-room-load] fetch", { requestId, apiLatencyMs, routeMs, dbMs, stateAfter: payload.request.status });
      }
      const currentRoom = roomRef.current;
      const reconciledPayload = chatMessageInFlightRef.current && currentRoom
        ? mergeTradeRoomSnapshotPreservingOptimisticMessages(currentRoom, payload)
        : payload;
      const shouldIgnore = currentRoom
        ? shouldIgnoreRegressiveSnapshot(currentRoom, reconciledPayload, buyerCompletionLockRef.current)
        : false;
      const nextRoom = shouldIgnore ? currentRoom : reconciledPayload;
      if (!nextRoom) {
        return null;
      }
      if (currentRoom && tradeRoomSnapshotSignature(currentRoom) === tradeRoomSnapshotSignature(nextRoom)) {
        return currentRoom;
      }
      roomRef.current = nextRoom;
      writeTradeRoomCache(requestId, actor.id, nextRoom);
      setRoom(nextRoom);
      return nextRoom;
    } catch (error) {
      const message = localizedCaughtError(error, isAr ? "تعذر تحميل غرفة الصفقة." : "Failed to load trade room.", isAr);
      setErrorMessage(message);
      return null;
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [actor.id, canonicalSessionReady, isAr, refreshCanonicalSession, requestId]);

  const refreshVisibleRoom = useCallback(async () => {
    if (document.visibilityState !== "visible" || backgroundRefreshInFlightRef.current || actionInFlightRef.current) return;
    backgroundRefreshInFlightRef.current = true;
    try {
      const refreshed = await fetchRoom(true);
      if (!refreshed) setStreamConnected(false);
    } finally {
      backgroundRefreshInFlightRef.current = false;
    }
  }, [fetchRoom]);

  useEffect(() => {
    if (!canonicalSessionReady) {
      roomRef.current = null;
      setRoom(null);
      setStreamConnected(false);
      setIsLoading(canonicalSessionResolving);
      return;
    }
    const cachedCandidate = readTradeRoomCache<TradeRoomData>(requestId, actor.id);
    const cached = cachedCandidate?.request?.id === requestId ? cachedCandidate : null;
    if (cachedCandidate && !cached) clearTradeRoomCache(requestId, actor.id);
    if (cached) {
      roomRef.current = cached;
      setRoom(cached);
      setIsLoading(false);
    }
    // Cached data is only a fast first paint; the canonical server snapshot
    // must win after a refresh, second tab update, or return to the room.
    void fetchRoom(Boolean(cached));
  }, [actor.id, canonicalSessionReady, canonicalSessionResolving, fetchRoom, requestId]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    const currentRequest = room?.request;
    if (!currentRequest) {
      reviewFormVisibleRef.current = false;
      return;
    }
    const reviewFormVisible = actor.role === "buyer" && !currentRequest.buyerReview && COMPLETED_TRADE_STATUSES.has(currentRequest.status);
    if (reviewFormVisible && !reviewFormVisibleRef.current) {
      logReviewDiagnostic("review-form-rendered", { status: currentRequest.status });
      reviewFormVisibleRef.current = true;
      return;
    }
    if (!reviewFormVisible) {
      reviewFormVisibleRef.current = false;
    }
  }, [actor.role, logReviewDiagnostic, reviewDeferred, room?.request]);

  useEffect(() => {
    const currentRequest = room?.request;
    if (!currentRequest) return;
    const nextStep = getStepId(currentRequest.status);
    const previousStatus = previousStatusRef.current;
    setSelectedStep(nextStep);
    if (previousStatus && previousStatus !== currentRequest.status) {
      setStepPulse(true);
      const timeoutId = window.setTimeout(() => setStepPulse(false), 1800);
      previousStatusRef.current = currentRequest.status;
      return () => window.clearTimeout(timeoutId);
    }
    previousStatusRef.current = currentRequest.status;
    setStepPulse(false);
  }, [room?.request]);

  const deepLinkRequestId = room?.request.id ?? null;
  const deepLinkRequestStatus = room?.request.status ?? null;

  useLayoutEffect(() => {
    // Keep the current control stable while its request is pending. On commit,
    // reveal either the result beside the next action or the new server stage.
    if (isLoading || actionBusy || reviewBusy || evidenceBusy || !deepLinkRequestId || !deepLinkRequestStatus) return;
    const action = searchParams.get("action")?.trim() || null;
    const hash = window.location.hash;
    const currentState = `${deepLinkRequestId}:${deepLinkRequestStatus}`;
    const feedbackKey = `${statusMessageFeedbackKey}:${actionErrorFeedbackKey}`;
    const hasNewFeedback = Boolean(actionError || (statusMessage && !reviewCommentError))
      && lastGuidedFeedbackRef.current !== feedbackKey;
    const target = resolveTradeRoomGuidanceTarget({ priorState: lastGuidedTradeStateRef.current, currentState, status: deepLinkRequestStatus, action, hash });
    const marker = `${currentState}:${action ?? ""}:${hash ?? ""}`;
    if (!hasNewFeedback && lastDeepLinkHandledRef.current === marker) return;
    const resolvedRef = hasNewFeedback ? actionFeedbackRef.current
      : target === "status-banner" ? statusBannerRef.current
        : target === "action-required" ? actionRequiredRef.current
          : target === "evidence" ? evidenceSectionRef.current : chatSectionRef.current;
    if (!resolvedRef) return;
    const markHandled = () => {
      lastDeepLinkHandledRef.current = marker;
      lastGuidedTradeStateRef.current = currentState;
      if (hasNewFeedback) lastGuidedFeedbackRef.current = feedbackKey;
    };
    // Inline validation owns its own focus, including keeping the keyboard at
    // the review field. Background changes must not interrupt someone typing.
    const editing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    if (reviewCommentError || (!hasNewFeedback && editing)) { markHandled(); return; }
    let frame = 0;
    const stop = () => {
      window.cancelAnimationFrame(frame);
      for (const event of ["pointerdown", "keydown", "wheel", "touchstart", ACTION_FEEDBACK_REVEALED]) window.removeEventListener(event, yieldToUser, true);
      document.removeEventListener("visibilitychange", reveal);
    };
    const yieldToUser = () => { markHandled(); stop(); };
    const reveal = () => {
      if (!resolvedRef.isConnected || document.visibilityState !== "visible") return;
      revealTradeRoomDeepLinkTarget(resolvedRef);
      markHandled();
      stop();
    };
    frame = window.requestAnimationFrame(reveal);
    document.addEventListener("visibilitychange", reveal);
    for (const event of ["pointerdown", "keydown", "wheel", "touchstart", ACTION_FEEDBACK_REVEALED]) window.addEventListener(event, yieldToUser, true);
    return stop;
  }, [actionBusy, actionError, actionErrorFeedbackKey, deepLinkRequestId, deepLinkRequestStatus, evidenceBusy, isLoading, reviewBusy, reviewCommentError, searchParams, statusMessage, statusMessageFeedbackKey]);

  useEffect(() => {
    if (!room?.request || actionBusy || evidenceBusy) return;
    publishTradeHeaderActivity(actor.id, toTradeHeaderActivity(room.request));
  }, [actor.id, actionBusy, evidenceBusy, room?.request]);

  // Measure T4→T5: SSE received → UI rendered (useLayoutEffect fires synchronously after DOM paint).
  useLayoutEffect(() => {
    if (!PERF_LOG) return;
    const sseTs = perfSseReceivedTsRef.current;
    const publishedAt = perfSsePublishedAtRef.current;
    if (!sseTs) return;
    const renderTs = performance.now();
    const sseToRenderMs = Math.round(renderTs - sseTs);
    perfSseReceivedTsRef.current = null;
    console.log("[trade-room-perf] sse→render", {
      requestId,
      publishedAtEpochMs: publishedAt,
      sseReceivedTs: sseTs,
      renderTs: Math.round(renderTs),
      sseToRenderMs,
      publishToRenderMs: publishedAt ? Math.round(Date.now() - publishedAt) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useEffect(() => () => {
    if (actionNoticeTimeoutRef.current) {
      window.clearTimeout(actionNoticeTimeoutRef.current);
    }
    if (buyerRedirectTimeoutRef.current) {
      window.clearTimeout(buyerRedirectTimeoutRef.current);
    }
    if (buyerRedirectFadeTimeoutRef.current) {
      window.clearTimeout(buyerRedirectFadeTimeoutRef.current);
    }
  }, []);

  const startBuyerCompletionSuccessFlow = useCallback(() => {
    buyerCompletionLockRef.current = true;
    setBuyerCompletionSuccessActive(true);
    setBuyerRedirectPending(true);
    setBuyerSuccessFadingOut(false);
    if (buyerRedirectTimeoutRef.current) {
      window.clearTimeout(buyerRedirectTimeoutRef.current);
    }
    if (buyerRedirectFadeTimeoutRef.current) {
      window.clearTimeout(buyerRedirectFadeTimeoutRef.current);
    }
    buyerRedirectTimeoutRef.current = window.setTimeout(() => {
      setBuyerSuccessFadingOut(true);
      buyerRedirectFadeTimeoutRef.current = window.setTimeout(() => {
        router.push("/usdt-exchange");
        buyerRedirectFadeTimeoutRef.current = null;
      }, 250);
      buyerRedirectTimeoutRef.current = null;
    }, 2000);
  }, [router]);

  useEffect(() => {
    if (!room?.releaseDeadlineActive && !room?.poke?.cooldownUntil) return;
    setClockTick(Date.now());
    const id = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [room?.poke?.cooldownUntil, room?.releaseDeadlineActive]);

  useEffect(() => {
    if (!canonicalSessionReady || document.visibilityState === "hidden") return;
    const stream = new EventSource(`/api/alpha-exchange/trade-room/${requestId}/stream`);
    let closed = false;
    let reconnecting = false;
    setStreamConnected(false);

    const scheduleReconnect = () => {
      if (closed || reconnectTimeoutRef.current !== null) return;
      const delayMs = getTradeRoomReconnectDelayMs(streamReconnectAttemptsRef.current);
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        if (!closed) setStreamCycle((value) => value + 1);
      }, delayMs);
    };

    const onTradeRoom = (event: Event) => {
      if (closed || reconnecting || document.visibilityState === "hidden") return;
      const messageEvent = event as MessageEvent<string>;
      try {
        const payload = JSON.parse(messageEvent.data) as TradeRoomData;
        lastRoomSyncAtRef.current = Date.now();
        // Lifecycle mutations wait for their HTTP confirmation because their
        // SSE snapshot can be stale. A chat POST is different: retain only its
        // temporary message while still applying authoritative counterparty
        // status/Poke/timeline updates below.
        if (actionInFlightRef.current) {
          const queued = deferredSseRoomRef.current;
          if (!queued || !shouldIgnoreRegressiveSnapshot(queued, payload, buyerCompletionLockRef.current)) {
            deferredSseRoomRef.current = payload;
          }
          return;
        }
        if (PERF_LOG) {
          const sseReceivedTs = performance.now();
          perfSseReceivedTsRef.current = sseReceivedTs;
          perfSsePublishedAtRef.current = payload._timing?.publishedAtEpochMs ?? null;
          console.log("[trade-room-perf] sse-received", {
            requestId,
            trigger: payload._timing?.trigger ?? "unknown",
            publishedAtEpochMs: payload._timing?.publishedAtEpochMs ?? null,
            snapshotMs: payload._timing?.snapshotMs ?? null,
            publishToSentMs: payload._timing?.publishToSentMs ?? null,
            clientReceivedTs: Math.round(sseReceivedTs),
            // T4 = publishedAtEpochMs (server epoch), T4→received = can't compare directly
            // (server epoch vs. client performance.now()); use sentAtEpochMs instead:
            sentAtEpochMs: payload._timing?.sentAtEpochMs ?? null,
            sentToReceivedMs: payload._timing?.sentAtEpochMs ? Date.now() - payload._timing.sentAtEpochMs : null,
          });
        }
        const currentRoom = roomRef.current;
        const reconciledPayload = chatMessageInFlightRef.current && currentRoom
          ? mergeTradeRoomSnapshotPreservingOptimisticMessages(currentRoom, payload)
          : payload;
        const shouldIgnore = currentRoom
          ? shouldIgnoreRegressiveSnapshot(currentRoom, reconciledPayload, buyerCompletionLockRef.current)
          : false;
        if (!shouldIgnore && (!currentRoom || tradeRoomSnapshotSignature(currentRoom) !== tradeRoomSnapshotSignature(reconciledPayload))) {
          roomRef.current = reconciledPayload;
          writeTradeRoomCache(requestId, actor.id, reconciledPayload);
          setRoom(reconciledPayload);
          setIsLoading(false);
        }
        setStreamConnected(true);
        setErrorMessage(null);
      } catch {
        // Ignore malformed events and wait for the next snapshot.
      }
    };

    const onOpen = () => {
      streamReconnectAttemptsRef.current = 0;
      // An open socket alone does not establish that the room is current.
      // The first authoritative snapshot marks the connection as ready.
    };
    const onError = (event: Event) => {
      if (closed || reconnecting || document.visibilityState === "hidden") return;
      reconnecting = true;
      setStreamConnected(false);
      stream.close();
      streamReconnectAttemptsRef.current += 1;
      if (!(event instanceof MessageEvent) && refreshCanonicalSession) {
        void refreshCanonicalSession({ background: true });
      }
      // Keep retrying with a bounded backoff. A phone can move between Wi-Fi
      // and mobile data more than three times during a long trade, so a fixed
      // retry cap can silently leave chat updates offline for the rest of the
      // session.
      scheduleReconnect();
    };

    stream.addEventListener("trade-room", onTradeRoom);
    stream.addEventListener("open", onOpen as EventListener);
    stream.addEventListener("error", onError as EventListener);
    // A planned rotation is a MessageEvent, so the recovery path skips the
    // duplicate auth read and obtains a fresh authorized room snapshot instead.
    stream.addEventListener("reconnect", onError as EventListener);

    const handlePageExit = () => {
      closed = true;
      stream.close();
      setStreamConnected(false);
    };
    const handleOffline = () => {
      stream.close();
      setStreamConnected(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        lastResumeAtRef.current = 0;
        handlePageExit();
      }
    };
    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      closed = true;
      stream.close();
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [actor.id, canonicalSessionReady, fetchRoom, refreshCanonicalSession, requestId, streamCycle]);

  useEffect(() => {
    if (!canonicalSessionReady) return;
    const id = window.setInterval(() => {
      // A suspended iOS socket can look connected without delivering events.
      // Reconcile quiet visible rooms as well as explicitly disconnected ones.
      if (!streamConnected || Date.now() - lastRoomSyncAtRef.current >= 10_000) void refreshVisibleRoom();
    }, 5000);
    return () => window.clearInterval(id);
  }, [canonicalSessionReady, refreshVisibleRoom, streamConnected]);

  useEffect(() => {
    const refreshAfterResume = () => {
      if (!canonicalSessionReady || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastResumeAtRef.current < 500) return;
      lastResumeAtRef.current = now;
      setStreamConnected(false);
      streamReconnectAttemptsRef.current = 0;
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      // Replace the possibly suspended socket and fetch the canonical snapshot.
      // Focus/visibility events are coalesced; no lifecycle mutation is replayed.
      setStreamCycle((value) => value + 1);
      void refreshVisibleRoom();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (shouldRestartTradeRoomStreamAfterPageShow(event)) refreshAfterResume();
    };
    document.addEventListener("visibilitychange", refreshAfterResume);
    window.addEventListener("focus", refreshAfterResume);
    window.addEventListener("online", refreshAfterResume);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", refreshAfterResume);
      window.removeEventListener("focus", refreshAfterResume);
      window.removeEventListener("online", refreshAfterResume);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [canonicalSessionReady, refreshVisibleRoom]);

  const isSeller = room ? room.request.sellerId === actor.id : actor.role === "approved_seller";
  const request = room?.request ?? null;
  const sellerWalletAddress = isSeller ? request?.buyerReceivingWalletAddress : undefined;
  const requestPaymentMethod = request ? (normalizeMarketplacePaymentMethod(request.paymentMethod) ?? request.paymentMethod) : "";
  const requestPaymentMethodLabel = paymentMethodDisplayLabel(requestPaymentMethod, isAr);
  const isFaceToFaceTrade = isFaceToFacePaymentMethod(requestPaymentMethod);
  const isCashTrade = isCashTradePaymentMethod(requestPaymentMethod);
  const requestBankNamesLabel = request?.bankName ? bankSelectionDisplayLabel(request.bankName, locale) : "";
  const sellerEvidenceRequired = request ? isSellerEvidenceRequiredForPaymentMethod(requestPaymentMethod) : false;
  const counterpartName = request
    ? (isSeller ? room?.counterpart.buyerName : room?.counterpart.sellerName)
    : "";
  const isCardlessAtmTrade = isCardlessAtmPaymentMethod(requestPaymentMethod);
  const tradeSteps = isCardlessAtmTrade ? CARDLESS_ATM_TRADE_STEP_ORDER : isCashTrade ? CASH_TRADE_STEP_ORDER : STEP_ORDER;
  const currentStepIndex = request ? getTradeProgressIndex(request.status) : 0;
  const progressPercent = Math.round((currentStepIndex / Math.max(1, tradeSteps.length - 1)) * 100);
  const turn = request ? getTurnPanel(request, isSeller, isAr) : null;
  const primaryAction = request ? getPrimaryAction(request, actor.id, isAr, sellerEvidenceRequired) : null;
  const isOverdueTrade = Boolean(room?.isOverdue);
  const statusBanner = request ? getStatusBannerContent(request, isSeller, isAr, primaryAction, isOverdueTrade) : null;
  const waitingEstimate = request ? getWaitingEstimate(request, isSeller, isAr, isOverdueTrade) : null;
  const deliveryConfirmation = request ? getDeliveryConfirmation(request, isAr) : null;
  const showSuccessScreen = request?.status === "review_open" || request?.status === "completed" || request?.status === "locked";
  const isBuyerCompletionSyncInFlight = Boolean(
    request
    && request.buyerId === actor.id
    && request.status === "usdt_sent"
    && actionBusy
    && actionInFlightRef.current?.endsWith(":completed"),
  );
  const sellerCanViewBuyerReceipt = Boolean(
    isSeller
    && request
    && (request.status === "payment_sent"
      || request.status === "funds_received"
      || request.status === "usdt_release_pending"
      || request.status === "usdt_sent"
      || request.status === "review_open"
      || request.status === "completed"
      || request.status === "locked"),
  );
  const canShowBuyerReceipt = Boolean(request?.buyerEvidence && (!isSeller || sellerCanViewBuyerReceipt));
  const sellerEvidenceUploadOpen = Boolean(isSeller && request?.status === "usdt_release_pending");
  const activeTimeline = useMemo(
    () => groupTradeTimelineEntries(request?.timeline ?? [], isAr),
    [isAr, request?.timeline],
  );
  const visibleTimeline = showAllTimeline ? activeTimeline : activeTimeline.slice(0, 4);

  useEffect(() => {
    if (!sellerWalletAddress) {
      setWalletQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void import("qrcode").then((QRCode) => {
      void QRCode.toDataURL(sellerWalletAddress, {
        width: 176,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      }).then((url: string) => {
        if (!cancelled) setWalletQrDataUrl(url);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [sellerWalletAddress]);

  const copySellerWallet = useCallback(async () => {
    if (!sellerWalletAddress) return;
    try {
      await navigator.clipboard.writeText(sellerWalletAddress);
      setWalletCopied(true);
      window.setTimeout(() => setWalletCopied(false), 1800);
    } catch {
      setActionError(isAr ? "تعذر نسخ عنوان المحفظة." : "Could not copy the wallet address.");
    }
  }, [isAr, sellerWalletAddress, setActionError]);

  const [adjustingAmount, setAdjustingAmount] = useState(false);
  const [adjustmentIlsAmount, setAdjustmentIlsAmount] = useState("");
  useEffect(() => { setAdjustmentIlsAmount(""); }, [requestId, request?.fiatAmount]);
  const recalculateCashAmount = useCallback(async () => {
    const mutationKey = `${requestId}:recalculate-amount`;
    if (adjustingAmount || !roomRef.current || !acquireTradeRoomMutation(actionInFlightRef, mutationKey)) return;
    setAdjustingAmount(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${requestId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recalculate_cardless_amount", ilsAmount: adjustmentIlsAmount || undefined }), signal: AbortSignal.timeout(15_000) });
      const payload = await response.json() as { request?: PurchaseRequest; error?: string };
      if (!response.ok || !payload.request) throw new Error(isAr ? "تعذر تعديل المبلغ. تحقق من مبلغ السحب وحدود العرض ثم حدّث الصفقة." : payload.error ?? "Could not adjust the trade amount.");
      const nextRoom = applyRequestToRoom(roomRef.current!, payload.request);
      roomRef.current = nextRoom; setRoom(nextRoom); writeTradeRoomCache(requestId, actor.id, nextRoom);
      setStatusMessage(isAr ? `تم تأكيد المبلغ: ${payload.request.usdtAmount} USDT مقابل ₪${payload.request.fiatAmount}.` : `Amount confirmed: ${payload.request.usdtAmount} USDT for ILS ${payload.request.fiatAmount}.`);
    } catch (error) {
      setActionError(localizedCaughtError(error, isAr ? "تعذر تأكيد تعديل المبلغ. حدّث الصفقة." : "Could not confirm the adjustment. Refresh the trade.", isAr));
    } finally { releaseTradeRoomMutation(actionInFlightRef, mutationKey); setAdjustingAmount(false); }
  }, [adjustingAmount, setActionError, requestId, adjustmentIlsAmount, isAr, actor.id, setStatusMessage]);

  const canRevealBankDetails = canRevealTradeRoomBankDetails(request, isSeller);
  const bankDetailsRequestId = request?.id ?? null;
  const bankDetailsAccountId = request?.sellerBankAccountId ?? null;

  useEffect(() => {
    if (!bankDetailsRequestId) {
      setBankDetails(null);
      setBankDetailsError(null);
      return;
    }
    if (!canRevealBankDetails) {
      setBankDetails(null);
      setBankDetailsError(null);
      return;
    }
    setBankDetails(null);
    setBankDetailsBusy(false);
    setBankDetailsError(null);
  }, [bankDetailsAccountId, bankDetailsRequestId, canRevealBankDetails, setBankDetailsError]);

  const handleRevealBankDetails = useCallback(async () => {
    if (!bankDetailsRequestId || bankDetailsBusy) return;
    const confirmed = window.confirm(isAr
      ? "اعرض تفاصيل الحساب فقط عندما تكون مستعداً للتحقق منها. عرضها لا يؤكد الدفع؛ يبقى الإلغاء متاحاً حتى ترسل الدفعة أو إثباتها. هل تريد المتابعة؟"
      : "Reveal the account details only when you are ready to verify them. Viewing them does not confirm payment; cancellation remains available until payment or evidence is submitted. Continue?");
    if (!confirmed) return;
    setBankDetailsBusy(true);
    setBankDetailsError(null);
    try {
      const response = await fetch(`/api/alpha-exchange/trade-room/${bankDetailsRequestId}/bank-details`, { method: "POST", cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { error?: string; bankDetails?: TradeRoomBankDetails };
      if (!response.ok || !payload.bankDetails) {
        throw new Error(isAr ? "تعذر تحميل تفاصيل الحساب البنكي." : (payload.error ?? "Failed to load bank details."));
      }
      setBankDetails(payload.bankDetails);
      const currentRoom = roomRef.current;
      if (currentRoom && !currentRoom.request.sensitivePaymentSharedAt) {
        const nextRoom = applyRequestToRoom(currentRoom, {
          ...currentRoom.request,
          sensitivePaymentSharedAt: new Date().toISOString(),
          sensitivePaymentKind: "bank_details",
        });
        roomRef.current = nextRoom;
        setRoom(nextRoom);
        writeTradeRoomCache(requestId, actor.id, nextRoom);
      }
      void fetchRoom(true);
    } catch (error) {
      setBankDetails(null);
      setBankDetailsError(localizedCaughtError(error, isAr ? "تعذر تحميل تفاصيل الحساب البنكي." : "Failed to load bank details.", isAr));
    } finally {
      setBankDetailsBusy(false);
    }
  }, [actor.id, bankDetailsBusy, bankDetailsRequestId, fetchRoom, isAr, requestId, setBankDetailsError]);

  const selectedStepEvent = useMemo(() => {
    if (!request) return null;
    const timeline = [...(request.timeline ?? [])].reverse();
    return timeline.find((entry) => timelineStepForEvent(entry) === selectedStep) ?? null;
  }, [request, selectedStep]);

  const timeRemainingSeconds = useMemo(() => {
    if (!room?.deadlineAt) return null;
    return Math.max(0, Math.floor((new Date(room.deadlineAt).getTime() - clockTick) / 1000));
  }, [clockTick, room?.deadlineAt]);

  const pokeCooldownRemainingSeconds = useMemo(() => {
    const cooldownUntil = room?.poke?.cooldownUntil;
    if (!cooldownUntil) return 0;
    return Math.max(0, Math.ceil((new Date(cooldownUntil).getTime() - clockTick) / 1000));
  }, [clockTick, room?.poke?.cooldownUntil]);
  const pokeAvailable = room?.poke?.available === true;
  const canSendPoke = pokeAvailable && pokeCooldownRemainingSeconds === 0 && !pokeBusy;
  const pokeCounterpartLabel = room?.poke?.counterpartRole === "seller"
    ? (isAr ? "البائع" : "Seller")
    : (isAr ? "المشتري" : "Buyer");

  const deadlineCritical = Boolean(room?.releaseDeadlineActive && timeRemainingSeconds !== null && timeRemainingSeconds <= 5 * 60);
  const deadlineWarning = Boolean(room?.releaseDeadlineActive && timeRemainingSeconds !== null && timeRemainingSeconds <= 10 * 60 && timeRemainingSeconds > 5 * 60);

  const primaryActionDisabledReason = useMemo(() => {
    if (!primaryAction || !request) return null;
    if (primaryAction.mode === "status" && primaryAction.requiresEvidenceSide === "buyer" && !request.buyerEvidence) {
      return isAr ? "ارفع إيصال الدفع أولًا." : "Upload the payment receipt before submitting payment.";
    }
    if (primaryAction.mode === "status" && primaryAction.requiresEvidenceSide === "seller" && !request.sellerEvidence) {
      return isAr ? "يرجى رفع إثبات البائع قبل إصدار USDT." : "Please upload seller evidence before releasing USDT.";
    }
    return null;
  }, [isAr, primaryAction, request]);
  const primaryActionLoading = useMemo(() => {
    if (!primaryAction) return false;
    if (primaryAction.mode === "upload" && primaryAction.uploadSide) {
      return evidenceBusy === primaryAction.uploadSide;
    }
    return actionBusy;
  }, [actionBusy, evidenceBusy, primaryAction]);
  const primaryActionButtonLabel = useMemo(() => {
    if (!primaryAction) return "";
    if (primaryAction.mode === "upload") {
      return primaryAction.uploadSide === "buyer" ? (isAr ? "رفع إيصال الدفع" : "Upload Payment Receipt") : (isAr ? "رفع إثبات البائع" : "Upload Seller Evidence");
    }
    return primaryAction.label;
  }, [isAr, primaryAction]);

  const handleStatusUpdate = useCallback(async (action: StatusPrimaryAction) => {
    const nextStatus = action.nextStatus;
    if (!request || !room) return;
    let sellerSafetyAcknowledged = false;
    if (nextStatus === "accepted" && isFaceToFacePaymentMethod(request.paymentMethod)) {
      sellerSafetyAcknowledged = window.confirm(isAr
        ? "أؤكد أنني قرأت إرشادات اللقاء الآمن وسألتقي في مكان عام وآمن دون مشاركة معلومات شخصية غير ضرورية."
        : "I confirm that I read the safe-meeting guidance and will meet in a safe public place without sharing unnecessary personal information.");
      if (!sellerSafetyAcknowledged) return;
    }
    const cardlessDetails = parseCardlessWithdrawalDetails({ withdrawalCode: cardlessCode, verificationKind: cardlessVerificationKind, verificationValue: cardlessVerificationValue });
    const isCardlessSubmission = nextStatus === "payment_sent" && isCardlessAtmPaymentMethod(request.paymentMethod);
    if (nextStatus === "payment_sent" && isCardlessAtmPaymentMethod(request.paymentMethod)) {
      if (!cardlessDetails.ok) {
        setActionError(isAr ? "أدخل رمز سحب صالحاً ورقم الهوية أو تاريخ الميلاد المطلوب من البنك." : "Enter a valid withdrawal code and the ID number or date of birth required by the bank.");
        return;
      }
    }
    const mutationKey = `${request.id}:${request.status}:${action.command ?? nextStatus}`;
    if (!acquireTradeRoomMutation(actionInFlightRef, mutationKey)) return;
    const previousRoom = room;
    const optimisticRoom = buildOptimisticRoom(room, nextStatus, actor, action.command);
    const payload = isCardlessSubmission && cardlessDetails.ok
      ? {
          action: "submit_cardless_code",
          ...cardlessDetails.details,
          clientOperationId: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16).padStart(12, "0")}${Math.random().toString(16).slice(2).padEnd(20, "0").slice(0, 20)}`,
        }
      : action.command
      ? { action: action.command, ...(action.command === "complete_trade" ? { usdtSentConfirmed: true } : {}) }
      : nextStatus === "accepted"
        ? { status: nextStatus, safetyAcknowledged: sellerSafetyAcknowledged }
        : { status: nextStatus };
    // T0: click timestamp
    const clickTs = performance.now();
    perfClickTsRef.current = clickTs;
    const startedAt = clickTs;
    // Keep the confirmed room in place until the server accepts this action.
    setActionBusy(true);
    setActionNotice(null);
    setActionError(null);
    setStatusMessage(null);
    if (PERF_LOG) {
      console.log("[trade-room-perf] T0 click", {
        requestId: request.id,
        nextStatus,
        stateBefore: request.status,
        clickTs: Math.round(clickTs),
        streamConnected,
      });
    }
    actionNoticeTimeoutRef.current = window.setTimeout(() => {
      setActionNotice(isAr ? "ما زال التنفيذ جاريًا... ننتظر الخادم." : "Still processing... we're waiting for the server.");
    }, 8000);
    try {
      // T1: request sent
      const responseStartedAt = performance.now();
      perfFetchStartTsRef.current = responseStartedAt;
      if (PERF_LOG) {
        console.log("[trade-room-perf] T1 fetch-start", {
          requestId: request.id,
          clickToFetchMs: Math.round(responseStartedAt - startedAt),
        });
      }
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      const responsePayload = (await response.json()) as { error?: string; message?: string; request?: PurchaseRequest; destination?: string; metrics?: { totalMs?: number } };
      const apiLatencyMs = Math.round(performance.now() - responseStartedAt);
      // T2+T3: server timings from response headers
      const routeMs = Number(response.headers.get("X-Trade-Route-Ms") ?? "0");
      const queueMs = Number(response.headers.get("X-Trade-Queue-Ms") ?? "0");
      const dbMs = Number(response.headers.get("X-Trade-Db-Ms") ?? routeMs);
      const readMs = Number(response.headers.get("X-Trade-Read-Ms") ?? "0");
      const timelineMs = Number(response.headers.get("X-Trade-Timeline-Ms") ?? "0");
      const chatMs = Number(response.headers.get("X-Trade-Chat-Ms") ?? "0");
      const notificationMs = Number(response.headers.get("X-Trade-Notification-Ms") ?? "0");
      const sseMs = Number(response.headers.get("X-Trade-Sse-Ms") ?? "0");
      const writeMs = Number(response.headers.get("X-Trade-Write-Ms") ?? "0");
      const trustMs = Number(response.headers.get("X-Trade-Trust-Ms") ?? "0");
      if (PERF_LOG) {
        console.log("[trade-room-perf] T2+T3 server timings", {
          requestId: request.id,
          stateAfter: responsePayload.request?.status ?? optimisticRoom.request.status,
          "T0→T1 clickToFetchMs": Math.round(responseStartedAt - startedAt),
          "T1→response apiLatencyMs": apiLatencyMs,
          "  server routeMs (T1 arrival→response)": routeMs,
          "  server queueMs": queueMs,
          "  server readDbMs": readMs,
          "  server timelineMs": timelineMs,
          "  server chatMs": chatMs,
          "  server notificationMs": notificationMs,
          "  server sseMs": sseMs,
          "  server writeDbMs": writeMs,
          "  server trustMs": trustMs,
          "  server totalDbMs": dbMs,
          "T0→response totalClientMs": Math.round(performance.now() - startedAt),
        });
      }
      if (!response.ok) {
        throw new Error(readApiErrorFallback(responsePayload, isAr ? "تعذر تحديث حالة الصفقة." : "Failed to update trade status.", isAr));
      }
      if (isCardlessSubmission) {
        setCardlessCode("");
        setCardlessVerificationValue("");
      }
      if (responsePayload.request) {
        const nextRoom = applyRequestToRoom(roomRef.current ?? optimisticRoom, responsePayload.request);
        roomRef.current = nextRoom;
        setRoom(nextRoom);
        writeTradeRoomCache(requestId, actor.id, nextRoom);
      }
      const pendingBuyerReview = request.buyerId === actor.id && !request.buyerReview;
      if (nextStatus === "completed" && request.buyerId === actor.id && !pendingBuyerReview) {
        startBuyerCompletionSuccessFlow();
      }
      setActionNotice(null);
      setStatusMessage(action.successLabel);
      if (responsePayload.destination && !(nextStatus === "completed" && request.sellerId === actor.id)) {
        navigateOrRevealResult(router, responsePayload.destination, "trade-action-result");
      }
    } catch (error) {
      const refreshedRoom = await fetchRoom(true);
      const expectedStatus = nextStatus === "completed" ? "review_open" : nextStatus;
      if (refreshedRoom?.request.status === expectedStatus) {
        if (isCardlessSubmission) {
          setCardlessCode("");
          setCardlessVerificationValue("");
        }
        setActionNotice(null);
        setActionError(null);
        const pendingBuyerReview = request.buyerId === actor.id && !request.buyerReview;
        if (nextStatus === "completed" && request.buyerId === actor.id && !pendingBuyerReview) {
          startBuyerCompletionSuccessFlow();
        }
        setStatusMessage(isAr ? "تم تحديث حالة الصفقة بعد تأكيد الخادم." : "Trade status updated after server confirmation.");
      } else {
        const currentRoom = roomRef.current;
        if (!deferredSseRoomRef.current && (!currentRoom || tradeRoomSnapshotSignature(currentRoom) === tradeRoomSnapshotSignature(optimisticRoom))) {
          roomRef.current = previousRoom;
          setRoom(previousRoom);
          writeTradeRoomCache(requestId, actor.id, previousRoom);
        }
        const message = localizedCaughtError(error, isAr ? "تعذر تحديث حالة الصفقة." : "Failed to update trade status.", isAr);
        setActionError(message);
        setActionNotice(null);
      }
    } finally {
      if (actionNoticeTimeoutRef.current) {
        window.clearTimeout(actionNoticeTimeoutRef.current);
        actionNoticeTimeoutRef.current = null;
      }
      releaseTradeRoomMutation(actionInFlightRef, mutationKey);
      const deferredRoom = deferredSseRoomRef.current;
      deferredSseRoomRef.current = null;
      if (deferredRoom) {
        const currentRoom = roomRef.current;
        const reconciledRoom = currentRoom
          ? mergeTradeRoomSnapshotPreservingOptimisticMessages(currentRoom, deferredRoom)
          : deferredRoom;
        if (!currentRoom || !shouldIgnoreRegressiveSnapshot(currentRoom, reconciledRoom, buyerCompletionLockRef.current)) {
          roomRef.current = reconciledRoom;
          setRoom(reconciledRoom);
          writeTradeRoomCache(requestId, actor.id, reconciledRoom);
        }
      }
      setActionBusy(false);
      void fetchRoom(true);
    }
  }, [actor, cardlessCode, cardlessVerificationKind, cardlessVerificationValue, fetchRoom, isAr, request, requestId, room, router, setActionError, setStatusMessage, startBuyerCompletionSuccessFlow, streamConnected]);

  const handleSendMessage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (chatMessageInFlightRef.current) return;
    const currentRoom = roomRef.current ?? room;
    if (!currentRoom) return;
    const message = chatDraft.trim();
    if (!message && !chatImage) return;
    if (chatImage && isCashTradePaymentMethod(currentRoom.request.paymentMethod)) {
      setChatErrorMessage(isAr ? "لا تقبل صفقات النقد صور المحادثة أو إثباتات الدفع." : "Cash trades do not accept chat photos or payment evidence.");
      return;
    }
    if (chatImage && !ALLOWED_CHAT_IMAGE_TYPES.has(chatImage.type)) {
      setChatErrorMessage(isAr ? "يجب أن يكون مرفق المحادثة صورة PNG أو JPEG أو WebP." : "Chat attachments must be PNG, JPEG, or WebP images.");
      return;
    }
    if (chatImage && chatImage.size > MAX_EVIDENCE_SIZE_BYTES) {
      setChatErrorMessage(isAr ? "حجم صورة المحادثة كبير جدًا (الحد 8MB)." : "Chat image is too large (max 8MB).");
      return;
    }
    const attemptSignature = tradeRoomChatAttemptSignature(message, chatImage);
    const pendingAttempt = resolveTradeRoomChatAttempt(pendingChatAttemptRef.current, attemptSignature);
    pendingChatAttemptRef.current = pendingAttempt;
    const clientMessageId = pendingAttempt.clientMessageId;
    // Optimistically append the message so it appears instantly for the sender.
    const optimisticMsg: TradeChatMessage = {
      id: `optimistic-msg-${clientMessageId}`,
      clientMessageId,
      purchaseRequestId: currentRoom.request.id,
      kind: "user",
      senderUserId: actor.id,
      senderRole: actor.role,
      message,
      createdAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      readByUserIds: [actor.id],
      imageName: chatImage?.name,
      imageMimeType: chatImage?.type,
    };
    const optimisticRoom = {
      ...currentRoom,
      messages: mergeTradeRoomMessages(currentRoom.messages, optimisticMsg),
    };
    forceChatScrollRef.current = true;
    chatMessageInFlightRef.current = true;
    roomRef.current = optimisticRoom;
    writeTradeRoomCache(requestId, actor.id, optimisticRoom);
    setRoom(optimisticRoom);
    setChatDraft("");
    setChatErrorMessage(null);
    setChatBusy(true);
    try {
      const imageUrl = chatImage ? await encodeFileToDataUrl(chatImage) : undefined;
      const requestBody = JSON.stringify({
        message,
        clientMessageId,
        imageUrl,
        imageName: chatImage?.name,
        imageMimeType: chatImage?.type,
      });
      let response: Response | null = null;
      let payload: TradeRoomChatPostPayload | null = null;
      let lastNetworkError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = null;
        payload = null;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), CHAT_SEND_TIMEOUT_MS);
        try {
          response = await fetch(`/api/alpha-exchange/purchase-requests/${currentRoom.request.id}/messages`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: requestBody,
            signal: controller.signal,
          });
          payload = await response.json().catch(() => null) as TradeRoomChatPostPayload | null;
          if (response.status === 401 && attempt === 0 && refreshCanonicalSession) {
            const sessionResult = await refreshCanonicalSession({ force: true });
            if (sessionResult === "authenticated") continue;
          }
          if (isRetryableChatResponse(response.status) && attempt === 0) continue;
          break;
        } catch (error) {
          lastNetworkError = error;
          if (attempt === 0) continue;
        } finally {
          window.clearTimeout(timeout);
        }
      }
      if (!response) {
        throw new Error(
          isAr
            ? "تعذر الاتصال بالخادم. لم يتم إرسال الرسالة، وتمت إعادتها إلى مربع الكتابة."
            : "Could not reach the server. Your message was not sent and has been restored in the message box.",
          { cause: lastNetworkError },
        );
      }
      if (!response.ok) {
        throw new Error(readTradeRoomChatError(payload, isAr));
      }
      // Keep the same client id across uncertain retries, but retire it as soon
      // as the server confirms this exact content. This mirrors the native app
      // and makes a timeout-after-commit safe from duplicate chat messages.
      if (pendingChatAttemptRef.current?.clientMessageId === clientMessageId) {
        pendingChatAttemptRef.current = null;
      }
      setChatImage(null);
      if (chatImageInputRef.current) chatImageInputRef.current.value = "";
      const confirmedMessage = payload?.message;
      if (confirmedMessage) {
        const confirmedRoom = roomRef.current;
        if (confirmedRoom) {
          const nextRoom = {
            ...confirmedRoom,
            messages: mergeTradeRoomMessages(confirmedRoom.messages, confirmedMessage, optimisticMsg.id),
          };
          roomRef.current = nextRoom;
          writeTradeRoomCache(requestId, actor.id, nextRoom);
          setRoom(nextRoom);
        }
      }
    } catch (error) {
      const failedRoom = roomRef.current;
      if (failedRoom) {
        const revertedRoom = {
          ...failedRoom,
          messages: failedRoom.messages.filter((candidate) => candidate.id !== optimisticMsg.id),
        };
        roomRef.current = revertedRoom;
        writeTradeRoomCache(requestId, actor.id, revertedRoom);
        setRoom(revertedRoom);
      }
      setChatDraft((current) => current.trim() ? `${message}\n${current}` : message);
      setChatErrorMessage(localizedCaughtError(error, isAr ? "تعذر إرسال الرسالة. حاول مرة أخرى." : "Message was not sent. Please try again.", isAr));
    } finally {
      chatMessageInFlightRef.current = false;
      setChatBusy(false);
    }
  }, [actor.id, actor.role, chatDraft, chatImage, isAr, refreshCanonicalSession, requestId, room, setChatErrorMessage]);

  const handleCopyChatDraft = useCallback(async () => {
    if (!chatDraft) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(chatDraft);
      setChatErrorMessage(null);
      setChatNotice(isAr ? "تم نسخ الرسالة." : "Message copied.");
    } catch {
      setChatErrorMessage(isAr ? "تعذر نسخ الرسالة." : "Could not copy the message.");
    }
  }, [chatDraft, isAr, setChatErrorMessage]);

  const handlePoke = useCallback(async () => {
    if (!request || !room?.poke?.available || pokeBusy) return;
    const mutationKey = `${request.id}:poke`;
    if (!acquireTradeRoomMutation(pokeInFlightRef, mutationKey)) return;
    setPokeBusy(true);
    setPokeResult(null);
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/poke`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        cooldownUntil?: string | null;
        poke?: TradeRoomData["poke"];
      };
      if (!response.ok) {
        if (payload.cooldownUntil) {
          setRoom((current) => current
            ? {
                ...current,
                poke: {
                  ...current.poke,
                  canPoke: false,
                  cooldownUntil: payload.cooldownUntil ?? null,
                },
              }
            : current);
        }
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر إرسال التذكير." : "Could not send the reminder.", isAr));
      }
      if (payload.poke) {
        setRoom((current) => current ? { ...current, poke: payload.poke! } : current);
      }
      setPokeResult({ error: false, message: isAr ? `تم تنبيه ${pokeCounterpartLabel}.` : `${pokeCounterpartLabel} notified.` });
      void fetchRoom(true);
    } catch (error) {
      setPokeResult({ error: true, message: localizedCaughtError(error, isAr ? "تعذر إرسال التذكير." : "Could not send the reminder.", isAr) });
    } finally {
      releaseTradeRoomMutation(pokeInFlightRef, mutationKey);
      setPokeBusy(false);
    }
  }, [fetchRoom, isAr, pokeBusy, pokeCounterpartLabel, request, room?.poke?.available]);

  const handleUploadEvidence = useCallback(async (side: "buyer" | "seller") => {
    if (!request || !room) return;
    const file = side === "buyer" ? buyerEvidenceFile : sellerEvidenceFile;
    if (!file) return;
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
      setActionError(isAr ? "صيغة الملف غير مدعومة." : "Unsupported evidence file type.");
      return;
    }
    if (file.size > MAX_EVIDENCE_SIZE_BYTES) {
      setActionError(isAr ? "حجم الملف كبير جدًا (الحد 8MB)." : "Evidence file is too large (max 8MB).");
      return;
    }

    const mutationKey = `${request.id}:evidence:${side}`;
    if (!acquireTradeRoomMutation(actionInFlightRef, mutationKey)) return;

    setEvidenceBusy(side);
    setActionNotice(null);
    setActionError(null);
    setStatusMessage(null);
    try {
      const fileData = await encodeFileToDataUrl(file);
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          fileData,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string; request?: PurchaseRequest };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر رفع الإثبات." : "Failed to upload evidence.", isAr));
      }
      if (!payload.request) throw new Error(isAr ? "تعذر تأكيد الرفع. تحقق من حالة الصفقة قبل المحاولة مجددًا." : "Could not confirm the upload. Check the trade status before retrying.");
      const nextRoom = applyRequestToRoom(roomRef.current ?? room, payload.request);
      roomRef.current = nextRoom;
      setRoom(nextRoom);
      writeTradeRoomCache(requestId, actor.id, nextRoom);
      if (side === "buyer") setBuyerEvidenceFile(null);
      else setSellerEvidenceFile(null);
      setStatusMessage(
        side === "buyer" && (request.status === "accepted" || nextRoom.request.status === "payment_sent")
          ? (isAr ? "تم رفع إيصال الدفع وإبلاغ البائع." : "Payment receipt uploaded and seller notified.")
          : side === "seller" && request.status === "usdt_release_pending"
            ? (isAr ? "تم إصدار USDT وإبلاغ المشتري." : "USDT released and buyer notified.")
          : (isAr ? "تم رفع الإثبات بنجاح." : "Evidence uploaded."),
      );
    } catch (error) {
      setActionError(localizedCaughtError(error, isAr ? "تعذر رفع الإثبات." : "Failed to upload evidence.", isAr));
    } finally {
      releaseTradeRoomMutation(actionInFlightRef, mutationKey);
      const deferredRoom = deferredSseRoomRef.current;
      deferredSseRoomRef.current = null;
      if (deferredRoom) {
        const currentRoom = roomRef.current;
        const reconciledRoom = currentRoom
          ? mergeTradeRoomSnapshotPreservingOptimisticMessages(currentRoom, deferredRoom)
          : deferredRoom;
        if (!currentRoom || !shouldIgnoreRegressiveSnapshot(currentRoom, reconciledRoom, buyerCompletionLockRef.current)) {
          roomRef.current = reconciledRoom;
          setRoom(reconciledRoom);
          writeTradeRoomCache(requestId, actor.id, reconciledRoom);
        }
      }
      setEvidenceBusy(null);
      void fetchRoom(true);
    }
  }, [actor.id, buyerEvidenceFile, fetchRoom, isAr, request, requestId, room, sellerEvidenceFile, setActionError, setStatusMessage]);

  const handlePrimaryAction = useCallback(async () => {
    if (!primaryAction) return;
    if (primaryAction.mode === "status" && primaryAction.nextStatus === "payment_sent" && isCardlessAtmTrade) {
      const parsed = parseCardlessWithdrawalDetails({ withdrawalCode: cardlessCode, verificationKind: cardlessVerificationKind, verificationValue: cardlessVerificationValue });
      if (!parsed.ok) {
        const inputId = parsed.field === "withdrawalCode" ? "cardless-withdrawal-code" : "cardless-verification-value";
        document.getElementById(inputId)?.focus();
        document.getElementById("cardless-withdrawal-details")?.scrollIntoView({ behavior: "smooth", block: "center" });
        setActionError(isAr ? "عبّئ خانتي بيانات السحب أولاً." : "Complete both withdrawal details first.");
        return;
      }
    }
    setActionError(null);
    if (primaryAction.mode === "upload") {
      const side = primaryAction.uploadSide;
      if (!side) return;
      const file = side === "buyer" ? buyerEvidenceFile : sellerEvidenceFile;
      if (!file) {
        const input = side === "buyer" ? buyerEvidenceInputRef.current : sellerEvidenceInputRef.current;
        input?.click();
        return;
      }
      await handleUploadEvidence(side);
      return;
    }
    if (isSeller && request?.feePolicyVersion === "buyer_seller_1pct_v1" && ["accepted", "funds_received"].includes(primaryAction.nextStatus ?? "")) {
      const message = `${primaryAction.confirmationMessage ?? ""}\n${sellerFeeResponsibilityNotice(isAr ? "ar" : "en")}\n${request.currency} ${request.fiatAmount}`;
      if (!window.confirm(message)) return;
    } else if (primaryAction.confirmationMessage && !window.confirm(primaryAction.confirmationMessage)) return;
    await handleStatusUpdate(primaryAction);
  }, [buyerEvidenceFile, cardlessCode, cardlessVerificationKind, cardlessVerificationValue, handleStatusUpdate, handleUploadEvidence, isAr, isCardlessAtmTrade, primaryAction, sellerEvidenceFile, setActionError, isSeller, request?.feePolicyVersion, request?.fiatAmount, request?.currency]);

  const handleOpenDispute = useCallback(async () => {
    if (!request) return;
    const reason = disputeReason.trim();
    if (!reason) {
      setStatusMessage(isAr ? "سبب النزاع مطلوب." : "Dispute reason is required.");
      return;
    }
    const mutationKey = `${request.id}:dispute`;
    if (!acquireTradeRoomMutation(actionInFlightRef, mutationKey)) return;
    setDisputeBusy(true);
    try {
      const response = await fetch("/api/alpha-exchange/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseRequestId: request.id,
          reason,
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر فتح النزاع." : "Failed to open dispute.", isAr));
      }
      setDisputeReason("");
      setShowDisputeComposer(false);
      setStatusMessage(isAr ? "تم فتح النزاع وإبلاغ الإدارة." : "Dispute opened and admins were notified.");
      await fetchRoom(true);
    } catch (error) {
      setStatusMessage(localizedCaughtError(error, isAr ? "تعذر فتح النزاع." : "Failed to open dispute.", isAr));
    } finally {
      releaseTradeRoomMutation(actionInFlightRef, mutationKey);
      setDisputeBusy(false);
    }
  }, [disputeReason, fetchRoom, isAr, request, setStatusMessage]);

  const handleCancelTrade = useCallback(async () => {
    if (!request || (!canBuyerCancelTrade(request, actor.id) && !canSellerCancelTrade(request, actor.id)) || cancelBusy || room?.hasOpenDispute) return;
    const confirmation = request.status === "accepted"
      ? (isAr
          ? "ألغِ الصفقة فقط إذا لم يرسل أو يستلم أي طرف مالًا أو نقدًا أو USDT، ولم تتم مشاركة رمز سحب أو إثبات دفع. إذا بدأ التبادل، أكمل الصفقة أو افتح نزاعًا. هل تريد المتابعة؟"
          : "Cancel only if neither participant has sent or received money, cash or USDT, and no withdrawal code or payment evidence has been shared. If the exchange started, complete the trade or open a dispute. Continue?")
      : (isAr ? "هل تريد إلغاء هذا الطلب قبل قبوله؟" : "Cancel this request before it is accepted?");
    if (!window.confirm(confirmation)) return;
    const mutationKey = `${request.id}:cancel`;
    if (!acquireTradeRoomMutation(actionInFlightRef, mutationKey)) return;
    setCancelBusy(true);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const payload = (await response.json()) as { error?: string; request?: PurchaseRequest };
      if (!response.ok) {
        setStatusMessage(isAr ? "تعذر إلغاء الطلب." : (payload.error ?? "Failed to cancel the request."));
        return;
      }
      if (payload.request) publishTradeHeaderActivity(actor.id, toTradeHeaderActivity(payload.request));
      router.push("/usdt-exchange");
    } catch {
      setStatusMessage(isAr ? "تعذر إلغاء الطلب." : "Failed to cancel the request.");
    } finally {
      releaseTradeRoomMutation(actionInFlightRef, mutationKey);
      setCancelBusy(false);
    }
  }, [actor.id, cancelBusy, isAr, request, room?.hasOpenDispute, router, setStatusMessage]);

  const handleDeclineTrade = useCallback(async () => {
    if (!request || !canSellerDeclineTrade(request, actor.id) || actionBusy || room?.hasOpenDispute) return;
    const confirmed = window.confirm(isAr
      ? "ارفض الطلب فقط إذا لم يتم تبادل أي أموال أو نقد أو USDT. رفض صفقة تمت فعليًا بهدف تجنب العمولة مخالفة خطيرة وقد يؤدي إلى تقييد حساب البائع أو إيقافه نهائيًا. هل تريد المتابعة؟"
      : "Decline only if no money, cash, or USDT has been exchanged. Declining a completed trade to avoid commission is a serious violation and may result in seller restrictions or permanent suspension. Continue?");
    if (!confirmed) return;
    await handleStatusUpdate({
      label: isAr ? "رفض الطلب" : "Decline Request",
      successLabel: isAr ? "تم رفض الطلب" : "Request Declined",
      mode: "status",
      nextStatus: "declined",
    });
  }, [actionBusy, actor.id, handleStatusUpdate, isAr, request, room?.hasOpenDispute]);

  const handleManualCloseTrade = useCallback(async () => {
    if (!request || manualCloseBusy) return;
    const reason = manualCloseReason.trim();
    const explanation = manualCloseExplanation.trim();
    if (!reason) {
      setStatusMessage(isAr ? "سبب الإغلاق مطلوب." : "Close reason is required.");
      return;
    }
    const mutationKey = `${request.id}:manual-close`;
    if (!acquireTradeRoomMutation(actionInFlightRef, mutationKey)) return;
    setManualCloseBusy(true);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/alpha-exchange/trade-room/${request.id}/close`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, explanation }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; request?: PurchaseRequest };
      if (!response.ok) {
        setStatusMessage(isAr ? "تعذر إغلاق الصفقة يدويًا." : (payload.error ?? "Failed to close trade manually."));
        return;
      }
      if (payload.request && room) {
        const nextRoom = applyRequestToRoom(room, payload.request);
        roomRef.current = nextRoom;
        setRoom(nextRoom);
        writeTradeRoomCache(requestId, actor.id, nextRoom);
      } else {
        await fetchRoom(true);
      }
      setShowManualCloseComposer(false);
      setManualCloseReason("");
      setManualCloseExplanation("");
      setStatusMessage(isAr ? "تم إغلاق الصفقة يدويًا." : "Trade closed manually.");
    } catch {
      setStatusMessage(isAr ? "تعذر إغلاق الصفقة يدويًا." : "Failed to close trade manually.");
    } finally {
      releaseTradeRoomMutation(actionInFlightRef, mutationKey);
      setManualCloseBusy(false);
    }
  }, [actor.id, fetchRoom, isAr, manualCloseBusy, manualCloseExplanation, manualCloseReason, request, requestId, room, setStatusMessage]);

  const handleSubmitBuyerReview = useCallback(async () => {
    if (actionBusy || Boolean(actionInFlightRef.current)) {
      logReviewDiagnostic("validation-failed", { reason: "trade-status-update-in-flight" });
      setStatusMessage(
        isAr
          ? "يتم الآن تثبيت حالة الصفقة. انتظر لحظة ثم أعد الإرسال."
          : "Trade confirmation is still syncing. Please wait a moment, then submit your review.",
      );
      return;
    }
    const currentRequest = roomRef.current?.request ?? request;
    logReviewDiagnostic("validation-started", { hasRequest: Boolean(currentRequest), rating: reviewRating, commentLength: reviewComment.trim().length });
    if (!currentRequest) {
      logReviewDiagnostic("validation-failed", { reason: "missing-request" });
      setStatusMessage(isAr ? "جاري مزامنة الصفقة. حاول مرة أخرى خلال لحظة." : "Trade data is syncing. Please try again in a moment.");
      return;
    }
    const trimmedComment = reviewComment.trim();
    if (!trimmedComment) {
      logReviewDiagnostic("validation-failed", { reason: "empty-comment" });
      setReviewCommentError(isAr ? "يرجى كتابة تقييم قبل الإرسال." : "Please enter a review before submitting.");
      setStatusMessage(isAr ? "يرجى كتابة تعليق قبل إرسال التقييم." : "Please add feedback before submitting rating.");
      reviewCommentInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      reviewCommentInputRef.current?.focus();
      return;
    }
    setReviewCommentError(null);
    if (reviewSubmitInFlightRef.current) {
      logReviewDiagnostic("validation-failed", { reason: "submit-already-in-flight" });
      setStatusMessage(isAr ? "جاري إرسال التقييم بالفعل..." : "Review submission is already in progress...");
      return;
    }
    logReviewDiagnostic("validation-passed", { rating: reviewRating, commentLength: trimmedComment.length });

    reviewSubmitInFlightRef.current = true;
    setReviewBusy(true);
    setStatusMessage(isAr ? "جاري إرسال التقييم..." : "Submitting rating...");
    try {
      const requestUrl = `/api/alpha-exchange/purchase-requests/${currentRequest.id}/review`;
      const diagnosticId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      logReviewDiagnostic("api-request-started", { endpoint: requestUrl, diagnosticId });
      const requestPromise = postTradeReview({
        requestId: currentRequest.id,
        rating: reviewRating,
        comment: trimmedComment,
        diagnosticId,
        mode: currentRequest.sellerId === actor.id ? "seller_buyer_review" : "buyer_review",
      });
      logReviewDiagnostic("api-request-dispatched", { endpoint: requestUrl, diagnosticId });
      const { response, payload } = await requestPromise;
      logReviewDiagnostic("api-response-received", { status: response.status, ok: response.ok });
      if (!response.ok) {
        throw new Error(response.status >= 500
          ? (isAr ? "تعذر تأكيد حفظ التقييم الآن. تعليقك محفوظ هنا؛ حاول الإرسال مجددًا." : "Could not confirm your review was saved. Your feedback is kept here; please submit again.")
          : readApiErrorFallback(payload, isAr ? "تعذر إرسال التقييم." : "Failed to submit review.", isAr));
      }
      if (currentRequest.sellerId === actor.id) {
        const savedReview = payload.sellerBuyerReview;
        if (!savedReview || savedReview.reviewerUserId !== actor.id) throw new Error(isAr ? "تعذر تأكيد حفظ التقييم." : "Could not confirm your review was saved.");
        const latestRoom = roomRef.current;
        if (latestRoom?.request.id === currentRequest.id) {
          const nextRoom = applyRequestToRoom(latestRoom, { ...latestRoom.request, sellerBuyerReview: savedReview, updatedAt: savedReview.createdAt });
          roomRef.current = nextRoom;
          setRoom(nextRoom);
          writeTradeRoomCache(currentRequest.id, actor.id, nextRoom);
        }
        setReviewComment("");
        setStatusMessage(isAr ? "تم حفظ تقييم المشتري." : "Buyer review saved.");
        return;
      }
      if (!payload.review || payload.review.buyerId !== actor.id
        || payload.review.tradeId !== (currentRequest.tradeId ?? currentRequest.id)) {
        throw new Error(isAr ? "تعذر تأكيد حفظ التقييم. حاول الإرسال مجددًا." : "Could not confirm your review was saved. Please submit again.");
      }
      logReviewDiagnostic("success-handler-executed", { status: response.status });
      // The committed review is authoritative. A slow secondary room refresh
      // must not leave the buyer stuck behind a review form after a successful save.
      const latestRoom = roomRef.current;
      if (latestRoom?.request.id === currentRequest.id) {
        const savedReview = payload.review;
        const nextRoom = applyRequestToRoom(latestRoom, {
          ...latestRoom.request,
          buyerReview: {
            reviewerUserId: savedReview.buyerId,
            rating: savedReview.rating,
            comment: savedReview.comment,
            createdAt: savedReview.createdAt,
            hidden: savedReview.hidden,
          },
          updatedAt: savedReview.updatedAt,
        });
        roomRef.current = nextRoom;
        setRoom(nextRoom);
        writeTradeRoomCache(currentRequest.id, actor.id, nextRoom);
      }
      setReviewComment("");
      setReviewDeferred(false);
      if (payload.sellerProgress?.promoted) {
        const previous = payload.sellerProgress.previousRank ?? "previous";
        const current = payload.sellerProgress.newRank ?? "current";
        setStatusMessage(
          isAr
            ? `تم إرسال التقييم. 🎉 ترقية البائع من ${previous} إلى ${current}.`
            : `Feedback submitted. 🎉 Seller promoted from ${previous} to ${current}.`,
        );
      } else {
        setStatusMessage(isAr ? "تم إرسال تقييم البائع." : "Seller rating submitted.");
      }
      startBuyerCompletionSuccessFlow();
    } catch (error) {
      logReviewDiagnostic("error-handler-executed", { error: error instanceof Error ? error.message : "unknown-error" });
      const message = error instanceof TradeReviewTimeoutError
        ? (isAr ? "استغرق تأكيد التقييم وقتًا طويلًا. تعليقك محفوظ هنا؛ حاول الإرسال مجددًا." : "Review confirmation took too long. Your feedback is kept here; please submit again.")
        : localizedCaughtError(error, isAr ? "تعذر إرسال التقييم." : "Failed to submit review.", isAr);
      setReviewCommentError(message);
      setStatusMessage(message);
    } finally {
      reviewSubmitInFlightRef.current = false;
      setReviewBusy(false);
    }
  }, [actionBusy, actor.id, isAr, logReviewDiagnostic, request, reviewComment, reviewRating, setReviewCommentError, setStatusMessage, startBuyerCompletionSuccessFlow]);

  const handleReviewFormSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    logReviewDiagnostic("form-onsubmit-executed");
    void handleSubmitBuyerReview();
  }, [handleSubmitBuyerReview, logReviewDiagnostic]);

  const chatMessageSignature = useMemo(() => (room?.messages ?? [])
    .map((message) => [message.id, message.createdAt, message.deliveredAt ?? "", message.seenAt ?? "", message.deletedAt ?? ""].join("~"))
    .join("^"), [room?.messages]);

  const handleChatScroll = useCallback(() => {
    const chatContainer = chatScrollRef.current;
    if (!chatContainer) return;
    const isNearBottom = isTradeRoomChatNearBottom(
      chatContainer.scrollHeight,
      chatContainer.scrollTop,
      chatContainer.clientHeight,
    );
    chatWasNearBottomRef.current = isNearBottom;
    if (isNearBottom) setHasUnreadChatMessages(false);
  }, []);

  useLayoutEffect(() => {
    const chatContainer = chatScrollRef.current;
    const messages = room?.messages ?? [];
    const knownMessageIds = knownChatMessageIdsRef.current;
    const hasNewCounterpartyMessage = messages.some((message) => (
      !knownMessageIds.has(message.id)
      && !message.id.startsWith("optimistic-")
      && (message.kind === "system" || message.senderUserId !== actor.id)
    ));
    const initialized = chatMessagesInitializedRef.current;
    knownChatMessageIdsRef.current = new Set(messages.map((message) => message.id));
    chatMessagesInitializedRef.current = true;

    if (!chatContainer) return;
    const shouldFollow = shouldAutoScrollTradeRoomChat(chatWasNearBottomRef.current, forceChatScrollRef.current);
    if (shouldFollow) {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "auto" });
      chatWasNearBottomRef.current = true;
      forceChatScrollRef.current = false;
      setHasUnreadChatMessages(false);
      return;
    }
    if (shouldShowTradeRoomNewMessageIndicator({
      initialized,
      wasNearBottom: chatWasNearBottomRef.current,
      hasNewCounterpartyMessage,
    })) {
      setHasUnreadChatMessages(true);
    }
  }, [actor.id, chatMessageSignature, room?.messages]);

  const handleRevealNewChatMessages = useCallback(() => {
    const chatContainer = chatScrollRef.current;
    if (chatContainer) {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
      chatWasNearBottomRef.current = true;
    }
    setHasUnreadChatMessages(false);
  }, []);

  const isActorBuyer = request?.buyerId === actor.id;
  const actorSide: "buyer" | "seller" = isActorBuyer ? "buyer" : "seller";

  const handleChatDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setChatDraft(event.target.value);
    if (chatErrorMessage) setChatErrorMessage(null);
  }, [chatErrorMessage, setChatErrorMessage]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[#050505] px-4 py-6 text-white md:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          <div className="animate-pulse rounded-2xl border border-white/10 bg-black/30 p-6">
            <div className="h-4 w-32 rounded bg-white/10" />
            <div className="mt-3 h-8 w-60 rounded bg-white/10" />
            <div className="mt-4 h-3 w-72 rounded bg-white/10" />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="space-y-4 rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="h-5 w-36 rounded bg-white/10" />
              <div className="h-24 rounded-xl bg-white/5" />
              <div className="h-12 rounded-xl bg-white/5" />
            </div>
            <div className="space-y-4 rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="h-5 w-24 rounded bg-white/10" />
              <div className="h-44 rounded-xl bg-white/5" />
            </div>
          </div>
          <p className="text-sm text-[#D1D5DB]">{isAr ? "جاري تحميل غرفة الصفقة..." : "Loading trade room..."}</p>
        </div>
      </main>
    );
  }

  if (!room || !request) {
    return (
      <main className="min-h-screen bg-[#050505] px-4 py-6 text-white md:px-6">
        <div className="mx-auto max-w-4xl rounded-2xl border border-red-500/25 bg-red-500/10 p-6">
          <h1 className="text-lg font-semibold">{isAr ? "تعذر فتح غرفة الصفقة" : "Unable to open Trade Room"}</h1>
          <p className="mt-2 text-sm text-[#FCA5A5]">{currencyText(errorMessage ?? (isAr ? "الصفقة غير متاحة أو ليس لديك صلاحية الوصول." : "Trade was not found or you do not have access."))}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={() => void fetchRoom()}>
              {isAr ? "إعادة المحاولة" : "Retry"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/usdt-exchange")}>
              {isAr ? "العودة إلى السوق" : "Back to Exchange"}
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const actionFeedback = (statusMessage || actionError || actionNotice) ? (
    <div ref={actionFeedbackRef} tabIndex={-1} data-testid="trade-action-feedback" className="space-y-2 outline-none">
        {statusMessage && !reviewCommentError ? (
          <ActionFeedback autoReveal={false} revealKey={statusMessageFeedbackKey} id="trade-action-result" tabIndex={-1} role="status" aria-live="polite" className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-[#D1D5DB]">
            <div className="flex items-center gap-2">
              {reviewCommentError ? <AlertTriangle className="h-4 w-4 text-red-300" />
                : reviewBusy ? <LoaderCircle className="h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
              <span>{currencyText(statusMessage)}</span>
            </div>
          </ActionFeedback>
        ) : null}

        {actionNotice ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <div className="flex items-center gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>{currencyText(actionNotice)}</span>
            </div>
          </div>
        ) : null}

        {actionError ? (
          <ActionFeedback autoReveal={false} revealKey={actionErrorFeedbackKey} role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>{currencyText(actionError)}</span>
            </div>
          </ActionFeedback>
        ) : null}

    </div>
  ) : null;

  const hasPendingTradeTerms = request.termsProposal?.status === "pending";
  const recordedCashAmount = parseCardlessCashAmount(request.fiatAmount);
  const adjustmentPrice = request.pricePerUsdt || request.listingPriceAtRequest || room.listing?.price || "";
  const adjustmentCashOptions = isCardlessAtmTrade && room.listing
    ? getCardlessCashAmountOptions(adjustmentPrice, room.listing.minimumTrade, Math.min(Number(room.listing.maximumTrade || room.listing.availableAmount), Number(room.listing.availableAmount)), room.request.feePolicyVersion === "buyer_seller_1pct_v1")
    : [];
  const cardlessAmountEditor = isSeller && isCardlessAtmTrade && ["payment_sent", "funds_received"].includes(request.status) ? (
    <div className="space-y-2 text-sm">
      <p>{currencyText(isAr ? `مبلغ السحب: ₪${request.fiatAmount} · السعر المتفق عليه: ₪${adjustmentPrice} لكل USDT` : `Withdrawal: ILS ${request.fiatAmount} · Agreed price: ILS ${adjustmentPrice} per USDT`)}</p>
      <label className="block" htmlFor="adjust-withdrawal-ils">{isAr ? "مبلغ رمز السحب بالشيكل" : "Bank withdrawal amount (ILS)"}</label>
      {recordedCashAmount ? <Input className="currency-money" id="adjust-withdrawal-ils" dir="ltr" readOnly value={recordedCashAmount} /> : <select id="adjust-withdrawal-ils" value={adjustmentIlsAmount} onChange={(event) => setAdjustmentIlsAmount(event.target.value)} disabled={adjustingAmount || actionBusy || room.hasOpenDispute} className="currency-money min-h-11 w-full rounded-xl border border-white/20 bg-[#111] px-3">
        <option value="">{isAr ? "اختر مبلغ رمز المشتري" : "Select the buyer's code amount"}</option>
        {adjustmentCashOptions.map((option) => <option key={option.ilsAmount} value={option.ilsAmount}>{formatMoneyNumber(`₪${option.ilsAmount} · ${option.usdtAmount} USDT`)}</option>)}
      </select>}
      <p className="text-xs text-[#D1D5DB]">{currencyText(isAr ? "تُطابق كمية USDT مع مبلغ رمز المشتري بالسعر المتفق عليه. لا يمكن للبائع تغيير مبلغ الرمز." : "USDT is matched to the buyer's bank code at the agreed price. The seller cannot change the code amount.")}</p>
      <p className="font-semibold text-[#FDE68A]">{currencyText(`${calculateCardlessUsdtAmount(recordedCashAmount || adjustmentIlsAmount, adjustmentPrice, room.request.feePolicyVersion === "buyer_seller_1pct_v1") ?? "—"} USDT`)}</p>
      <Button type="button" variant="secondary" className="min-h-11 w-full" disabled={adjustingAmount || actionBusy || room.hasOpenDispute || (!recordedCashAmount && !adjustmentCashOptions.some((option) => option.ilsAmount === adjustmentIlsAmount))} onClick={() => void recalculateCashAmount()}>{adjustingAmount ? <LoaderCircle className="me-2 h-4 w-4 animate-spin" /> : null}{currencyText(isAr ? "مطابقة USDT مع مبلغ السحب" : "Adjust USDT to withdrawal amount")}</Button>
    </div>
  ) : null;
  const tradeTerms = (
    <TradeTermsPanel key={request.id} request={request} actorId={actor.id} isAr={isAr} disabled={actionBusy || cancelBusy || Boolean(evidenceBusy) || room.hasOpenDispute} amountEditor={cardlessAmountEditor}
                  onBusyChange={(busy) => {
                    const mutationKey = `${request.id}:trade-terms`;
                    if (busy && !acquireTradeRoomMutation(actionInFlightRef, mutationKey)) return false;
                    if (!busy) releaseTradeRoomMutation(actionInFlightRef, mutationKey);
                    setAdjustingAmount(busy);
                    return true;
                  }}
                  onUpdated={(updated) => { if (!roomRef.current || roomRef.current.request.id !== updated.id) return; const nextRoom = applyRequestToRoom(roomRef.current, updated); roomRef.current = nextRoom; setRoom(nextRoom); writeTradeRoomCache(requestId, actor.id, nextRoom); setStatusMessage(isAr ? "تم تحديث شروط الصفقة بنجاح." : "Trade terms updated successfully."); }} />
  );

  const tradeDetails = (
            <details data-testid="trade-details" className="rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-4">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">{isAr ? "تفاصيل الصفقة والأمان" : "Trade details and safety"}<ChevronDown className="ms-auto h-4 w-4" aria-hidden="true" /></summary>
              <div className="mt-3 space-y-3 text-sm text-[#D1D5DB]">
                <p>{isSeller ? (isAr ? "المشتري" : "Buyer") : (isAr ? "البائع" : "Seller")}: <span className="text-white">{currencyText(counterpartName)}</span></p>
                <p>{isAr ? "حسابك" : "Your account"}: {currencyText(publicAccountName(actor))}</p>
                <p>{isAr ? "طريقة الدفع" : "Payment Method"}: {currencyText(requestPaymentMethodLabel)}</p>
                <p>{currencyText(isAr ? "السعر لكل USDT" : "Price per USDT")}: <bdi dir="ltr">{currencyText(`₪${(toNumber(request.pricePerUsdt) || (toNumber(request.fiatAmount) / Math.max(1, toNumber(request.usdtAmount)))).toFixed(2)}`)} / <span className="currency-usdt">USDT</span></bdi></p>
                {request.bankName ? <p>{isAr ? "البنوك المعتمدة" : "Supported Banks"}: {currencyText(requestBankNamesLabel)}</p> : null}
                {request.closedAt ? <p className="text-red-300">{isAr ? "سبب إغلاق الصفقة" : "Close reason"}: {currencyText(request.closeReason ?? (isAr ? "غير محدد" : "Not specified"))}</p> : null}
                <UserSafetyActions context="trade" locale={locale} targetUserId={isSeller ? request.buyerId : request.sellerId} viewerSignedIn />
              </div>
            </details>
  );

  return (
    <main className="min-h-screen bg-[#050505] px-3 py-4 text-white md:px-5 md:py-5 xl:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:gap-5">
        <header data-testid="trade-room-summary" className="space-y-2 rounded-2xl border border-[#C9A227]/25 bg-[#0E0E0E] p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="min-w-0 text-base font-semibold sm:text-lg">{isAr ? "الصفقة" : "Trade"} <bdi dir="ltr">{currencyText(formatTradeId(request.displayNumber, request.tradeId ?? request.id))}</bdi></h1>
            {!showSuccessScreen ? <Button type="button" variant="secondary" size="sm" onClick={() => chatSectionRef.current && revealTradeRoomDeepLinkTarget(chatSectionRef.current)}><MessageCircle className="h-4 w-4" />{isAr ? "الدردشة" : "Chat"}</Button> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <p><bdi dir="ltr" className="font-semibold text-white">{currencyText(`${Math.trunc(toNumber(request.usdtAmount)).toLocaleString("en-US")} USDT`)}</bdi> · <bdi dir="ltr">{currencyText(`${toNumber(request.fiatAmount).toLocaleString("en-IL")} ${request.currency}`)}</bdi></p>
            <p className="text-xs text-[#9CA3AF]">{isAr ? "حالة الاتصال" : "Live updates"}: <span className={streamConnected ? "text-emerald-300" : "text-amber-300"}>{streamConnected ? (isAr ? "متصل" : "Connected") : (isAr ? "إعادة الاتصال..." : "Reconnecting...")}</span></p>
          </div>
          <div className="flex items-center gap-2">
            <div role="progressbar" aria-label={isAr ? "تقدم الصفقة" : "Trade Progress"} aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-gradient-to-r from-[#C9A227] to-[#FDE68A] transition-all duration-300" style={{ width: `${progressPercent}%` }} />
            </div>
            <bdi dir="ltr" className="text-xs text-[#C9A227]">{progressPercent}{isAr ? "٪" : "%"}</bdi>
          </div>
        </header>

        {showSuccessScreen ? (
          isActorBuyer && buyerCompletionSuccessActive ? (
            <div
              className={`transition-[opacity,transform] duration-300 ease-out ${buyerSuccessFadingOut ? "-translate-y-1.5 opacity-0" : "translate-y-0 opacity-100"}`}
            >
              <Card id="action-required" ref={actionRequiredRef} tabIndex={-1} className="border-emerald-500/35 bg-emerald-500/10">
                <div id="status-banner" ref={statusBannerRef} tabIndex={-1}><CardHeader>
                  <CardTitle className="text-2xl">{isAr ? "✅ اكتملت الصفقة بنجاح" : "✅ Trade Completed Successfully"}</CardTitle>
                </CardHeader></div>
                <CardContent className="space-y-3 text-sm text-[#D1FAE5]">
                  {actionFeedback}
                {isCardlessAtmTrade && request.status === "payment_sent" ? room.messages.filter((message) => message.credentialKind === "cardless_code").map((message) => (
                  <div key={message.id} className="important-payment-panel rounded-xl border p-4">
                    <p className="flex items-center gap-2 font-semibold text-red-100"><AttentionSiren />{isAr ? "بيانات السحب المرسلة" : "Submitted withdrawal details"}</p>
                    <p className="mt-2">{isAr ? "بنك السحب" : "Withdrawal bank"}: <strong>{currencyText(requestBankNamesLabel || (isAr ? "غير محدد" : "Not specified"))}</strong></p>
                    <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-base">{currencyText(localizeCardlessWithdrawalMessage(message.message, locale))}</p>
                  </div>
                )) : null}
                  <p>
                    {isAr
                      ? "اكتملت صفقتك بالكامل وتم تسجيلها."
                      : "Your trade has been fully completed and recorded."}
                  </p>
                  <p>
                    {currencyText(isFaceToFaceTrade
                      ? (isAr ? "شكرًا لتأكيد اكتمال التبادل وجهًا لوجه." : "Thank you for confirming that the in-person exchange was completed.")
                      : (isAr ? "شكرًا لتأكيد استلام USDT." : "Thank you for confirming that you received your USDT."))}
                  </p>
                  <p>
                    {isAr
                      ? "تم تحديث ملف المشتري الخاص بك."
                      : "Your buyer profile has been updated."}
                  </p>
                  <p>
                    {isAr
                      ? "يمكنك الآن مواصلة التداول على Alpha Exchange."
                      : "You can now continue trading on Alpha Exchange."}
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-3 py-1.5 text-xs text-[#E5E7EB]">
                    <LoaderCircle className={`h-4 w-4 ${buyerRedirectPending ? "animate-spin" : ""}`} />
                    <span>{isAr ? "جاري الرجوع إلى السوق..." : "Returning to the marketplace..."}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
          <Card id="action-required" ref={actionRequiredRef} tabIndex={-1} className="border-emerald-500/35 bg-emerald-500/10">
            <div id="status-banner" ref={statusBannerRef} tabIndex={-1}><CardHeader>
              <CardTitle className="text-2xl">{isAr ? "🎉 اكتملت الصفقة بنجاح" : "🎉 Trade Completed Successfully"}</CardTitle>
            </CardHeader></div>
            <CardContent className="space-y-3 text-sm text-[#D1FAE5]">
                  {actionFeedback}
              {isActorBuyer && !request.buyerReview ? (
                <div className="rounded-xl border border-emerald-400/30 bg-black/20 p-3">
                  <p className="mb-2 font-medium text-white">{isAr ? "مطلوب قبل الصفقة التالية: قيّم البائع" : "Required before your next trade: Rate Seller & Leave Feedback"}</p>
                  {!showSuccessScreen || actionBusy || Boolean(actionInFlightRef.current) ? (
                    <div className="space-y-2 rounded-xl border border-[#C9A227]/35 bg-[#C9A227]/10 p-3 text-sm text-[#FDE68A]">
                      <div className="inline-flex items-center gap-2">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        <span className="font-medium">
                          {isAr ? "جاري إنهاء تأكيد الصفقة..." : "Finalizing trade confirmation..."}
                        </span>
                      </div>
                      <p className="text-xs text-[#FDE68A]/90">
                        {isAr
                          ? "يرجى الانتظار لحظات حتى يؤكد الخادم اكتمال الصفقة، ثم سيتاح إرسال التقييم."
                          : "Please wait a moment while we complete your trade on the server. Review submission will unlock right after confirmation."}
                      </p>
                    </div>
                  ) : null}
                  {showSuccessScreen && !actionBusy && !actionInFlightRef.current ? (
                  <form className="space-y-2" onSubmit={handleReviewFormSubmit}>
                    <div className="grid gap-2 md:grid-cols-[120px_1fr]">
                      <select
                        value={reviewRating}
                        onChange={(event) => setReviewRating(Number(event.target.value))}
                        aria-label={isAr ? "تقييم البائع" : "Seller rating"}
                        className="h-10 rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white"
                        disabled={reviewBusy || actionBusy}
                      >
                        <option value={5}>★★★★★ (5)</option>
                        <option value={4}>★★★★☆ (4)</option>
                        <option value={3}>★★★☆☆ (3)</option>
                        <option value={2}>★★☆☆☆ (2)</option>
                        <option value={1}>★☆☆☆☆ (1)</option>
                      </select>
                      <Textarea
                        ref={reviewCommentInputRef}
                        value={reviewComment}
                        onChange={(event) => {
                          if (reviewCommentError) setReviewCommentError(null);
                          setReviewComment(event.target.value);
                        }}
                        placeholder={isAr ? "اكتب تقييمك للبائع..." : "Share your seller feedback..."}
                        aria-label={isAr ? "تعليق تقييم البائع" : "Seller review comment"}
                        maxLength={500}
                        className={reviewCommentError ? "border-red-400/60 focus-visible:ring-red-400" : undefined}
                        aria-invalid={reviewCommentError ? true : undefined}
                        disabled={reviewBusy || actionBusy}
                      />
                    </div>
                    {actionBusy ? (
                      <p className="text-xs text-[#FDE68A]">
                        {isAr ? "جاري تثبيت تأكيد الصفقة... يمكنك إرسال التقييم بعد لحظات." : "Finalizing trade confirmation... you can submit your review in a moment."}
                      </p>
                    ) : null}
                    {reviewCommentError ? (
                      <ActionFeedback revealKey={reviewCommentErrorFeedbackKey} as="p" role="alert" className="text-xs text-red-300">{currencyText(reviewCommentError)}</ActionFeedback>
                    ) : null}
                    <Button
                      type="submit"
                      className="mt-2"
                      disabled={reviewBusy || actionBusy}
                      onClick={() => {
                        logReviewDiagnostic("submit-button-clicked", { reviewBusy, actionBusy });
                      }}
                    >
                      {reviewBusy ? (isAr ? "جاري الإرسال..." : "Submitting...") : (isAr ? "إرسال التقييم" : "Submit Rating")}
                    </Button>
                  </form>
                  ) : null}

                </div>
              ) : null}
              {isSeller ? (
                <div className="rounded-xl border border-emerald-400/30 bg-black/20 p-4">
                  <p className="font-medium text-white">{isAr ? "تم إغلاق الصفقة كمكتملة" : "Trade closed as completed"}</p>
                  <p className="mt-1 text-sm">{isAr ? "يمكنك تقييم المشتري أو العودة للرئيسية. تبقى العمولة مستحقة حتى السداد." : "You can review the buyer or return home. Commission remains due until paid."}</p>
                  {request.sellerBuyerReview ? <p className="mt-3">{isAr ? "تم حفظ تقييمك للمشتري" : "Your buyer review is saved"} · {request.sellerBuyerReview.rating}/5</p> : (
                    <details className="mt-3">
                      <summary className="cursor-pointer rounded-xl border border-white/20 p-3 font-semibold">{isAr ? "قيّم المشتري" : "Review buyer"}</summary>
                      <form className="mt-3 space-y-3" onSubmit={handleReviewFormSubmit}>
                        <select aria-label={isAr ? "تقييم المشتري" : "Buyer rating"} value={reviewRating} onChange={(event) => setReviewRating(Number(event.target.value))} disabled={reviewBusy || actionBusy} className="min-h-11 w-full rounded-xl border border-white/20 bg-[#101010] px-3 text-white">
                          {[5,4,3,2,1].map((rating) => <option key={rating} value={rating}>{"★".repeat(rating)} ({rating})</option>)}
                        </select>
                        <Textarea ref={reviewCommentInputRef} aria-label={isAr ? "تعليق عن المشتري" : "Buyer feedback"} placeholder={isAr ? "كيف كانت تجربتك مع المشتري؟" : "How was your experience with this buyer?"} maxLength={500} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} disabled={reviewBusy || actionBusy} />
                        {reviewCommentError ? <ActionFeedback revealKey={reviewCommentErrorFeedbackKey} as="p" role="alert" className="text-red-300">{currencyText(reviewCommentError)}</ActionFeedback> : null}
                        <Button type="submit" disabled={reviewBusy || actionBusy}>{reviewBusy ? (isAr ? "جاري الحفظ..." : "Saving...") : (isAr ? "إرسال التقييم" : "Submit buyer review")}</Button>
                      </form>
                    </details>
                  )}
                  <Button type="button" variant="secondary" className="mt-3 min-h-11 w-full" disabled={actionBusy || reviewBusy} onClick={() => router.push("/usdt-exchange")}>{isAr ? "العودة للرئيسية" : "Return home"}</Button>
                </div>
              ) : null}
              {isFaceToFaceTrade || isCardlessAtmTrade ? (
                <>
                  <p>{isCardlessAtmTrade
                    ? (isAr ? "تم تسجيل صفقة السحب دون بطاقة كمكتملة." : "The Cardless ATM trade has been recorded as complete.")
                    : (isAr ? "تم تسجيل صفقة اللقاء الشخصي كمكتملة." : "The Face-to-Face trade has been recorded as complete.")}</p>
                  <p>{isAr ? "انتقلت الصفقة الآن إلى السجل والمراجعة، وتم تسجيل العمولة المستحقة على البائع." : "The trade is now in history and review, and the seller commission has been recorded."}</p>
                  <p>{currencyText(isAr ? `وقت الإكمال: ${request.completedAt ? new Date(request.completedAt).toLocaleString(dateLocale) : "تم"}` : `Completed: ${request.completedAt ? new Date(request.completedAt).toLocaleString(dateLocale) : "Confirmed"}`)}</p>
                </>
              ) : (
                <>
                  <p>{currencyText(isAr ? `اكتمل تحويل ${Math.trunc(toNumber(request.usdtAmount)).toLocaleString("en-US")} USDT.` : `${Math.trunc(toNumber(request.usdtAmount)).toLocaleString("en-US")} USDT transfer completed.`)}</p>
                  <p>{currencyText(isAr ? "أكد البائع استلام الدفع وإرسال USDT. اكتملت الصفقة." : "Seller confirmed payment and USDT delivery. Trade completed.")}</p>
                  <p>{currencyText(isAr ? `تأكيد البائع: ${request.usdtSentAt ? new Date(request.usdtSentAt).toLocaleString(dateLocale) : "تم"}` : `Seller confirmation: ${request.usdtSentAt ? new Date(request.usdtSentAt).toLocaleString(dateLocale) : "Confirmed"}`)}</p>
                  <p>{currencyText(isAr ? `وقت الإكمال: ${request.completedAt ? new Date(request.completedAt).toLocaleString(dateLocale) : "تم"}` : `Completed: ${request.completedAt ? new Date(request.completedAt).toLocaleString(dateLocale) : "Confirmed"}`)}</p>
                </>
              )}
              {room.sellerCommissionDueCount > 0 && isSeller ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
                  <p className="flex items-center gap-2 font-semibold text-red-100"><AttentionSiren />{isAr ? "عمولة مستحقة" : "Commission Due"}</p>
                  <p>{currencyText(isAr ? `ادفع الآن لألفا: ${formatUsdtAmount(room.sellerPayableCommissionAmount)}` : `Pay Alpha now: ${formatUsdtAmount(room.sellerPayableCommissionAmount)}`)}</p>
                  <p className="text-xs text-amber-100">{request.feePolicyVersion === "buyer_seller_1pct_v1" ? sellerFeeResponsibilityNotice(isAr ? "ar" : "en") : (isAr ? "تظل العمولة الأصلية لهذه الصفقة مستحقة حتى السداد." : "This trade retains its original commission until paid.")}</p>
                  {room.sellerCommissionDueCount > 1 ? <p className="text-xs">{currencyText(isAr ? `إجمالي المستحق: ${formatUsdtAmount(room.sellerCommissionDueAmount)}` : `Total outstanding: ${formatUsdtAmount(room.sellerCommissionDueAmount)}`)}</p> : null}
                  <p className="text-xs">{isAr ? "لن تتمكن من نشر عروض جديدة حتى السداد." : "New listing creation stays blocked until payment is cleared."}</p>
                  <Button type="button" size="sm" className="mt-2" disabled={!room.sellerPayableCommissionId} onClick={() => openCommissionPayNow(room.sellerPayableCommissionId)}>
                    <span aria-hidden="true">💳</span>{isAr ? "ادفع الآن" : "Pay Now"}
                  </Button>
                </div>
              ) : null}
              {isActorBuyer && request.sellerBuyerReview ? <div className="rounded-xl border border-white/15 bg-black/20 p-3">
                <p className="font-medium">{isAr ? "تقييم البائع لك" : "Seller feedback for you"} · {request.sellerBuyerReview.rating}/5</p>
                <p dir="auto" className="mt-2 whitespace-pre-wrap break-words">{currencyText(request.sellerBuyerReview.comment)}</p>
              </div> : null}
              {!showSuccessScreen && isBuyerCompletionSyncInFlight ? (
                <Card className="border-[#C9A227]/35 bg-[#C9A227]/10">
                  <CardContent className="flex items-center gap-3 py-4 text-sm text-[#FDE68A]">
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                    <div>
                      <p className="font-medium">{isAr ? "جاري إنهاء تأكيد الصفقة..." : "Finalizing trade confirmation..."}</p>
                      <p className="text-xs text-[#FDE68A]/90">
                        {isAr
                          ? "يرجى الانتظار لحظة أثناء تثبيت اكتمال الصفقة على الخادم."
                          : "Please wait a moment while we complete your trade on the server."}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
              {isActorBuyer && !request.buyerReview && reviewDeferred ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
                  <p className="font-medium">{isAr ? "تم تأجيل التقييم" : "Feedback deferred"}</p>
                  <p className="mt-1 text-xs">
                    {isAr
                      ? "قبل إنشاء طلب شراء جديد، ستحتاج إلى إكمال تقييم هذه الصفقة."
                      : "Before creating another purchase request, you will need to complete feedback for this trade."}
                  </p>
                  <Button type="button" variant="secondary" className="mt-2" onClick={() => setReviewDeferred(false)}>
                    {isAr ? "إكمال التقييم الآن" : "Complete Feedback Now"}
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => router.push("/usdt-exchange")}>
                  {isAr ? "عرض سجل الصفقات" : "View Trade History"}
                </Button>
              </div>
            </CardContent>
          </Card>
          )
        ) : null}

        {showSuccessScreen ? tradeDetails : null}

        {!showSuccessScreen ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_380px] xl:items-start">
          <div className="space-y-4">
            <Card id="action-required" ref={actionRequiredRef} tabIndex={-1} className="scroll-mt-28 border-white/10 bg-[#0B0B0B]/90">
              <div id="status-banner" ref={statusBannerRef} tabIndex={-1} className={`space-y-2 p-4 pb-3 sm:p-5 sm:pb-3 ${stepPulse ? "ring-1 ring-inset ring-[#C9A227]/30" : ""}`}>
                <p className="text-xs uppercase tracking-[0.14em] text-[#C9A227]">{currencyText(statusBanner?.title ?? (isAr ? "الحالة الحالية" : "Current Status"))}</p>
                <CardTitle className="text-xl leading-snug">{currencyText(hasPendingTradeTerms ? (isSeller ? (isAr ? "بانتظار موافقة المشتري على الشروط" : "Waiting for the Buyer to Review the Terms") : (isAr ? "راجع شروط الصفقة المقترحة" : "Review the Proposed Trade Terms")) : statusBanner?.headline ?? tradeStatusLabel(request.status, isAr, isOverdueTrade, isCashTrade))}</CardTitle>
                <p className="text-sm text-[#D1D5DB]">{currencyText(hasPendingTradeTerms ? (isAr ? "يجب تأكيد الشروط قبل متابعة الدفع أو إرسال USDT." : "Confirm the terms before continuing with payment or sending USDT.") : statusBanner?.detail ?? turn?.detail)}</p>
              </div>
              <CardContent className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
                {hasPendingTradeTerms ? tradeTerms : null}
                {primaryAction ? (
                  <div data-testid="trade-primary-action" className="space-y-2">
                    <Button
                      type="button"
                      className="h-auto min-h-12 w-full whitespace-normal px-4 py-3 text-center text-sm font-semibold leading-5 sm:text-base"
                      disabled={primaryActionLoading || actionBusy || Boolean(evidenceBusy) || adjustingAmount || Boolean(primaryActionDisabledReason)}
                      onClick={() => void handlePrimaryAction()}
                    >
                      {primaryActionLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          <span>{isAr ? "جاري التنفيذ..." : "Processing..."}</span>
                        </span>
                      ) : <><span aria-hidden="true">{primaryAction.mode === "status" && primaryAction.nextStatus === "completed" ? "✅" : "⚡"}</span>{primaryActionButtonLabel}</>}
                    </Button>
                    {primaryActionDisabledReason ? <p className="text-xs text-amber-300">{currencyText(primaryActionDisabledReason)}</p> : null}
                    {!isSeller && request.status === "accepted" && !isCashTrade ? (
                      <p className="text-xs text-[#9CA3AF]">
                        {isAr ? "زر الإجراء الرئيسي سيقودك خلال الخطوة التالية مباشرة." : "The primary action above always guides you to the next step."}
                      </p>
                    ) : null}
                  </div>
                ) : !hasPendingTradeTerms ? (
                  <p className="text-sm text-[#9CA3AF]">{isAr ? "لا يوجد إجراء مطلوب الآن." : "No required action at this moment."}</p>
                ) : null}
                {(canBuyerCancelTrade(request, actor.id) || canSellerCancelTrade(request, actor.id)) ? (
                  <div data-testid="trade-cancel-action" className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
                    <Button type="button" variant="secondary" className="min-h-11 w-full"
                      disabled={(!canBuyerCancelTrade(request, actor.id) && !canSellerCancelTrade(request, actor.id)) || room.hasOpenDispute || cancelBusy || actionBusy || Boolean(evidenceBusy) || adjustingAmount}
                      aria-describedby="trade-cancel-help"
                      onClick={() => void (isSeller && request.status === "pending" ? handleDeclineTrade() : handleCancelTrade())}>
                      {cancelBusy ? (isAr ? "جاري الإلغاء..." : "Cancelling...") : (isAr ? "إلغاء الصفقة" : "Cancel Trade")}
                    </Button>
                    <p id="trade-cancel-help" className="text-xs text-[#9CA3AF]">
                      {currencyText(room.hasOpenDispute
                        ? (isAr ? "الإلغاء مقفل أثناء مراجعة النزاع." : "Cancellation is locked while the dispute is under review.")
                        : request.status === "pending"
                        ? (isAr ? "يمكن إلغاء الطلب قبل القبول ما دام لم يتم تبادل مال أو نقد أو USDT." : "Cancel this pending request only if no money, cash or USDT has been exchanged.")
                        : canBuyerCancelTrade(request, actor.id) || canSellerCancelTrade(request, actor.id)
                          ? (isAr ? "يمكن لأي طرف الإلغاء قبل إرسال أو استلام المال أو النقد أو USDT، وقبل مشاركة رمز السحب أو إثبات الدفع." : "Either participant can cancel before money, cash or USDT is sent or received, and before withdrawal details or payment evidence are shared.")
                          : (isAr ? "الإلغاء مقفل بعد بدء الدفع أو مشاركة رمز السحب. أكمل الصفقة أو افتح نزاعاً عند وجود مشكلة." : "Cancellation is locked after payment starts or withdrawal details are shared. Complete the trade or open a dispute if there is a problem."))}
                    </p>
                  </div>
                ) : null}
                {!hasPendingTradeTerms ? tradeTerms : null}

                {isCardlessAtmTrade && isActorBuyer && request.status === "accepted" && !hasPendingTradeTerms ? (
                  <CardlessWithdrawalFields isAr={isAr} disabled={actionBusy} code={cardlessCode}
                    verificationKind={cardlessVerificationKind} verificationValue={cardlessVerificationValue}
                    onCodeChange={setCardlessCode} onKindChange={setCardlessVerificationKind} onValueChange={setCardlessVerificationValue} />
                ) : null}
                {primaryAction?.mode === "upload" ? (
                  <div className="space-y-2" data-testid="trade-evidence-picker">
                    <Input ref={primaryAction.uploadSide === "buyer" ? buyerEvidenceInputRef : sellerEvidenceInputRef} type="file" tabIndex={-1} accept=".png,.jpg,.jpeg,.webp,.pdf" className="sr-only"
                      aria-label={primaryAction.uploadSide === "buyer" ? (isAr ? "اختيار إيصال الدفع" : "Choose payment receipt") : (isAr ? "اختيار إثبات إرسال USDT" : "Choose USDT release proof")}
                      disabled={actionBusy || Boolean(evidenceBusy)} onChange={(event) => (primaryAction.uploadSide === "buyer" ? setBuyerEvidenceFile : setSellerEvidenceFile)(event.target.files?.[0] ?? null)} />
                    {(primaryAction.uploadSide === "buyer" ? buyerEvidenceFile : sellerEvidenceFile) ? <p className="break-all text-xs text-[#C9A227]">{isAr ? "الملف المحدد" : "Selected file"}: <bdi dir="ltr">{currencyText((primaryAction.uploadSide === "buyer" ? buyerEvidenceFile : sellerEvidenceFile)?.name)}</bdi></p> : null}
                    <Button type="button" variant="secondary" size="sm" className="min-h-11 w-full" disabled={actionBusy || Boolean(evidenceBusy)} onClick={() => (primaryAction.uploadSide === "buyer" ? buyerEvidenceInputRef : sellerEvidenceInputRef).current?.click()}>
                      <Upload className="h-4 w-4" aria-hidden="true" />{(primaryAction.uploadSide === "buyer" ? buyerEvidenceFile : sellerEvidenceFile) ? (isAr ? "تغيير الملف" : "Change File") : primaryAction.uploadSide === "buyer" ? (isAr ? "اختيار إيصال الدفع" : "Choose Payment Receipt") : (isAr ? "اختيار إثبات البائع" : "Choose Seller Proof")}
                    </Button>
                  </div>
                ) : null}
                {actionFeedback}
                {request.feePolicyVersion === "buyer_seller_1pct_v1" ? <div className="rounded-xl border border-emerald-500/30 p-3 text-sm">
                  <p>{isSeller
                    ? sellerFeeResponsibilityNotice(isAr ? "ar" : "en")
                    : (isAr ? "عمولتك كمشتري 1% مشمولة في إجمالي الدفع الظاهر. تدفعها للبائع بنفس وسيلة دفع الصفقة، وتستلم كامل كمية USDT المتفق عليها." : "Your buyer fee of 1% is included in the displayed payment total. Pay it to the seller using the trade payment method. You receive the full agreed USDT amount.")}</p>
                </div> : null}
                {canRevealBankDetails ? (
                  <div className="important-payment-panel rounded-2xl border p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-red-100"><AttentionSiren key={bankDetails ? "revealed" : "locked"} />{isAr ? "تفاصيل الدفع البنكي" : "Bank Payment Details"}</p>
                    {bankDetailsBusy ? (
                      <p className="mt-2 text-sm text-[#D1D5DB]">{isAr ? "جارٍ تحميل تفاصيل الحساب البنكي..." : "Loading bank account details..."}</p>
                    ) : bankDetailsError ? (
                      <ActionFeedback revealKey={bankDetailsErrorFeedbackKey} as="p" role="alert" className="mt-2 text-sm text-amber-200">{currencyText(bankDetailsError)}</ActionFeedback>
                    ) : bankDetails ? (
                      <div className="mt-2 space-y-1 text-sm text-[#E5E7EB]">
                        {bankDetails.accountHolderName ? <p>{isAr ? "اسم صاحب الحساب" : "Account holder"}: <span className="text-white"><bdi dir="auto">{currencyText(bankDetails.accountHolderName)}</bdi></span></p> : null}
                        <p>{isAr ? "اسم البنك" : "Bank"}: <span className="text-white"><bdi dir="auto">{currencyText(getIsraeliBankDisplayName(bankDetails.bankName, locale))}</bdi></span></p>
                        <p>{isAr ? "رقم الفرع" : "Branch"}: <span className="text-white"><bdi dir="ltr">{currencyText(bankDetails.branchNumber)}</bdi></span></p>
                        <p>{isAr ? "رقم الحساب" : "Account number"}: <span className="font-mono text-white"><bdi dir="ltr">{currencyText(bankDetails.accountNumber)}</bdi></span></p>
                      </div>
                    ) : (
                      <div className="mt-2 space-y-3 text-sm text-[#D1D5DB]">
                        <p>{isAr ? "اعرض التفاصيل للتحقق من الحساب. يبقى الإلغاء متاحاً حتى ترسل الدفعة أو إثباتها." : "Reveal the details to verify the account. Cancellation remains available until you submit payment or payment evidence."}</p>
                        <Button type="button" onClick={() => void handleRevealBankDetails()}>
                          {isAr ? "إظهار تفاصيل البنك" : "Reveal Bank Details"}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : !isSeller && request.status === "pending" && isBankTransferPaymentMethod(requestPaymentMethod) ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-[#9CA3AF]">
                    {request.priceMode === "buyer_offer"
                      ? (isAr ? "عرض السعر بانتظار قرار البائع. ستظهر تفاصيل الحساب البنكي بعد موافقته." : "Your price offer is waiting for the seller. Bank details appear after acceptance.")
                      : (isAr ? "تفاصيل الحساب البنكي ستكون متاحة بعد قبول البائع للصفقة." : "Bank details become available after the seller accepts the trade.")}
                  </div>
                ) : null}

                {sellerWalletAddress ? (
                  <div className="rounded-2xl border-2 border-[#C9A227]/65 bg-gradient-to-br from-[#C9A227]/20 via-black/70 to-[#6CAEFF]/10 p-4 shadow-[0_0_28px_rgba(201,162,39,0.18)]">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#FDE68A]">
                          {isAr ? "محفظة استلام المشتري" : "Buyer Receiving Wallet"}
                        </p>
                        <p className="mt-2 text-sm text-[#D1D5DB]">
                          {currencyText(isAr
                            ? `أرسل USDT فقط عبر شبكة ${request.network} إلى هذا العنوان.`
                            : `Send USDT ONLY on ${request.network} to this address.`)}
                        </p>
                        <p dir="ltr" className="mt-3 break-all rounded-xl border border-white/10 bg-black/45 p-3 text-left font-mono text-sm text-white">
                          {currencyText(sellerWalletAddress)}
                        </p>
                        <Button type="button" variant="secondary" className="mt-3 w-full sm:w-auto" onClick={() => void copySellerWallet()}>
                          <Copy className="mr-2 h-4 w-4" />
                          {walletCopied ? (isAr ? "تم النسخ" : "Copied") : (isAr ? "نسخ العنوان" : "Copy Address")}
                        </Button>
                      </div>
                      {walletQrDataUrl ? (
                        <details className="shrink-0 text-sm">
                          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-[#FDE68A]">{isAr ? "إظهار رمز QR" : "Show QR code"}<ChevronDown className="h-4 w-4" aria-hidden="true" /></summary>
                          <div className="mt-2 w-fit rounded-xl bg-white p-2"><Image src={walletQrDataUrl} alt={isAr ? "رمز QR لمحفظة المشتري" : "Buyer wallet QR code"} width={176} height={176} unoptimized /></div>
                        </details>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <details className="text-xs text-[#9CA3AF]">
                  <summary className="flex min-h-11 cursor-pointer items-center">{isAr ? "تفاصيل المرحلة والتحديثات" : "Step details and updates"}<ChevronDown className="ms-auto h-4 w-4" aria-hidden="true" /></summary>
                  <div className="space-y-2 pb-2">
                    <p>{currencyText(statusBanner?.yourAction)}</p>
                    <p>{currencyText(statusBanner?.counterpartyAction)}</p>
                    <p>{currencyText(waitingEstimate)}</p>
                    <p>{deliveryConfirmation}</p>
                  </div>
                </details>
                  {request.priceMode === "buyer_offer" ? (
                    <div className="mt-3 rounded-xl border border-[#C9A227]/35 bg-[#C9A227]/10 p-3 text-sm text-[#F4D87A]">
                      <p className="font-semibold">{request.priceOfferAcceptedAt ? (isAr ? "صفقة بسعر متفاوض عليه" : "Negotiated-price trade") : (isAr ? "عرض السعر" : "Price offer")}</p>
                      <p className="mt-1 text-[#E5E7EB]">
                        {currencyText(request.priceOfferAcceptedAt
                          ? (isAr
                            ? `وافق البائع على سعر ₪${toNumber(request.pricePerUsdt).toFixed(2)} لكل USDT بدلاً من سعر العرض الأصلي ₪${toNumber(request.listingPriceAtRequest).toFixed(2)}.`
                            : `The seller accepted ₪${toNumber(request.pricePerUsdt).toFixed(2)} per USDT instead of the original ₪${toNumber(request.listingPriceAtRequest).toFixed(2)} listing price.`)
                          : (isAr
                            ? `اقترح المشتري سعر ₪${toNumber(request.pricePerUsdt).toFixed(2)} لكل USDT. سعر العرض الأصلي هو ₪${toNumber(request.listingPriceAtRequest).toFixed(2)}.`
                            : `The buyer offered ₪${toNumber(request.pricePerUsdt).toFixed(2)} per USDT. The original listing price is ₪${toNumber(request.listingPriceAtRequest).toFixed(2)}.`))}
                      </p>
                    </div>
                  ) : null}
                {isSeller && request.status === "accepted" && !isCashTrade ? (
                  <div className="rounded-xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 p-3 text-sm text-[#DBEAFE]">
                    <p className="font-medium text-white">{isAr ? "بانتظار دفع المشتري" : "Waiting for Buyer Payment"}</p>
                    <p className="mt-1">
                      {isAr
                        ? "بانتظار المشتري لرفع إيصال الدفع. لا يمكنك المتابعة قبل إرسال الدفع."
                        : "Waiting for the buyer to upload their payment receipt. You cannot continue until the buyer submits payment."}
                    </p>
                  </div>
                ) : null}

                {request.inactivityWarningSentAt ? (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/12 p-3 text-sm text-amber-100">
                    <p className="font-medium">{isAr ? "تحذير عدم النشاط" : "Inactivity warning"}</p>
                    <p className="mt-1">
                      {currencyText(isAr
                        ? `تم إرسال تحذير بسبب عدم النشاط في ${new Date(request.inactivityWarningSentAt).toLocaleString(dateLocale)}. أكمل الخطوة الحالية لتجنب التأخير.`
                        : `An inactivity warning was sent at ${new Date(request.inactivityWarningSentAt).toLocaleString(dateLocale)}. Complete the current step to avoid delays.`)}
                    </p>
                  </div>
                ) : null}

                {request.status === "pending" ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-red-100">{isAr ? "إغلاق يدوي للصفقة" : "Manual trade close"}</p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={manualCloseBusy}
                        onClick={() => setShowManualCloseComposer((value) => !value)}
                      >
                        {showManualCloseComposer
                          ? (isAr ? "إلغاء" : "Cancel")
                          : (isAr ? "إغلاق الصفقة" : "Close Trade")}
                      </Button>
                    </div>
                    {showManualCloseComposer ? (
                      <div className="mt-2 space-y-2">
                        <Input
                          value={manualCloseReason}
                          onChange={(event) => setManualCloseReason(event.target.value)}
                          aria-label={isAr ? "سبب إغلاق الصفقة" : "Trade close reason"}
                          placeholder={isAr ? "سبب الإغلاق (مطلوب)" : "Close reason (required)"}
                          maxLength={120}
                        />
                        <Textarea
                          value={manualCloseExplanation}
                          onChange={(event) => setManualCloseExplanation(event.target.value)}
                          aria-label={isAr ? "تفاصيل إضافية" : "Additional details"}
                          placeholder={isAr ? "تفاصيل إضافية (اختياري)" : "Additional details (optional)"}
                          maxLength={1000}
                        />
                        <Button type="button" size="sm" disabled={manualCloseBusy} onClick={() => void handleManualCloseTrade()}>
                          {manualCloseBusy
                            ? (isAr ? "جارٍ الإغلاق..." : "Closing...")
                            : (isAr ? "تأكيد الإغلاق اليدوي" : "Confirm Manual Close")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {room.canOpenDispute && !room.hasOpenDispute ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-[#FDE68A]">{isAr ? "هل تحتاج إلى فتح نزاع؟" : "Need to open a dispute?"}</p>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setShowDisputeComposer((value) => !value)}>
                        {showDisputeComposer ? (isAr ? "إغلاق" : "Close") : (isAr ? "فتح نزاع" : "Open Dispute")}
                      </Button>
                    </div>
                    {showDisputeComposer ? (
                      <div className="mt-2 space-y-2">
                        <Textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} aria-label={isAr ? "سبب النزاع" : "Dispute reason"} placeholder={isAr ? "اكتب سبب النزاع..." : "Describe the dispute reason..."} maxLength={500} />
                        <Button type="button" size="sm" disabled={disputeBusy || !disputeReason.trim()} onClick={() => void handleOpenDispute()}>
                          {disputeBusy ? (isAr ? "جاري الإرسال..." : "Submitting...") : (isAr ? "تأكيد فتح النزاع" : "Submit Dispute")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {tradeDetails}

            <details data-testid="trade-progress-details" className="rounded-2xl border border-white/10 bg-black/65 p-3 backdrop-blur-md">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-white">
            <span className="min-w-0 truncate">
              <span className="text-[#9CA3AF]">{isAr ? "الخطوة الحالية" : "Current step"}: </span>
              <span className="font-semibold text-[#FDE68A]">{currencyText(tradeStepLabel(tradeSteps[currentStepIndex], isAr, request.priceMode === "buyer_offer"))}</span>
            </span>
            <span className="shrink-0 text-xs text-[#C9A227]"><bdi dir="ltr">{progressPercent}{isAr ? "٪" : "%"}</bdi></span>
          </summary>
          <div className="mt-3 space-y-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-gradient-to-r from-[#C9A227] to-[#FDE68A]" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[10px] text-[#9CA3AF]">
              {tradeSteps.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => setSelectedStep(step.id)}
                  className={`min-h-11 rounded-lg border px-1.5 py-1.5 text-center ${index === currentStepIndex ? "border-[#C9A227]/60 bg-[#C9A227]/15 text-[#FDE68A]" : index < currentStepIndex ? "border-emerald-400/30 text-emerald-300" : "border-white/10"}`}
                >
                  {currencyText(tradeStepLabel(step, isAr, request.priceMode === "buyer_offer"))}
                </button>
              ))}
            </div>
            {selectedStepEvent ? <p className="text-xs text-[#9CA3AF]">{currencyText(timelineEventLabel(selectedStepEvent, isAr))}</p> : null}
          </div>
        </details>


            {!isCashTrade ? (
            <Card id="evidence" ref={evidenceSectionRef} tabIndex={-1} className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle className="text-lg">{isAr ? "قسم الإثبات" : "Evidence"}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="font-medium text-white">{isAr ? "إيصال دفع المشتري" : "Buyer Payment Receipt"}</p>
                  {canShowBuyerReceipt ? (
                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.buyerEvidence!.id}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[#C9A227] hover:underline">
                      {currencyText(request.buyerEvidence!.fileName)}
                    </a>
                  ) : (
                    <p className="mt-2 text-[#9CA3AF]">
                      {isSeller && request.status === "accepted"
                        ? (isAr ? "سيظهر إيصال المشتري هنا بعد إرسال الدفع." : "The buyer receipt will appear here after payment is submitted.")
                        : (isAr ? "لم يتم الرفع بعد." : "Not uploaded yet.")}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="font-medium text-white">{isAr ? "إثبات البائع" : "Seller Release Proof"}</p>
                  {request.sellerEvidence ? (
                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.sellerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[#C9A227] hover:underline">
                      {currencyText(request.sellerEvidence.fileName)}
                    </a>
                  ) : (
                    <p className="mt-2 text-[#9CA3AF]">
                      {currencyText(sellerEvidenceUploadOpen
                        ? (isAr ? "بانتظار رفع إثبات البائع." : "Waiting for seller upload.")
                        : (isAr ? "سيتم تمكين الرفع عند مرحلة إصدار USDT." : "Upload will be available at the USDT release stage."))}
                    </p>
                  )}
                  {actorSide === "seller" && sellerEvidenceUploadOpen && primaryAction?.mode !== "upload" ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-[#9CA3AF]">
                        {currencyText(sellerEvidenceRequired
                          ? (isAr ? "رفع الإثبات مطلوب قبل تأكيد إرسال USDT." : "Seller evidence is required before marking USDT sent.")
                          : (isAr ? "يمكنك رفع إثبات اختياري قبل تأكيد إرسال USDT." : "You may upload optional evidence before marking USDT sent."))}
                      </p>
                      <Input
                        ref={sellerEvidenceInputRef}
                        disabled={actionBusy || Boolean(evidenceBusy)}
                        type="file"
                        tabIndex={-1}
                        accept=".png,.jpg,.jpeg,.webp,.pdf"
                        className="sr-only"
                        aria-label={isAr ? "اختيار إثبات إرسال USDT" : "Choose USDT release proof"}
                        onChange={(event) => setSellerEvidenceFile(event.target.files?.[0] ?? null)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="min-h-11 w-full"
                        disabled={actionBusy || Boolean(evidenceBusy)}
                        onClick={() => sellerEvidenceInputRef.current?.click()}
                      >
                        <Upload className="h-4 w-4" aria-hidden="true" />
                        {sellerEvidenceFile
                          ? (isAr ? "تغيير الملف" : "Change File")
                          : (isAr ? "اختيار إثبات البائع" : "Choose Seller Proof")}
                      </Button>
                      {sellerEvidenceFile ? (
                        <div className="space-y-2">
                          <p className="text-xs text-[#C9A227]">
                            {isAr ? "الملف المحدد" : "Selected file"}: <bdi dir="ltr">{currencyText(sellerEvidenceFile.name)}</bdi>
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="secondary" onClick={() => {
                              setSellerEvidenceFile(null);
                              if (sellerEvidenceInputRef.current) sellerEvidenceInputRef.current.value = "";
                            }}>
                              {isAr ? "إزالة الملف" : "Remove File"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-[#9CA3AF]">
                          {isAr ? "اختر ملفًا للرفع. يمكنك الاستبدال لاحقًا قبل المتابعة." : "Choose a file to upload. You can replace it before continuing."}
                        </p>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        loading={evidenceBusy === "seller"}
                        loadingLabel={isAr ? "جارٍ الرفع..." : "Uploading..."}
                        disabled={!sellerEvidenceFile || actionBusy || Boolean(evidenceBusy)}
                        onClick={() => void handleUploadEvidence("seller")}
                      >
                        {request.sellerEvidence
                          ? (isAr ? "استبدال الرفع" : "Replace Upload")
                          : (isAr ? "رفع إثبات البائع" : "Upload Seller Evidence")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
            ) : null}

            <div id={isCashTrade ? "evidence" : undefined} ref={isCashTrade ? evidenceSectionRef : undefined} tabIndex={-1}>
              <details open={!isCashTrade && Boolean(room.releaseDeadlineActive)} className="group rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-4">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#C9A227]" />
                  {currencyText(isCashTrade ? (isAr ? "كيفية إتمام الصفقة · لا يلزم رفع صورة" : "How this trade works · No photo required") : (isAr ? "مهلة إصدار USDT" : "USDT Release Deadline"))}
                  <ChevronDown className="ms-auto h-4 w-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="mt-3 space-y-3 text-sm text-[#D1D5DB]">
                  {isCashTrade ? (
                    <>
                      <p className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-emerald-100">
                        {currencyText(isFaceToFaceTrade
                          ? (isAr ? "💵 يؤكد المشتري تسليم النقد ← يؤكد البائع الاستلام ← يرسل USDT إلى المحفظة الظاهرة ← ✅ يكمل الصفقة." : "💵 Buyer confirms cash → Seller confirms receipt → Seller sends USDT to the revealed wallet → ✅ Complete trade.")
                          : isAr
                          ? "1) يؤكد المشتري النقد أو الرمز. 2) يؤكد البائع استلام النقد. 3) تظهر المحفظة. 4) يؤكد البائع إرسال USDT. 5) يحدد البائع الصفقة كمكتملة."
                          : "1) Buyer confirms the cash or code. 2) Seller confirms cash received. 3) Wallet is revealed. 4) Seller confirms USDT sent. 5) Seller marks the trade completed.")}
                      </p>
                      <p className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-amber-100">
                        {isAr
                          ? "لا يحتاج أي طرف إلى رفع صورة. يظل عنوان محفظة المشتري مخفيًا عن البائع حتى يؤكد البائع استلام النقد فعليًا."
                          : "Neither side uploads a photo. The buyer wallet stays hidden from the seller until the seller confirms actual cash receipt."}
                      </p>
                    </>
                  ) : room.releaseDeadlineActive && timeRemainingSeconds !== null ? (
                    <div className={`rounded-xl border p-4 ${
                      deadlineCritical
                        ? "border-red-500/40 bg-red-500/15 text-red-100"
                        : deadlineWarning
                          ? "border-amber-500/45 bg-amber-500/15 text-amber-100"
                          : "border-[#C9A227]/35 bg-[#C9A227]/10 text-[#FDE68A]"
                    }`}>
                      <p className="text-xs uppercase tracking-[0.14em]">{isAr ? "الوقت المتبقي" : "Time Remaining"}</p>
                      <p className="mt-1 text-3xl font-bold">{currencyText(formatDuration(timeRemainingSeconds))}</p>
                      {(room.releaseDeadlineOverdue || room.isOverdue) ? <p className="mt-2 text-sm text-red-200">{isAr ? "انتهت المهلة — تم وضع الصفقة كمتأخرة." : "Deadline reached — trade is overdue."}</p> : null}
                    </div>
                  ) : (
                    <p>{currencyText(isAr ? "سيبدأ عداد 45 دقيقة بعد تأكيد استلام الدفع وبدء مرحلة إصدار USDT." : "The 45-minute timer starts when seller confirms funds and enters USDT release stage.")}</p>
                  )}
                  {!isCashTrade ? (
                    <p className="rounded-xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 p-3">
                      {currencyText(isAr ? "تذكير الإرسال: يرسل البائع USDT فقط بعد تأكيد الدفع داخل Alpha Exchange." : "Release reminder: The seller sends USDT only after confirming payment inside Alpha Exchange.")}
                    </p>
                  ) : null}
                  {!isCashTrade && room.releaseDeadlineActive ? (
                    <p className="rounded-xl border border-red-500/35 bg-red-500/10 p-3 text-xs text-red-100">
                      {isSeller
                        ? (isAr
                            ? "يجب إكمال الصفقة قبل انتهاء المؤقت. قد يؤثر التأخير المتكرر أو عدم إرسال الأموال في سمعتك كبائع وعروضك المستقبلية، وقد يؤدي إلى مراجعة إدارية."
                            : "You must complete this trade before the timer expires. Repeated delays or failure to deliver funds may affect your seller reputation, future listings, and may result in administrative review.")
                        : (isAr
                            ? "يجب تأكيد الاستلام قبل انتهاء المؤقت واتباع قواعد المنصة. قد يؤثر التأخير المتكرر أو التأكيد غير الصحيح في حالة حسابك ويؤدي إلى مراجعة إدارية."
                            : "You must confirm receipt before the timer expires and follow platform rules. Repeated delays or inaccurate confirmations may affect your account standing and can trigger administrative review.")}
                    </p>
                  ) : null}
                </div>
              </details>

            </div>


            <details className="group rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-4">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 font-semibold">
                {isAr ? "الخط الزمني للصفقة" : "Trade Timeline"}
                <span className="ms-auto text-xs font-normal text-[#9CA3AF]">{activeTimeline.length}</span><ChevronDown className="h-4 w-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-3 space-y-2">
                {visibleTimeline.length ? (
                  visibleTimeline.map(({ event, count }) => (
                    <div key={event.id} className="flex gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-[#C9A227]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-white">{currencyText(timelineEventLabel(event, isAr))}</p>
                          {count > 1 ? <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-[#D1D5DB]">×{count}</span> : null}
                        </div>
                        <p className="text-xs text-[#9CA3AF]">{new Date(event.createdAt).toLocaleString(dateLocale)}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#9CA3AF]">{isAr ? "لا توجد أحداث بعد." : "No timeline events yet."}</p>
                )}
                {activeTimeline.length > 4 ? (
                  <Button type="button" size="sm" variant="secondary" className="w-full" onClick={() => setShowAllTimeline((value) => !value)}>
                    {currencyText(showAllTimeline
                      ? (isAr ? "عرض أحدث التحديثات فقط" : "Show Latest Updates Only")
                      : (isAr ? `عرض كل التحديثات (${activeTimeline.length})` : `Show All Updates (${activeTimeline.length})`))}
                  </Button>
                ) : null}
              </div>
            </details>
          </div>

          <div className="space-y-4 xl:sticky xl:top-28">
            <Card id="chat" ref={chatSectionRef} tabIndex={-1} className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-lg"><MessageCircle className="h-4 w-4 text-[#C9A227]" />{isAr ? "الدردشة المباشرة" : "Live Chat"}</CardTitle>
                <Button type="button" variant="secondary" size="sm" onClick={() => actionRequiredRef.current && revealTradeRoomDeepLinkTarget(actionRequiredRef.current)}>{isAr ? "الخطوة الحالية" : "Current step"}</Button>
                {pokeAvailable ? (
                  <div className="w-full sm:w-auto">
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-10 w-full whitespace-normal sm:w-auto"
                      disabled={!canSendPoke}
                      onClick={() => void handlePoke()}
                    >
                      {pokeBusy ? (
                        <span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" />{isAr ? "جارٍ التنبيه..." : "Notifying..."}</span>
                      ) : canSendPoke ? (
                        <span className="inline-flex items-center gap-2"><BellRing className="h-4 w-4" />{currencyText(isAr ? `تنبيه ${pokeCounterpartLabel}` : `Poke ${pokeCounterpartLabel}`)}</span>
                      ) : (
                        isAr
                          ? `يمكنك التنبيه مجددًا خلال ${formatDuration(pokeCooldownRemainingSeconds)}`
                          : `Poke again in ${formatDuration(pokeCooldownRemainingSeconds)}`
                      )}
                    </Button>
                    {pokeResult ? <p role={pokeResult.error ? "alert" : "status"} className={`mt-2 text-xs ${pokeResult.error ? "text-red-300" : "text-emerald-300"}`}>{currencyText(pokeResult.message)}</p> : null}
                    {!canSendPoke && !pokeBusy ? (
                      <p className="mt-1 text-center text-[11px] text-[#9CA3AF] sm:text-right">
                        {isAr ? "يتم فرض فترة الانتظار على الخادم." : "The server enforces this cooldown."}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#D1D5DB]" aria-label={isAr ? "طرفا الدردشة" : "Chat participants"}>
                  <span>{isAr ? "المشتري" : "Buyer"} · <bdi dir="ltr" className="font-semibold text-[#F5D77B]">{tradeChatPublicId(room, "buyer")}</bdi></span>
                  <span>{isAr ? "البائع" : "Seller"} · <bdi dir="ltr" className="font-semibold text-[#F5D77B]">{tradeChatPublicId(room, "seller")}</bdi></span>
                </div>
                <details className="rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-[#D1D5DB]">
                  <summary className="flex min-h-11 cursor-pointer items-center">{isAr ? "تفاصيل الصفقة" : "Trade details"}<ChevronDown className="ms-auto h-4 w-4" aria-hidden="true" /></summary>
                  <div className="grid gap-1 pb-3 md:grid-cols-2 xl:grid-cols-3">
                    <p><span className="text-[#9CA3AF]">{isAr ? "الحالة" : "Status"}:</span> {currencyText(tradeStatusLabel(request.status, isAr, isOverdueTrade, isCashTrade))}</p>
                    <p><span className="text-[#9CA3AF]">{isAr ? "البائع" : "Seller"}:</span> <bdi dir="ltr">{tradeChatPublicId(room, "seller")}</bdi></p>
                    <p><span className="text-[#9CA3AF]">{isAr ? "المشتري" : "Buyer"}:</span> <bdi dir="ltr">{tradeChatPublicId(room, "buyer")}</bdi></p>
                    <p><span className="text-[#9CA3AF]">{isAr ? "المبلغ" : "Amount"}:</span> <bdi dir="ltr">{currencyText(`${Math.trunc(toNumber(request.usdtAmount)).toLocaleString("en-US")} USDT`)}</bdi></p>
                    <p><span className="text-[#9CA3AF]">{isAr ? "الشبكة" : "Network"}:</span> <bdi dir="ltr">{request.network}</bdi></p>
                    <p><span className="text-[#9CA3AF]">{isAr ? "الإجراء" : "Action"}:</span> <bdi dir="auto">{currencyText(turn?.detail)}</bdi></p>
                  </div>
                </details>
                <div ref={chatScrollRef} onScroll={handleChatScroll} className="max-h-[420px] space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/30 p-3">
                  {room.messages.length ? (
                    room.messages.map((message) => {
                      const ownMessage = message.senderUserId === actor.id;
                      const messageBody = message.credentialKind === "cardless_code"
                        ? localizeCardlessWithdrawalMessage(message.message, locale)
                        : message.message || (isAr ? "صورة مرفقة" : "Image attachment");
                      const localizedSystemMessage = message.kind === "system"
                        ? localizeTradeRoomSystemMessage(messageBody, locale)
                        : null;
                      return (
                        <div
                          key={message.id}
                          className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                            message.kind === "system"
                              ? "mx-auto border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 text-[#D1D5DB]"
                              : ownMessage
                                ? "ml-auto border border-[#C9A227]/40 bg-[#C9A227]/15 text-white"
                                : "border border-white/10 bg-black/40 text-[#E5E7EB]"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/30 text-xs font-semibold">
                              {message.kind === "system"
                                ? <BellRing className="h-4 w-4 text-[#93C5FD]" aria-hidden="true" />
                                : <span aria-hidden="true">AT</span>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <TradeChatMessageLabel message={message} context={room} actorId={actor.id} locale={locale} />
                              <p
                                data-trade-message-id={message.id}
                                lang={localizedSystemMessage ? locale : undefined}
                                dir={localizedSystemMessage?.dir ?? "auto"}
                                className="whitespace-pre-wrap break-words"
                              >
                                {localizedSystemMessage
                                  ? localizedSystemMessage.segments.map((segment, index) => (
                                      segment.isolate
                                        ? <bdi key={`${message.id}-segment-${index}`} dir="auto">{currencyText(segment.value)}</bdi>
                                        : <span key={`${message.id}-segment-${index}`}>{currencyText(segment.value)}</span>
                                    ))
                                  : <bdi dir="auto">{currencyText(messageBody)}</bdi>}
                              </p>
                              {message.imageUrl ? (
                                <a href={message.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block overflow-hidden rounded-xl border border-white/10">
                                  <Image src={message.imageUrl} alt={message.imageName ?? "chat attachment"} width={640} height={480} className="h-auto w-full object-cover" />
                                </a>
                              ) : null}
                              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[#9CA3AF]">
                                <span>{new Date(message.createdAt).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" })}</span>
                                <TradeChatMessageStatus message={message} parties={request} locale={locale} />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-[#9CA3AF]">{isAr ? "لا توجد رسائل بعد." : "No messages yet."}</p>
                  )}
                </div>
                {hasUnreadChatMessages ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    onClick={handleRevealNewChatMessages}
                  >
                    {isAr ? "رسائل جديدة — عرض" : "New messages — show"}
                  </Button>
                ) : null}
                {isCardlessAtmTrade && !isSeller && request.status === "accepted" ? (
                  <div className="rounded-xl border border-[#C9A227]/35 bg-[#C9A227]/10 p-3 text-sm text-[#FDE68A]">
                    {isAr ? "عبّئ رمز السحب ورقم الهوية أو تاريخ الميلاد في قسم بيانات السحب أعلاه، ثم اضغط إرسال البيانات وتأكيدها." : "Enter the withdrawal code and ID number or date of birth in the withdrawal section above, then send and confirm both details."}
                  </div>
                ) : (
                <form className="sticky bottom-2 z-10 space-y-2 rounded-2xl border border-white/10 bg-[#101010]/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-xl backdrop-blur-md" onSubmit={handleSendMessage}>
                  <Textarea
                    value={chatDraft}
                    onChange={(event) => { setChatNotice(null); handleChatDraftChange(event); }}
                    placeholder={isAr ? "اكتب رسالة..." : "Type a message..."}
                    maxLength={1200}
                    className="min-h-[56px] resize-none sm:min-h-[96px]"
                    aria-invalid={Boolean(chatErrorMessage)}
                    aria-describedby={chatErrorMessage ? "trade-chat-error trade-chat-safety" : "trade-chat-safety"}
                  />
                  <p id="trade-chat-safety" className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-100">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {isAr
                        ? "لحمايتك، أبقِ المحادثة هنا. لا يمكن إرسال أرقام الهاتف أو البريد الإلكتروني أو WhatsApp أو بيانات التواصل الخارجية."
                        : "For your security, keep the conversation here. Phone numbers, email, WhatsApp, and other external contact details cannot be sent."}
                    </span>
                  </p>
                  {chatErrorMessage ? (
                    <ActionFeedback revealKey={chatErrorMessageFeedbackKey} role="alert" id="trade-chat-error"   data-testid="trade-chat-error" className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm leading-5 text-red-100">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{currencyText(chatErrorMessage)}</span>
                    </ActionFeedback>
                  ) : null}
                  {!isCashTrade ? (
                    <>
                      <Input
                        ref={chatImageInputRef}
                        type="file"
                        tabIndex={-1}
                        accept="image/png,image/jpeg,image/webp"
                        capture="environment"
                        className="sr-only"
                        aria-label={isAr ? "اختيار صورة للمحادثة" : "Choose chat image"}
                        onChange={(event) => setChatImage(event.target.files?.[0] ?? null)}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => chatImageInputRef.current?.click()}>
                          <Paperclip className="h-4 w-4" aria-hidden="true" />
                          {chatImage ? (isAr ? "تغيير الصورة" : "Change Image") : (isAr ? "إرفاق صورة" : "Attach Image")}
                        </Button>
                        {chatImage ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => {
                            setChatImage(null);
                            if (chatImageInputRef.current) chatImageInputRef.current.value = "";
                          }}>
                            {isAr ? "إزالة" : "Remove"}
                          </Button>
                        ) : null}
                      </div>
                      {chatImage ? <p className="break-all text-xs text-[#D1D5DB]"><bdi dir="ltr">{currencyText(chatImage.name)}</bdi></p> : null}
                    </>
                  ) : (
                    <p className="text-xs text-[#FDE68A]">{isAr ? "لا صور أو إثباتات دفع في صفقات النقد؛ استخدم خطوات التأكيد المحمية أعلاه." : "No photos or payment evidence are accepted for cash trades; use the protected confirmation steps above."}</p>
                  )}
                  {chatNotice ? <p role="status" className="text-xs text-emerald-300">{currencyText(chatNotice)}</p> : null}
                  <div className="flex items-center gap-2">
                    <Button type="submit" className="flex-1" disabled={chatBusy || (!chatDraft.trim() && !chatImage)}>
                      {chatBusy ? (
                        <span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{isAr ? "جاري الإرسال..." : "Sending..."}</span>
                      ) : (isAr ? "إرسال الرسالة" : "Send Message")}
                    </Button>
                    <Button type="button" variant="secondary" disabled={!chatDraft} onClick={() => void handleCopyChatDraft()}>
                      {isAr ? "نسخ" : "Copy"}
                    </Button>
                  </div>
                </form>
                )}
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-[#C9A227]" />{isAr ? "سلامة الصفقة" : "Trade Safety"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
                {isFaceToFaceTrade ? (
                  <>
                    <p>{isAr ? "التقِ في مكان عام وآمن. يؤكد المشتري تسليم النقد، ثم يؤكد البائع استلامه قبل ظهور المحفظة." : "Meet in a safe public place. The buyer confirms handing over cash, then the seller confirms receipt before the wallet is revealed."}</p>
                    <p>{currencyText(isAr ? "البائع وحده يكمل الصفقة بعد إرسال كامل USDT إلى عنوان المشتري الصحيح." : "Only the seller completes the trade, after sending the full USDT amount to the correct buyer wallet.")}</p>
                  </>
                ) : isCardlessAtmTrade ? (
                  <>
                    <p>{isAr ? "أرسل رمز السحب باستخدام الإجراء المحمي فقط. يؤكد البائع بعد استلام النقد فعليًا، وعندها فقط يظهر عنوان المحفظة." : "Send the withdrawal code only with the protected action. The seller confirms only after collecting the cash; only then is the wallet revealed."}</p>
                    <p>{isAr ? "لا يلزم رفع صورة. بعد تأكيد المشتري إرسال الرمز لا يمكن الإلغاء العادي؛ افتح نزاعًا إذا ظهرت مشكلة." : "No photo is required. After the buyer confirms sending the code, normal cancellation is locked; open a dispute if anything goes wrong."}</p>
                  </>
                ) : (
                  <>
                    <p>{currencyText(isAr ? "لن يتم تحرير USDT إلا بعد تأكيد الدفع داخل Alpha Exchange." : "USDT is released only after seller confirms payment inside Alpha Exchange.")}</p>
                    <p>{isAr ? "لا ترسل أي دفعة خارج مسار الصفقة المعتمد." : "Never send payment outside the Alpha Exchange process."}</p>
                  </>
                )}
              </CardContent>
            </Card>

            {room.sellerCommissionDueCount > 0 && isSeller ? (
              <Card className="border-amber-500/30 bg-amber-500/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><AttentionSiren />{isAr ? "عمولة مستحقة" : "Commission Due"}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-[#FDE68A]">
                  <p>{currencyText(isAr ? `عدد العمولات غير المدفوعة: ${room.sellerCommissionDueCount}` : `Pending commissions: ${room.sellerCommissionDueCount}`)}</p>
                  <p className="mt-1">{currencyText(isAr ? `المبلغ الإجمالي: ${formatUsdtAmount(room.sellerCommissionDueAmount)}` : `Total due: ${formatUsdtAmount(room.sellerCommissionDueAmount)}`)}</p>
                  <p className="mt-1">{currencyText(isAr ? `الدفع الحالي: ${formatUsdtAmount(room.sellerPayableCommissionAmount)}` : `Current payment: ${formatUsdtAmount(room.sellerPayableCommissionAmount)}`)}</p>
                  <p className="mt-1 text-xs text-amber-100">{isAr ? "لن تتمكن من نشر عروض جديدة حتى السداد." : "New listing creation stays blocked until payment is cleared."}</p>
                  <Button type="button" size="sm" className="mt-2" disabled={!room.sellerPayableCommissionId} onClick={() => openCommissionPayNow(room.sellerPayableCommissionId)}>
                    <span aria-hidden="true">💳</span>{isAr ? "ادفع الآن" : "Pay Now"}
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => router.push("/usdt-exchange")}>
                {isAr ? "العودة إلى السوق" : "Back to Exchange"}
              </Button>
              <Link href="/dashboard" locale={locale} className="inline-flex h-11 items-center justify-center rounded-full border border-white/20 px-6 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:border-[#C9A227] hover:text-[#C9A227]">
                {isAr ? "لوحة التحكم" : "Dashboard"}
              </Link>
            </div>
          </div>
        </div> : null}

        {errorMessage ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[#FCA5A5]">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              <span>{currencyText(errorMessage)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
