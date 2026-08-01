"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, MessageCircle, ShieldCheck, WalletCards } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MarketplaceListing, PurchaseRequest, TradeChatMessage, TradeEvidenceFile, TradeTimelineEntry, UserRole } from "@/types/alpha-exchange";
import { readTradeRoomCache, writeTradeRoomCache } from "@/lib/trade-room-client";
import { isSellerEvidenceRequiredForPaymentMethod, normalizeMarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";

type Locale = "ar" | "en";

type TradeRoomData = {
  request: PurchaseRequest;
  listing: MarketplaceListing | null;
  counterpart: { buyerName: string; sellerName: string };
  messages: TradeChatMessage[];
  deadlineAt: string | null;
  timeRemainingSeconds: number | null;
  releaseDeadlineActive: boolean;
  releaseDeadlineOverdue: boolean;
  isOverdue: boolean;
  hasOpenDispute: boolean;
  canOpenDispute: boolean;
  sellerCommissionDueAmount: number;
  sellerCommissionDueCount: number;
  _timing?: {
    trigger?: string;
    publishedAtEpochMs?: number | null;
    snapshotMs?: number;
    sentAtEpochMs?: number;
    publishToSentMs?: number | null;
  };
};

type ActorSession = {
  id: string;
  role: UserRole;
  fullName: string;
};

type StepId = "request" | "accepted" | "payment" | "released" | "completed";

type PrimaryStatus = "accepted" | "payment_sent" | "funds_received" | "usdt_release_pending" | "usdt_sent" | "completed";

type StatusPrimaryAction = {
  label: string;
  successLabel: string;
  mode: "status";
  nextStatus: PrimaryStatus;
  requiresEvidenceSide?: "buyer" | "seller";
};

type UploadPrimaryAction = {
  label: string;
  successLabel: string;
  mode: "upload";
  uploadSide: "buyer" | "seller";
};

type PrimaryAction = StatusPrimaryAction | UploadPrimaryAction;

const ALLOWED_EVIDENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_EVIDENCE_SIZE_BYTES = 8 * 1024 * 1024;
const TRADE_ROOM_DEBUG = process.env.NEXT_PUBLIC_ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1";
// Performance timing logs are always-on during RC5 QA so timings are visible in
// the browser console without needing a special env var set on production.
const PERF_LOG = true;

const STEP_ORDER: Array<{ id: StepId; icon: string; label: { en: string; ar: string } }> = [
  { id: "request", icon: "📝", label: { en: "Request", ar: "الطلب" } },
  { id: "accepted", icon: "🤝", label: { en: "Accepted", ar: "مقبول" } },
  { id: "payment", icon: "💳", label: { en: "Payment", ar: "الدفع" } },
  { id: "released", icon: "₮", label: { en: "USDT Released", ar: "إرسال USDT" } },
  { id: "completed", icon: "⭐", label: { en: "Completed", ar: "مكتملة" } },
];

function toNumber(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  return Number(normalized.replace(/[^\d.]/g, "")) || 0;
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function readApiErrorFallback(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const candidate = payload as { error?: unknown; message?: unknown };
    if (typeof candidate.error === "string" && candidate.error.trim()) return candidate.error;
    if (typeof candidate.message === "string" && candidate.message.trim()) return candidate.message;
  }
  return fallback;
}

function tradeStatusLabel(status: PurchaseRequest["status"], isAr: boolean, isOverdue = false) {
  if (status === "pending") return isAr ? "في انتظار القبول" : "Waiting for acceptance";
  if (status === "accepted") return isAr ? "في انتظار دفع المشتري" : "Waiting for buyer payment";
  if (status === "payment_sent") return isAr ? "في انتظار تأكيد البائع" : "Waiting for seller confirmation";
  if (status === "funds_received") return isAr ? "البائع أكّد استلام الأموال" : "Seller confirmed funds received";
  if (status === "usdt_release_pending" && isOverdue) return isAr ? "متأخرة — مهلة إصدار USDT انتهت" : "Overdue — USDT release deadline exceeded";
  if (status === "usdt_release_pending") return isAr ? "جاري إرسال USDT" : "USDT release in progress";
  if (status === "usdt_sent") return isAr ? "في انتظار تأكيد المشتري" : "Waiting for buyer receipt confirmation";
  if (status === "review_open" || status === "completed" || status === "locked") return isAr ? "الصفقة مكتملة" : "Trade completed";
  if (status === "declined") return isAr ? "تم رفض الطلب" : "Request declined";
  if (status === "cancelled") return isAr ? "تم إلغاء الطلب" : "Request cancelled";
  return status;
}

function getStepId(status: PurchaseRequest["status"]): StepId {
  if (status === "accepted") return "accepted";
  if (status === "payment_sent" || status === "funds_received") return "payment";
  if (status === "usdt_release_pending" || status === "usdt_sent") return "released";
  if (status === "review_open" || status === "completed" || status === "locked") return "completed";
  return "request";
}

function getStepIndex(status: PurchaseRequest["status"]) {
  const id = getStepId(status);
  return STEP_ORDER.findIndex((item) => item.id === id);
}

function getPrimaryAction(request: PurchaseRequest, isSeller: boolean, isAr: boolean, sellerEvidenceRequired: boolean): PrimaryAction | null {
  if (request.status === "pending" && isSeller) {
    return {
      label: isAr ? "قبول الطلب" : "Accept Trade",
      successLabel: isAr ? "تم قبول الطلب" : "Trade Accepted",
      mode: "status",
      nextStatus: "accepted",
    };
  }
  if (request.status === "accepted" && !isSeller) {
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
    if (sellerEvidenceRequired && !request.sellerEvidence) {
      return {
        label: isAr ? "رفع إثبات البائع" : "Upload Seller Evidence",
        successLabel: isAr ? "تم رفع الإثبات" : "Evidence Uploaded",
        mode: "upload",
        uploadSide: "seller",
      };
    }
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
  if (request.status === "usdt_sent" && !isSeller) {
    return {
      label: isAr ? "تأكيد استلام USDT" : "Confirm USDT Received",
      successLabel: isAr ? "تم تأكيد استلام USDT" : "USDT Receipt Confirmed",
      mode: "status",
      nextStatus: "completed",
    };
  }
  return null;
}

function getStatusBannerContent(request: PurchaseRequest, isSeller: boolean, isAr: boolean, primaryAction: PrimaryAction | null, isOverdue: boolean) {
  const currentStatus = tradeStatusLabel(request.status, isAr, isOverdue);
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
          detail: isAr ? "عند نجاح الرفع سيتم إرسال الدفع وإبلاغ البائع فورًا." : "A successful receipt upload immediately submits payment and notifies the seller.",
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
          detail: isAr ? "المشتري رفع الإثبات. أكّد الاستلام لبدء مرحلة إصدار USDT." : "The buyer already uploaded payment evidence. Confirm receipt to unlock USDT release.",
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
          detail: isAr ? "ابدأ مرحلة إصدار USDT لبدء مهلة الـ45 دقيقة." : "Start USDT release to begin the 45-minute SLA window.",
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
          detail: isAr ? "أرسل الإثبات وأكمل المرحلة قبل انتهاء المهلة." : "Upload proof and complete the release before the deadline expires.",
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
  if (request.status === "usdt_sent") {
    return isSeller
      ? {
          icon: "✅",
          title: isAr ? "الحالة الحالية" : "Current Status",
          headline: isAr ? "بانتظار المشتري لتأكيد الاستلام" : "Waiting for Buyer to Confirm Receipt",
          detail: isAr ? "تم إرسال USDT. سينتقل التداول إلى الاكتمال بعد تأكيد المشتري." : "USDT has been sent. The trade completes after the buyer confirms receipt.",
          yourAction: isAr ? "لا يوجد إجراء الآن" : "No action now",
          counterpartyAction: isAr ? "المشتري يجب أن يؤكد استلام USDT" : "Buyer needs to confirm USDT receipt",
          tradeStatus: currentStatus,
        }
      : {
          icon: "⏰",
          title: isAr ? "الحالة الحالية" : "Action Required",
          headline: request.buyerConfirmationArchivedAt
            ? (isAr ? "تأكيد الاستلام متأخر — أكد استلام USDT الآن" : "Confirmation Overdue — Confirm USDT Receipt Now")
            : (isAr ? "أكد استلام USDT" : "Confirm USDT Received"),
          detail: request.buyerConfirmationArchivedAt
            ? (isAr ? "لم يتم تأكيد استلام USDT خلال 5 دقائق. يرجى التأكيد الآن لإكمال الصفقة والسماح بالمشتريات الجديدة." : "USDT receipt was not confirmed within 5 minutes. Please confirm now to complete the trade and unblock future purchases.")
            : (isAr ? "بعد التأكيد ستنتقل الصفقة إلى سجل الصفقات الناجحة." : "After confirmation, the trade moves into your completed history."),
          yourAction: primaryAction?.label ?? (isAr ? "تأكيد استلام USDT" : "Confirm USDT Received"),
          counterpartyAction: isAr ? "البائع أرسل USDT" : "Seller has already sent the USDT",
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
  if (request.status === "review_open" || request.status === "completed" || request.status === "locked") {
    return {
      isYourTurn: false,
      title: isAr ? "اكتملت الصفقة" : "TRADE COMPLETE",
      detail: isAr ? "تمت العملية بنجاح ويمكنك مراجعة السجل." : "The trade finished successfully and is now in history/review state.",
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
  if (event.type === "request_submitted") return "request";
  if (event.type === "request_accepted") return "accepted";
  if (event.type === "payment_sent" || event.type === "seller_confirmed_funds" || event.type === "buyer_evidence_uploaded") return "payment";
  if (event.type === "usdt_release_started" || event.type === "usdt_sent" || event.type === "seller_evidence_uploaded") return "released";
  return "completed";
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
    nextRequest.reviewUnlockedAt = nowIso;
    nextRequest.lockedAt = nowIso;
  }
}

function createOptimisticEvidence(request: PurchaseRequest, side: "buyer" | "seller", actorUserId: string, file: File, uploadedAt: string): TradeEvidenceFile {
  return {
    id: `optimistic-${side}-${request.id}`,
    purchaseRequestId: request.id,
    side,
    uploadedByUserId: actorUserId,
    uploadedAt,
    fileName: file.name,
    mimeType: file.type as TradeEvidenceFile["mimeType"],
    sizeBytes: file.size,
    storagePath: "",
    status: "uploaded",
  };
}

function buildOptimisticRoom(room: TradeRoomData, nextStatus: PrimaryStatus) {
  const now = new Date();
  const nextRequest: PurchaseRequest = {
    ...room.request,
  };
  applyOptimisticStatusFields(nextRequest, nextStatus, now);
  return applyRequestToRoom(room, nextRequest);
}

function buildOptimisticEvidenceRoom(
  room: TradeRoomData,
  input: { side: "buyer" | "seller"; actorUserId: string; file: File; autoAdvanceStatus?: PrimaryStatus },
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const optimisticEvidence = createOptimisticEvidence(room.request, input.side, input.actorUserId, input.file, nowIso);
  const nextRequest: PurchaseRequest = {
    ...room.request,
    updatedAt: nowIso,
    buyerEvidence: input.side === "buyer" ? optimisticEvidence : room.request.buyerEvidence,
    sellerEvidence: input.side === "seller" ? optimisticEvidence : room.request.sellerEvidence,
  };
  if (input.autoAdvanceStatus) {
    applyOptimisticStatusFields(nextRequest, input.autoAdvanceStatus, now);
  }
  return applyRequestToRoom(room, nextRequest);
}

export function TradeRoomPage({
  locale,
  requestId,
  actor,
}: {
  locale: Locale;
  requestId: string;
  actor: ActorSession;
}) {
  const isAr = locale === "ar";
  const router = useRouter();
  const [room, setRoom] = useState<TradeRoomData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completedActionLabel, setCompletedActionLabel] = useState<string | null>(null);
  const [stepPulse, setStepPulse] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [showDisputeComposer, setShowDisputeComposer] = useState(false);
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamCycle, setStreamCycle] = useState(0);
  const [selectedStep, setSelectedStep] = useState<StepId>("request");
  const [buyerEvidenceFile, setBuyerEvidenceFile] = useState<File | null>(null);
  const [sellerEvidenceFile, setSellerEvidenceFile] = useState<File | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState<"buyer" | "seller" | null>(null);
  const [clockTick, setClockTick] = useState(Date.now());
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewDeferred, setReviewDeferred] = useState(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const actionNoticeTimeoutRef = useRef<number | null>(null);
  const actionInFlightRef = useRef<string | null>(null);
  const completedActionTimeoutRef = useRef<number | null>(null);
  const buyerEvidenceInputRef = useRef<HTMLInputElement | null>(null);
  const sellerEvidenceInputRef = useRef<HTMLInputElement | null>(null);
  const statusBannerRef = useRef<HTMLDivElement | null>(null);
  const evidenceSectionRef = useRef<HTMLDivElement | null>(null);
  const previousStatusRef = useRef<PurchaseRequest["status"] | null>(null);
  // Performance timing refs — record timestamps so useLayoutEffect can log render latency.
  const perfClickTsRef = useRef<number | null>(null);
  const perfFetchStartTsRef = useRef<number | null>(null);
  const perfSseReceivedTsRef = useRef<number | null>(null);
  const perfSsePublishedAtRef = useRef<number | null>(null);

  const fetchRoom = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setErrorMessage(null);
    }
    try {
      const startedAt = performance.now();
      const response = await fetch(`/api/alpha-exchange/trade-room/${requestId}`, { cache: "no-store" });
      const payload = (await response.json()) as TradeRoomData & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر تحميل غرفة الصفقة." : "Failed to load trade room."));
      }
      const apiLatencyMs = Math.round(performance.now() - startedAt);
      const routeMs = Number(response.headers.get("X-Trade-Route-Ms") ?? "0");
      const dbMs = Number(response.headers.get("X-Trade-Db-Ms") ?? routeMs);
      if (TRADE_ROOM_DEBUG) {
        console.log("[trade-room-load] fetch", { requestId, apiLatencyMs, routeMs, dbMs, stateAfter: payload.request.status });
      }
      writeTradeRoomCache(requestId, payload);
      setRoom(payload);
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : (isAr ? "تعذر تحميل غرفة الصفقة." : "Failed to load trade room.");
      setErrorMessage(message);
      return null;
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [isAr, requestId]);

  useEffect(() => {
    const cached = readTradeRoomCache<TradeRoomData>(requestId);
    if (cached) {
      setRoom(cached);
      setIsLoading(false);
      return;
    }
    void fetchRoom();
  }, [fetchRoom, requestId]);

  useEffect(() => {
    const currentRequest = room?.request;
    if (!currentRequest) return;
    const nextStep = getStepId(currentRequest.status);
    const previousStatus = previousStatusRef.current;
    setSelectedStep(nextStep);
    if (previousStatus && previousStatus !== currentRequest.status) {
      setStepPulse(true);
      statusBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      const timeoutId = window.setTimeout(() => setStepPulse(false), 1800);
      previousStatusRef.current = currentRequest.status;
      return () => window.clearTimeout(timeoutId);
    }
    previousStatusRef.current = currentRequest.status;
    setStepPulse(false);
  }, [room?.request]);

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
    if (completedActionTimeoutRef.current) {
      window.clearTimeout(completedActionTimeoutRef.current);
    }
    if (actionNoticeTimeoutRef.current) {
      window.clearTimeout(actionNoticeTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const stream = new EventSource(`/api/alpha-exchange/trade-room/${requestId}/stream`);
    let closed = false;
    setStreamConnected(false);

    const onTradeRoom = (event: Event) => {
      const messageEvent = event as MessageEvent<string>;
      try {
        const payload = JSON.parse(messageEvent.data) as TradeRoomData;
        // Don't overwrite optimistic state while a mutation is in-flight.
        // The confirmed state arrives from the HTTP response; the SSE snapshot
        // here may be stale (e.g. a keepalive fired before the DB write).
        if (actionInFlightRef.current) return;
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
        writeTradeRoomCache(requestId, payload);
        setRoom(payload);
        setStreamConnected(true);
        setErrorMessage(null);
      } catch {
        // Ignore malformed events and wait for the next snapshot.
      }
    };

    const onOpen = () => setStreamConnected(true);
    const onError = () => {
      if (closed) return;
      setStreamConnected(false);
      stream.close();
      reconnectTimeoutRef.current = window.setTimeout(() => {
        setStreamCycle((value) => value + 1);
      }, 2000);
    };

    stream.addEventListener("trade-room", onTradeRoom);
    stream.addEventListener("open", onOpen as EventListener);
    stream.addEventListener("error", onError as EventListener);

    const handleBeforeUnload = () => stream.close();
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      closed = true;
      stream.close();
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [requestId, streamCycle]);

  useEffect(() => {
    if (streamConnected) return;
    const id = window.setInterval(() => {
      void fetchRoom(true);
    }, 8000);
    return () => window.clearInterval(id);
  }, [fetchRoom, streamConnected]);

  const isSeller = room ? room.request.sellerId === actor.id : actor.role === "approved_seller";
  const request = room?.request ?? null;
  const requestPaymentMethod = request ? (normalizeMarketplacePaymentMethod(request.paymentMethod) ?? request.paymentMethod) : "";
  const sellerEvidenceRequired = request ? isSellerEvidenceRequiredForPaymentMethod(requestPaymentMethod) : false;
  const counterpartName = request
    ? (isSeller ? room?.counterpart.buyerName : room?.counterpart.sellerName)
    : "";
  const currentStepIndex = request ? getStepIndex(request.status) : 0;
  const progressPercent = Math.round((currentStepIndex / (STEP_ORDER.length - 1)) * 100);
  const turn = request ? getTurnPanel(request, isSeller, isAr) : null;
  const primaryAction = request ? getPrimaryAction(request, isSeller, isAr, sellerEvidenceRequired) : null;
  const isOverdueTrade = Boolean(room?.isOverdue);
  const statusBanner = request ? getStatusBannerContent(request, isSeller, isAr, primaryAction, isOverdueTrade) : null;
  const showSuccessScreen = request?.status === "review_open" || request?.status === "completed" || request?.status === "locked";
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
  const sellerEvidenceUploadOpen = Boolean(
    isSeller
    && request
    && (request.status === "funds_received" || request.status === "usdt_release_pending"),
  );
  const activeTimeline = useMemo(() => {
    if (!request) return [] as TradeTimelineEntry[];
    return [...(request.timeline ?? [])].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }, [request]);

  const selectedStepEvent = useMemo(() => {
    if (!request) return null;
    const timeline = [...(request.timeline ?? [])].reverse();
    return timeline.find((entry) => timelineStepForEvent(entry) === selectedStep) ?? null;
  }, [request, selectedStep]);

  const timeRemainingSeconds = useMemo(() => {
    if (!room?.deadlineAt) return null;
    return Math.max(0, Math.floor((new Date(room.deadlineAt).getTime() - clockTick) / 1000));
  }, [clockTick, room?.deadlineAt]);

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

  const handleStatusUpdate = useCallback(async (action: StatusPrimaryAction) => {
    const nextStatus = action.nextStatus;
    if (!request || !room) return;
    const mutationKey = `${request.id}:${request.status}:${nextStatus}`;
    if (actionInFlightRef.current === mutationKey) return;
    actionInFlightRef.current = mutationKey;
    const previousRoom = room;
    const optimisticRoom = buildOptimisticRoom(room, nextStatus);
    const payload = nextStatus === "accepted"
      ? { status: nextStatus, safetyAcknowledged: true }
      : { status: nextStatus };
    // T0: click timestamp
    const clickTs = performance.now();
    perfClickTsRef.current = clickTs;
    const startedAt = clickTs;
    const optimisticStartedAt = performance.now();
    setRoom(optimisticRoom);
    writeTradeRoomCache(requestId, optimisticRoom);
    const optimisticUiMs = Math.round(performance.now() - optimisticStartedAt);
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
        optimisticUiMs,
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
      });
      const responsePayload = (await response.json()) as { error?: string; message?: string; request?: PurchaseRequest; metrics?: { totalMs?: number } };
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
        throw new Error(readApiErrorFallback(responsePayload, isAr ? "تعذر تحديث حالة الصفقة." : "Failed to update trade status."));
      }
      if (responsePayload.request) {
        const nextRoom = applyRequestToRoom(optimisticRoom, responsePayload.request);
        setRoom(nextRoom);
        writeTradeRoomCache(requestId, nextRoom);
      }
      if (completedActionTimeoutRef.current) {
        window.clearTimeout(completedActionTimeoutRef.current);
      }
      setCompletedActionLabel(action.successLabel);
      completedActionTimeoutRef.current = window.setTimeout(() => {
        setCompletedActionLabel(null);
        completedActionTimeoutRef.current = null;
      }, 2000);
      setActionNotice(null);
      setStatusMessage(isAr ? "تم تحديث حالة الصفقة." : "Trade status updated.");
    } catch (error) {
      const refreshedRoom = await fetchRoom(true);
      const expectedStatus = nextStatus === "completed" ? "review_open" : nextStatus;
      if (refreshedRoom?.request.status === expectedStatus) {
        setActionNotice(null);
        setActionError(null);
        if (completedActionTimeoutRef.current) {
          window.clearTimeout(completedActionTimeoutRef.current);
        }
        setCompletedActionLabel(action.successLabel);
        completedActionTimeoutRef.current = window.setTimeout(() => {
          setCompletedActionLabel(null);
          completedActionTimeoutRef.current = null;
        }, 2000);
        setStatusMessage(isAr ? "تم تحديث حالة الصفقة بعد تأكيد الخادم." : "Trade status updated after server confirmation.");
      } else {
        setRoom(previousRoom);
        writeTradeRoomCache(requestId, previousRoom);
        const message = error instanceof Error
          ? error.message
          : (isAr ? "تعذر تحديث حالة الصفقة." : "Failed to update trade status.");
        setActionError(message);
        setActionNotice(null);
      }
    } finally {
      if (actionNoticeTimeoutRef.current) {
        window.clearTimeout(actionNoticeTimeoutRef.current);
        actionNoticeTimeoutRef.current = null;
      }
      actionInFlightRef.current = null;
      setActionBusy(false);
    }
  }, [fetchRoom, isAr, request, requestId, room, streamConnected]);

  const handleSendMessage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!request) return;
    const message = chatDraft.trim();
    if (!message) return;
    // Optimistically append the message so it appears instantly for the sender.
    const optimisticMsg: import("@/types/alpha-exchange").TradeChatMessage = {
      id: `optimistic-msg-${Date.now()}`,
      purchaseRequestId: request.id,
      kind: "user",
      senderUserId: actor.id,
      senderRole: actor.role,
      message,
      createdAt: new Date().toISOString(),
      readByUserIds: [actor.id],
    };
    setRoom((prev) => prev ? { ...prev, messages: [optimisticMsg, ...prev.messages] } : prev);
    setChatDraft("");
    setChatBusy(true);
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        // Revert the optimistic message on failure.
        setRoom((prev) => prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticMsg.id) } : prev);
        setChatDraft(message);
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر إرسال الرسالة." : "Failed to send message."));
      }
      // The SSE stream will deliver the authoritative snapshot with the confirmed message.
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : (isAr ? "تعذر إرسال الرسالة." : "Failed to send message."));
    } finally {
      setChatBusy(false);
    }
  }, [actor.id, actor.role, chatDraft, isAr, request]);

  const handleUploadEvidence = useCallback(async (side: "buyer" | "seller") => {
    if (!request || !room) return;
    const file = side === "buyer" ? buyerEvidenceFile : sellerEvidenceFile;
    if (!file) return;
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
      setStatusMessage(isAr ? "صيغة الملف غير مدعومة." : "Unsupported evidence file type.");
      return;
    }
    if (file.size > MAX_EVIDENCE_SIZE_BYTES) {
      setStatusMessage(isAr ? "حجم الملف كبير جدًا (الحد 8MB)." : "Evidence file is too large (max 8MB).");
      return;
    }

    setEvidenceBusy(side);
    setActionNotice(null);
    setActionError(null);
    setStatusMessage(null);
    const autoAdvanceStatus = side === "seller" && request.status === "usdt_release_pending"
        ? "usdt_sent"
        : undefined;
    const previousRoom = room;
    const optimisticRoom = buildOptimisticEvidenceRoom(room, {
      side,
      actorUserId: actor.id,
      file,
      autoAdvanceStatus,
    });
    setRoom(optimisticRoom);
    writeTradeRoomCache(requestId, optimisticRoom);
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
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر رفع الإثبات." : "Failed to upload evidence."));
      }
      let nextRoom = payload.request ? applyRequestToRoom(previousRoom, payload.request) : optimisticRoom;
      const shouldAutoSubmitSellerRelease = autoAdvanceStatus === "usdt_sent";
      if (shouldAutoSubmitSellerRelease) {
        const statusResponse = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "usdt_sent" }),
        });
        const statusPayload = (await statusResponse.json()) as { error?: string; message?: string; request?: PurchaseRequest };
        if (!statusResponse.ok) {
          throw new Error(readApiErrorFallback(
            statusPayload,
            isAr
              ? "تم رفع إثبات البائع، لكن تعذر إكمال إصدار USDT. استخدم زر تأكيد الإرسال لإكمال الخطوة."
              : "Seller proof uploaded, but finalizing the USDT release failed. Use Mark USDT Sent to complete the step.",
          ));
        }
        if (statusPayload.request) {
          nextRoom = applyRequestToRoom(nextRoom, statusPayload.request);
        }
      }
      setRoom(nextRoom);
      writeTradeRoomCache(requestId, nextRoom);
      if (side === "buyer") setBuyerEvidenceFile(null);
      else setSellerEvidenceFile(null);
      if (completedActionTimeoutRef.current) {
        window.clearTimeout(completedActionTimeoutRef.current);
      }
      setCompletedActionLabel(
        side === "buyer" && (request.status === "accepted" || nextRoom.request.status === "payment_sent")
          ? (isAr ? "تم إرسال الدفع" : "Payment Submitted")
          : side === "seller" && request.status === "usdt_release_pending"
            ? (isAr ? "تم إصدار USDT" : "USDT Released")
            : (isAr ? "تم رفع الإثبات" : "Evidence Uploaded"),
      );
      completedActionTimeoutRef.current = window.setTimeout(() => {
        setCompletedActionLabel(null);
        completedActionTimeoutRef.current = null;
      }, 2000);
      setStatusMessage(
        side === "buyer" && (request.status === "accepted" || nextRoom.request.status === "payment_sent")
          ? (isAr ? "تم رفع إيصال الدفع وإبلاغ البائع." : "Payment receipt uploaded and seller notified.")
          : side === "seller" && request.status === "usdt_release_pending"
            ? (isAr ? "تم إصدار USDT وإبلاغ المشتري." : "USDT released and buyer notified.")
          : (isAr ? "تم رفع الإثبات بنجاح." : "Evidence uploaded."),
      );
    } catch (error) {
      setRoom(previousRoom);
      writeTradeRoomCache(requestId, previousRoom);
      setStatusMessage(error instanceof Error ? error.message : (isAr ? "تعذر رفع الإثبات." : "Failed to upload evidence."));
    } finally {
      setEvidenceBusy(null);
    }
  }, [actor.id, buyerEvidenceFile, isAr, request, requestId, room, sellerEvidenceFile]);

  const handlePrimaryAction = useCallback(async () => {
    if (!primaryAction) return;
    setActionError(null);
    if (primaryAction.mode === "upload") {
      const side = primaryAction.uploadSide;
      if (!side) return;
      const file = side === "buyer" ? buyerEvidenceFile : sellerEvidenceFile;
      if (!file) {
        evidenceSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        const input = side === "buyer" ? buyerEvidenceInputRef.current : sellerEvidenceInputRef.current;
        input?.click();
        return;
      }
      await handleUploadEvidence(side);
      return;
    }
    await handleStatusUpdate(primaryAction);
  }, [buyerEvidenceFile, handleStatusUpdate, handleUploadEvidence, primaryAction, sellerEvidenceFile]);

  const handleOpenDispute = useCallback(async () => {
    if (!request) return;
    setDisputeBusy(true);
    try {
      const response = await fetch("/api/alpha-exchange/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseRequestId: request.id,
          reason: disputeReason.trim(),
        }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر فتح النزاع." : "Failed to open dispute."));
      }
      setDisputeReason("");
      setShowDisputeComposer(false);
      setStatusMessage(isAr ? "تم فتح النزاع وإبلاغ الإدارة." : "Dispute opened and admins were notified.");
      await fetchRoom(true);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : (isAr ? "تعذر فتح النزاع." : "Failed to open dispute."));
    } finally {
      setDisputeBusy(false);
    }
  }, [disputeReason, fetchRoom, isAr, request]);

  const handleSubmitBuyerReview = useCallback(async () => {
    if (!request) return;
    if (!reviewComment.trim()) {
      setStatusMessage(isAr ? "يرجى كتابة تعليق قبل إرسال التقييم." : "Please add feedback before submitting rating.");
      return;
    }

    setReviewBusy(true);
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "buyer_review",
          rating: reviewRating,
          comment: reviewComment.trim(),
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
        sellerProgress?: {
          promoted?: boolean;
          previousRank?: string;
          newRank?: string;
          nextRank?: string;
          remainingVolumeToNextRank?: number;
          progressPercent?: number;
        };
      };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر إرسال التقييم." : "Failed to submit review."));
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
      await fetchRoom(true);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : (isAr ? "تعذر إرسال التقييم." : "Failed to submit review."));
    } finally {
      setReviewBusy(false);
    }
  }, [fetchRoom, isAr, request, reviewComment, reviewRating]);

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
          <p className="mt-2 text-sm text-[#FCA5A5]">{errorMessage ?? (isAr ? "الصفقة غير متاحة أو ليس لديك صلاحية الوصول." : "Trade was not found or you do not have access.")}</p>
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

  const isActorBuyer = request.buyerId === actor.id;
  const actorSide: "buyer" | "seller" = isActorBuyer ? "buyer" : "seller";

  return (
    <main className="min-h-screen bg-[#050505] px-3 py-4 text-white md:px-5 md:py-5 xl:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 xl:gap-5">
        <Card className="border-[#C9A227]/35 bg-gradient-to-br from-[#141414] via-[#0E0E0E] to-[#050505]">
          <CardHeader className="space-y-3 xl:space-y-4">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_320px] xl:items-end">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-[#C9A227]">{isAr ? "غرفة التداول" : "Trade Room"}</p>
                <CardTitle className="mt-1 text-2xl font-semibold">{request.displayNumber ? `Trade #${request.displayNumber}` : request.tradeId ?? `Trade #${request.id.slice(-6)}`}</CardTitle>
                <p className="mt-1 text-sm text-[#D1D5DB]">
                  {isAr ? "المبلغ:" : "Amount:"} <span className="font-semibold text-white">{toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT</span> • {toNumber(request.fiatAmount).toLocaleString("en-IL")} {request.currency}
                </p>
                <p className="text-sm text-[#9CA3AF]">
                  {isSeller ? (isAr ? "المشتري" : "Buyer") : (isAr ? "البائع" : "Seller")}: <span className="text-white">{counterpartName}</span>
                </p>
                <p className="text-xs text-[#6B7280]">{isAr ? "حسابك" : "Your account"}: {actor.fullName}</p>
                <p className="text-sm text-[#9CA3AF]">
                  {isAr ? "طريقة الدفع" : "Payment Method"}: <span className="text-white">{request.paymentMethod}</span>
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-right text-xs text-[#D1D5DB]">
                <p>{isAr ? "حالة الاتصال" : "Live updates"}: <span className={streamConnected ? "text-emerald-300" : "text-amber-300"}>{streamConnected ? (isAr ? "متصل" : "Connected") : (isAr ? "إعادة الاتصال..." : "Reconnecting...")}</span></p>
                <p className="mt-1">{isAr ? "الحالة الحالية" : "Current status"}: <span className={isOverdueTrade ? "text-red-300" : "text-white"}>{tradeStatusLabel(request.status, isAr, isOverdueTrade)}</span></p>
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-[#D1D5DB]">
                <span>{isAr ? "تقدم الصفقة" : "Trade Progress"}</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-gradient-to-r from-[#C9A227] to-[#FDE68A] transition-all duration-300" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          </CardHeader>
        </Card>

        <section className="sticky top-2 z-20 rounded-2xl border border-white/10 bg-black/65 p-3 backdrop-blur-md">
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-start gap-2">
              {STEP_ORDER.map((step, index) => {
                const isCompleted = index < currentStepIndex;
                const isCurrent = index === currentStepIndex;
                return (
                  <div key={step.id} className="flex min-w-[104px] items-center gap-2 sm:min-w-[120px]">
                    <button
                      type="button"
                      onClick={() => setSelectedStep(step.id)}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base transition sm:h-12 sm:w-12 sm:text-lg ${
                        isCompleted
                          ? "border-emerald-400 bg-emerald-500 text-white"
                          : isCurrent
                            ? "border-[#C9A227] bg-[#C9A227]/25 text-[#FDE68A] shadow-[0_0_18px_rgba(201,162,39,0.45)]"
                            : "border-white/15 bg-black/40 text-[#9CA3AF]"
                      }`}
                    >
                      {isCompleted ? "✓" : step.icon}
                    </button>
                    <div className="text-xs">
                      <p className="font-medium text-white">{isAr ? step.label.ar : step.label.en}</p>
                      {isCurrent ? <p className="text-[#C9A227]">{isAr ? "المرحلة الحالية" : "Current step"}</p> : null}
                    </div>
                    {index < STEP_ORDER.length - 1 ? <div className={`h-0.5 w-10 ${index < currentStepIndex ? "bg-emerald-400" : "bg-white/15"}`} /> : null}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-2 text-sm text-[#D1D5DB]">
            {selectedStepEvent
              ? `${new Date(selectedStepEvent.createdAt).toLocaleString("en-IL")} • ${selectedStepEvent.message}`
              : (isAr ? "لا يوجد حدث مسجل لهذه المرحلة بعد." : "No logged event for this step yet.")}
          </p>
        </section>

        {statusBanner ? (
          <Card
            ref={statusBannerRef}
            className={`${turn?.isYourTurn ? "border-[#C9A227]/40 bg-[#C9A227]/10" : "border-[#6CAEFF]/35 bg-[#6CAEFF]/10"} ${stepPulse ? "ring-2 ring-[#C9A227]/30" : ""}`}
          >
            <CardHeader className="pb-2">
              <p className={`text-xs uppercase tracking-[0.14em] ${turn?.isYourTurn ? "text-[#FDE68A]" : "text-[#BFDBFE]"}`}>{statusBanner.title}</p>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-3xl">
                    {statusBanner.icon}
                  </div>
                  <div>
                    <CardTitle className="text-2xl">{statusBanner.headline}</CardTitle>
                    <p className="mt-2 text-sm text-[#E5E7EB]">{statusBanner.detail}</p>
                  </div>
                </div>
                <div className="grid gap-2 text-sm xl:min-w-[300px]">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "إجراك الحالي" : "Your action"}</p>
                    <p className="mt-1 text-white">{statusBanner.yourAction}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "إجراء الطرف الآخر" : "Other party"}</p>
                    <p className="mt-1 text-white">{statusBanner.counterpartyAction}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "حالة الصفقة" : "Trade status"}</p>
                    <p className="mt-1 text-white">{statusBanner.tradeStatus}</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-[#E5E7EB]">
              <p>{turn?.detail}</p>
            </CardContent>
          </Card>
        ) : null}

        {showSuccessScreen ? (
          <Card className="border-emerald-500/35 bg-emerald-500/10">
            <CardHeader>
              <CardTitle className="text-2xl">{isAr ? "🎉 اكتملت الصفقة بنجاح" : "🎉 Trade Completed Successfully"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-[#D1FAE5]">
              <p>{isAr ? `${toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT تم استلامها.` : `${toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT received.`}</p>
              <p>{isAr ? "البائع أكد الدفع وأرسل USDT، والمشتري أكد الاستلام." : "Seller confirmed payment and released USDT, and buyer confirmed receipt."}</p>
              <p>{isAr ? `تأكيد البائع: ${request.usdtSentAt ? new Date(request.usdtSentAt).toLocaleString("en-IL") : "تم"}` : `Seller confirmation: ${request.usdtSentAt ? new Date(request.usdtSentAt).toLocaleString("en-IL") : "Confirmed"}`}</p>
              <p>{isAr ? `تأكيد المشتري: ${request.completedAt ? new Date(request.completedAt).toLocaleString("en-IL") : "تم"}` : `Buyer confirmation: ${request.completedAt ? new Date(request.completedAt).toLocaleString("en-IL") : "Confirmed"}`}</p>
              {room.sellerCommissionDueCount > 0 && isSeller ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
                  <p className="font-medium">{isAr ? "عمولة مستحقة" : "Commission Due"}</p>
                  <p>{isAr ? `الإجمالي: ${room.sellerCommissionDueAmount.toFixed(2)} USDT` : `Amount: ${room.sellerCommissionDueAmount.toFixed(2)} USDT`}</p>
                  <p className="text-xs">{isAr ? "لن تتمكن من نشر عروض جديدة حتى السداد." : "New listing creation stays blocked until payment is cleared."}</p>
                </div>
              ) : null}
              {isActorBuyer && !request.buyerReview && !reviewDeferred ? (
                <div className="rounded-xl border border-emerald-400/30 bg-black/20 p-3">
                  <p className="mb-2 font-medium text-white">{isAr ? "مطلوب قبل الصفقة التالية: قيّم البائع" : "Required before your next trade: Rate Seller & Leave Feedback"}</p>
                  <div className="grid gap-2 md:grid-cols-[120px_1fr]">
                    <select
                      value={reviewRating}
                      onChange={(event) => setReviewRating(Number(event.target.value))}
                      className="h-10 rounded-xl border border-white/15 bg-[#101010] px-3 text-sm text-white"
                    >
                      <option value={5}>★★★★★ (5)</option>
                      <option value={4}>★★★★☆ (4)</option>
                      <option value={3}>★★★☆☆ (3)</option>
                      <option value={2}>★★☆☆☆ (2)</option>
                      <option value={1}>★☆☆☆☆ (1)</option>
                    </select>
                    <Textarea
                      value={reviewComment}
                      onChange={(event) => setReviewComment(event.target.value)}
                      placeholder={isAr ? "اكتب تقييمك للبائع..." : "Share your seller feedback..."}
                    />
                  </div>
                  <Button type="button" className="mt-2" disabled={reviewBusy} onClick={() => void handleSubmitBuyerReview()}>
                    {reviewBusy ? (isAr ? "جاري الإرسال..." : "Submitting...") : (isAr ? "إرسال التقييم" : "Submit Rating")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-2 ms-2"
                    disabled={reviewBusy}
                    onClick={() => {
                      setReviewDeferred(true);
                      setStatusMessage(
                        isAr
                          ? "يمكنك المتابعة الآن، لكن يجب إكمال تقييم الصفقة السابقة قبل بدء صفقة جديدة."
                          : "You can continue now, but you must complete this feedback before starting a new trade.",
                      );
                    }}
                  >
                    {isAr ? "ذكرني لاحقًا" : "Remind Me Later"}
                  </Button>
                </div>
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
        ) : null}

        {!showSuccessScreen ? <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_380px] xl:items-start">
          <div className="space-y-4">
            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle className="text-lg">{isAr ? "بطاقة الحالة الحالية" : "Current Status"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#C9A227]">{isAr ? "الحالة" : "Status"}</p>
                  <p className={`mt-1 text-2xl font-semibold ${isOverdueTrade ? "text-red-300" : ""}`}>{tradeStatusLabel(request.status, isAr, isOverdueTrade)}</p>
                  <p className="mt-2 text-sm text-[#D1D5DB]">
                    {isAr
                      ? `المبلغ المطلوب ${toNumber(request.fiatAmount).toLocaleString("en-IL")} ${request.currency} مقابل ${toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT.`
                      : `Required amount is ${toNumber(request.fiatAmount).toLocaleString("en-IL")} ${request.currency} for ${toNumber(request.usdtAmount).toLocaleString("en-IL")} USDT.`}
                  </p>
                </div>

                {completedActionLabel ? (
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-4 text-center text-base font-semibold text-emerald-100">
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                      <span>{completedActionLabel}</span>
                    </span>
                  </div>
                ) : primaryAction ? (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      className="h-12 w-full text-base font-semibold"
                      disabled={primaryActionLoading || Boolean(primaryActionDisabledReason)}
                      onClick={() => void handlePrimaryAction()}
                    >
                      {primaryActionLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          <span>{isAr ? "جاري التنفيذ..." : "Processing..."}</span>
                        </span>
                      ) : primaryAction.label}
                    </Button>
                    {primaryActionDisabledReason ? <p className="text-xs text-amber-300">{primaryActionDisabledReason}</p> : null}
                    {!isSeller && request.status === "accepted" ? (
                      <p className="text-xs text-[#9CA3AF]">
                        {isAr ? "زر الإجراء الرئيسي سيقودك خلال الخطوة التالية مباشرة." : "The primary action above always guides you to the next step."}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-[#9CA3AF]">{isAr ? "لا يوجد إجراء مطلوب الآن." : "No required action at this moment."}</p>
                )}
                {isSeller && request.status === "accepted" ? (
                  <div className="rounded-xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 p-3 text-sm text-[#DBEAFE]">
                    <p className="font-medium text-white">{isAr ? "بانتظار دفع المشتري" : "Waiting for Buyer Payment"}</p>
                    <p className="mt-1">
                      {isAr
                        ? "بانتظار المشتري لرفع إيصال الدفع. لا يمكنك المتابعة قبل إرسال الدفع."
                        : "Waiting for the buyer to upload their payment receipt. You cannot continue until the buyer submits payment."}
                    </p>
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
                        <Textarea value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} placeholder={isAr ? "اكتب سبب النزاع..." : "Describe the dispute reason..."} />
                        <Button type="button" size="sm" disabled={disputeBusy} onClick={() => void handleOpenDispute()}>
                          {disputeBusy ? (isAr ? "جاري الإرسال..." : "Submitting...") : (isAr ? "تأكيد فتح النزاع" : "Submit Dispute")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-4 2xl:grid-cols-2">
              <Card ref={evidenceSectionRef} className="border-white/10 bg-[#0B0B0B]/90">
                <CardHeader>
                  <CardTitle className="text-lg">{isAr ? "مهلة إصدار USDT" : "USDT Release Deadline"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-[#D1D5DB]">
                  {room.releaseDeadlineActive && timeRemainingSeconds !== null ? (
                    <div className={`rounded-xl border p-4 ${
                      deadlineCritical
                        ? "border-red-500/40 bg-red-500/15 text-red-100"
                        : deadlineWarning
                          ? "border-amber-500/45 bg-amber-500/15 text-amber-100"
                          : "border-[#C9A227]/35 bg-[#C9A227]/10 text-[#FDE68A]"
                    }`}>
                      <p className="text-xs uppercase tracking-[0.14em]">{isAr ? "الوقت المتبقي" : "Time Remaining"}</p>
                      <p className="mt-1 text-3xl font-bold">{formatDuration(timeRemainingSeconds)}</p>
                      {(room.releaseDeadlineOverdue || room.isOverdue) ? <p className="mt-2 text-sm text-red-200">{isAr ? "انتهت المهلة — تم وضع الصفقة كمتأخرة." : "Deadline reached — trade is overdue."}</p> : null}
                    </div>
                  ) : (
                    <p>{isAr ? "سيبدأ عداد 45 دقيقة بعد تأكيد استلام الدفع وبدء مرحلة إصدار USDT." : "The 45-minute timer starts when seller confirms funds and enters USDT release stage."}</p>
                  )}
                  <p className="rounded-xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 p-3">
                    {isAr ? "التذكير: لن يتم تحرير USDT إلا بعد تأكيد الدفع داخل Alpha Exchange." : "Escrow reminder: USDT is released only after payment confirmation inside Alpha Exchange."}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[#0B0B0B]/90">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg"><WalletCards className="h-4 w-4 text-[#C9A227]" />{isAr ? "حالة الضمان" : "Escrow Visualization"}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm md:grid-cols-2 2xl:grid-cols-2">
                  {[
                    { label: isAr ? "USDT مقفول" : "USDT Locked", active: request.status !== "review_open" && request.status !== "completed" && request.status !== "locked" },
                    { label: isAr ? "بانتظار الدفع" : "Waiting Payment", active: request.status === "accepted" || request.status === "payment_sent" },
                    { label: isAr ? "قيد التحرير" : "Released", active: request.status === "funds_received" || request.status === "usdt_release_pending" || request.status === "usdt_sent" },
                    { label: isAr ? "مكتمل" : "Completed", active: request.status === "review_open" || request.status === "completed" || request.status === "locked" },
                  ].map((item) => (
                    <div key={item.label} className={`rounded-xl border px-3 py-2 ${item.active ? "border-[#C9A227]/40 bg-[#C9A227]/10 text-white" : "border-white/10 bg-black/20 text-[#9CA3AF]"}`}>
                      {item.label}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle className="text-lg">{isAr ? "قسم الإثبات" : "Evidence"}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="font-medium text-white">{isAr ? "إيصال دفع المشتري" : "Buyer Payment Receipt"}</p>
                  {canShowBuyerReceipt ? (
                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.buyerEvidence!.id}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[#C9A227] hover:underline">
                      {request.buyerEvidence!.fileName}
                    </a>
                  ) : (
                    <p className="mt-2 text-[#9CA3AF]">
                      {isSeller && request.status === "accepted"
                        ? (isAr ? "سيظهر إيصال المشتري هنا بعد إرسال الدفع." : "The buyer receipt will appear here after payment is submitted.")
                        : (isAr ? "لم يتم الرفع بعد." : "Not uploaded yet.")}
                    </p>
                  )}
                  {actorSide === "buyer" && request.status === "accepted" ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-[#9CA3AF]">
                        {isAr ? "هذه الخطوة مطلوبة قبل إرسال تأكيد الدفع." : "This receipt is required before payment confirmation."}
                      </p>
                      <Input ref={buyerEvidenceInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={(event) => setBuyerEvidenceFile(event.target.files?.[0] ?? null)} />
                      {buyerEvidenceFile ? (
                        <p className="text-xs text-[#C9A227]">
                          {isAr ? `الملف المحدد: ${buyerEvidenceFile.name}` : `Selected file: ${buyerEvidenceFile.name}`}
                        </p>
                      ) : (
                        <p className="text-xs text-[#9CA3AF]">
                          {isAr ? "اختر الملف ثم استخدم زر الإجراء الرئيسي للمتابعة." : "Choose the file, then use the main action button above to continue."}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="font-medium text-white">{isAr ? "إثبات البائع" : "Seller Release Proof"}</p>
                  {request.sellerEvidence ? (
                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.sellerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[#C9A227] hover:underline">
                      {request.sellerEvidence.fileName}
                    </a>
                  ) : (
                    <p className="mt-2 text-[#9CA3AF]">
                      {sellerEvidenceUploadOpen
                        ? (isAr ? "بانتظار رفع إثبات البائع." : "Waiting for seller upload.")
                        : (isAr ? "سيتم تمكين الرفع عند مرحلة إصدار USDT." : "Upload will be available at the USDT release stage.")}
                    </p>
                  )}
                  {actorSide === "seller" && sellerEvidenceUploadOpen ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-[#9CA3AF]">
                        {sellerEvidenceRequired
                          ? (isAr ? "رفع الإثبات مطلوب قبل تأكيد إرسال USDT." : "Seller evidence is required before marking USDT sent.")
                          : (isAr ? "يمكنك رفع إثبات اختياري قبل تأكيد إرسال USDT." : "You may upload optional evidence before marking USDT sent.")}
                      </p>
                      <Input ref={sellerEvidenceInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={(event) => setSellerEvidenceFile(event.target.files?.[0] ?? null)} />
                      {sellerEvidenceFile ? (
                        <div className="space-y-2">
                          <p className="text-xs text-[#C9A227]">
                            {isAr ? `الملف المحدد: ${sellerEvidenceFile.name}` : `Selected file: ${sellerEvidenceFile.name}`}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              loading={evidenceBusy === "seller"}
                              loadingLabel={isAr ? "جارٍ الرفع..." : "Uploading..."}
                              onClick={() => void handleUploadEvidence("seller")}
                            >
                              {request.sellerEvidence
                                ? (isAr ? "استبدال الرفع" : "Replace Upload")
                                : (isAr ? "رفع الإثبات" : "Upload Seller Evidence")}
                            </Button>
                            <Button type="button" size="sm" variant="secondary" onClick={() => setSellerEvidenceFile(null)}>
                              {isAr ? "إزالة الملف" : "Remove File"}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-[#9CA3AF]">
                          {isAr ? "اختر ملفًا للرفع. يمكنك الاستبدال لاحقًا قبل المتابعة." : "Choose a file to upload. You can replace it before continuing."}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle className="text-lg">{isAr ? "الخط الزمني للصفقة" : "Trade Timeline"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {activeTimeline.length ? (
                  activeTimeline.map((event) => (
                    <div key={event.id} className="flex gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-[#C9A227]" />
                      <div>
                        <p className="text-white">{event.message}</p>
                        <p className="text-xs text-[#9CA3AF]">{new Date(event.createdAt).toLocaleString("en-IL")}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[#9CA3AF]">{isAr ? "لا توجد أحداث بعد." : "No timeline events yet."}</p>
                )}
              </CardContent>
            </Card>
            </div>
          </div>

          <div className="space-y-4 xl:sticky xl:top-28">
            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><MessageCircle className="h-4 w-4 text-[#C9A227]" />{isAr ? "الدردشة المباشرة" : "Live Chat"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="max-h-[380px] space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3">
                  {room.messages.length ? (
                    room.messages.map((message) => {
                      const ownMessage = message.senderUserId === actor.id;
                      const counterpartyId = ownMessage ? (isSeller ? request.buyerId : request.sellerId) : "";
                      const readByCounterparty = ownMessage && message.readByUserIds.includes(counterpartyId);
                      return (
                        <div
                          key={message.id}
                          className={`max-w-[92%] rounded-xl px-3 py-2 text-sm ${
                            message.kind === "system"
                              ? "mx-auto border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 text-[#D1D5DB]"
                              : ownMessage
                                ? "ml-auto border border-[#C9A227]/40 bg-[#C9A227]/15 text-white"
                                : "border border-white/10 bg-black/40 text-[#E5E7EB]"
                          }`}
                        >
                          <p>{message.message}</p>
                          <p className="mt-1 text-[11px] text-[#9CA3AF]">
                            {new Date(message.createdAt).toLocaleTimeString("en-IL", { hour: "2-digit", minute: "2-digit" })}
                            {ownMessage ? ` • ${readByCounterparty ? (isAr ? "تمت القراءة" : "Read") : (isAr ? "تم الإرسال" : "Sent")}` : ""}
                          </p>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-[#9CA3AF]">{isAr ? "لا توجد رسائل بعد." : "No messages yet."}</p>
                  )}
                </div>
                <form className="space-y-2" onSubmit={handleSendMessage}>
                  <Textarea value={chatDraft} onChange={(event) => setChatDraft(event.target.value)} placeholder={isAr ? "اكتب رسالة..." : "Type a message..."} />
                  <Button type="submit" className="w-full" disabled={chatBusy || !chatDraft.trim()}>
                    {chatBusy ? (isAr ? "جاري الإرسال..." : "Sending...") : (isAr ? "إرسال الرسالة" : "Send Message")}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-[#C9A227]" />{isAr ? "سلامة الصفقة" : "Trade Safety"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-[#D1D5DB]">
                <p>{isAr ? "لن يتم تحرير USDT إلا بعد تأكيد الدفع داخل Alpha Exchange." : "USDT is released only after seller confirms payment inside Alpha Exchange."}</p>
                <p>{isAr ? "لا ترسل أي دفعة خارج مسار الصفقة المعتمد." : "Never send payment outside the Alpha Exchange process."}</p>
              </CardContent>
            </Card>

            {room.sellerCommissionDueCount > 0 && isSeller ? (
              <Card className="border-amber-500/30 bg-amber-500/10">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-200" />{isAr ? "عمولة مستحقة" : "Commission Due"}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-[#FDE68A]">
                  <p>{isAr ? `عدد العمولات غير المدفوعة: ${room.sellerCommissionDueCount}` : `Pending commissions: ${room.sellerCommissionDueCount}`}</p>
                  <p className="mt-1">{isAr ? `المبلغ الإجمالي: ${room.sellerCommissionDueAmount.toFixed(2)} USDT` : `Total due: ${room.sellerCommissionDueAmount.toFixed(2)} USDT`}</p>
                  <p className="mt-1 text-xs text-amber-100">{isAr ? "لن تتمكن من نشر عروض جديدة حتى السداد." : "New listing creation stays blocked until payment is cleared."}</p>
                  <Button type="button" size="sm" className="mt-2" onClick={() => router.push("/usdt-exchange")}>
                    Pay Now
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

        {statusMessage ? (
          <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-[#D1D5DB]">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <span>{statusMessage}</span>
            </div>
          </div>
        ) : null}

        {actionNotice ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <div className="flex items-center gap-2">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>{actionNotice}</span>
            </div>
          </div>
        ) : null}

        {actionError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span>{actionError}</span>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-[#FCA5A5]">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              <span>{errorMessage}</span>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
