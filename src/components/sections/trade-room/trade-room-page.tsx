"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock3, MessageCircle, ShieldCheck, Upload, WalletCards } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MarketplaceListing, PurchaseRequest, TradeChatMessage, TradeTimelineEntry, UserRole } from "@/types/alpha-exchange";

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
};

type ActorSession = {
  id: string;
  role: UserRole;
  fullName: string;
};

type StepId = "request" | "accepted" | "payment" | "released" | "completed";

type PrimaryAction = {
  label: string;
  nextStatus: "accepted" | "payment_sent" | "funds_received" | "usdt_release_pending" | "usdt_sent" | "completed";
  requiresEvidenceSide?: "buyer" | "seller";
};

const ALLOWED_EVIDENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_EVIDENCE_SIZE_BYTES = 8 * 1024 * 1024;

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

function getPrimaryAction(request: PurchaseRequest, isSeller: boolean, isAr: boolean): PrimaryAction | null {
  if (request.status === "pending" && isSeller) {
    return { label: isAr ? "قبول الطلب" : "Accept Request", nextStatus: "accepted" };
  }
  if (request.status === "accepted" && !isSeller) {
    return {
      label: isAr ? "لقد أرسلت الدفعة" : "I've Sent The Money",
      nextStatus: "payment_sent",
      requiresEvidenceSide: "buyer",
    };
  }
  if (request.status === "payment_sent" && isSeller) {
    return {
      label: isAr ? "تأكيد استلام الدفعة" : "Confirm Payment Received",
      nextStatus: "funds_received",
    };
  }
  if (request.status === "funds_received" && isSeller) {
    return {
      label: isAr ? "بدء إرسال USDT" : "Start USDT Release",
      nextStatus: "usdt_release_pending",
    };
  }
  if (request.status === "usdt_release_pending" && isSeller) {
    return {
      label: isAr ? "تأكيد إرسال USDT" : "Mark USDT Sent",
      nextStatus: "usdt_sent",
      requiresEvidenceSide: "seller",
    };
  }
  if (request.status === "usdt_sent" && !isSeller) {
    return {
      label: isAr ? "تأكيد استلام USDT" : "Confirm USDT Received",
      nextStatus: "completed",
    };
  }
  return null;
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
          detail: isAr ? "المشتري سيقوم بإرسال الدفعة ورفع الإثبات." : "Buyer will send payment and upload evidence.",
        }
      : {
          isYourTurn: true,
          title: isAr ? "دورك الآن" : "YOUR TURN",
          detail: isAr ? "أرسل الدفعة ثم أكد أنك أرسلتها." : "Send payment, upload proof, then confirm.",
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
  const reconnectTimeoutRef = useRef<number | null>(null);

  const fetchRoom = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setErrorMessage(null);
    }
    try {
      const response = await fetch(`/api/alpha-exchange/trade-room/${requestId}`, { cache: "no-store" });
      const payload = (await response.json()) as TradeRoomData & { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر تحميل غرفة الصفقة." : "Failed to load trade room."));
      }
      setRoom(payload);
      setSelectedStep(getStepId(payload.request.status));
    } catch (error) {
      const message = error instanceof Error ? error.message : (isAr ? "تعذر تحميل غرفة الصفقة." : "Failed to load trade room.");
      setErrorMessage(message);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [isAr, requestId]);

  useEffect(() => {
    void fetchRoom();
  }, [fetchRoom]);

  useEffect(() => {
    if (!room) return;
    setSelectedStep(getStepId(room.request.status));
  }, [room]);

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

    return () => {
      closed = true;
      stream.close();
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
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
  const counterpartName = request
    ? (isSeller ? room?.counterpart.buyerName : room?.counterpart.sellerName)
    : "";
  const currentStepIndex = request ? getStepIndex(request.status) : 0;
  const progressPercent = Math.round((currentStepIndex / (STEP_ORDER.length - 1)) * 100);
  const turn = request ? getTurnPanel(request, isSeller, isAr) : null;
  const primaryAction = request ? getPrimaryAction(request, isSeller, isAr) : null;
  const isOverdueTrade = Boolean(room?.isOverdue);
  const showSuccessScreen = request?.status === "review_open" || request?.status === "completed" || request?.status === "locked";
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
    if (primaryAction.requiresEvidenceSide === "buyer" && !request.buyerEvidence) {
      return isAr ? "ارفع إثبات الدفع أولًا." : "Upload buyer evidence before confirming payment.";
    }
    if (primaryAction.requiresEvidenceSide === "seller" && !request.sellerEvidence) {
      return isAr ? "ارفع إثبات البائع أولًا." : "Upload seller evidence before marking USDT sent.";
    }
    return null;
  }, [isAr, primaryAction, request]);

  const handleStatusUpdate = useCallback(async (nextStatus: PrimaryAction["nextStatus"]) => {
    if (!request) return;
    setActionBusy(true);
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر تحديث حالة الصفقة." : "Failed to update trade status."));
      }
      setStatusMessage(isAr ? "تم تحديث حالة الصفقة." : "Trade status updated.");
      await fetchRoom(true);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : (isAr ? "تعذر تحديث حالة الصفقة." : "Failed to update trade status."));
    } finally {
      setActionBusy(false);
    }
  }, [fetchRoom, isAr, request]);

  const handleSendMessage = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!request) return;
    const message = chatDraft.trim();
    if (!message) return;
    setChatBusy(true);
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر إرسال الرسالة." : "Failed to send message."));
      }
      setChatDraft("");
      await fetchRoom(true);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : (isAr ? "تعذر إرسال الرسالة." : "Failed to send message."));
    } finally {
      setChatBusy(false);
    }
  }, [chatDraft, fetchRoom, isAr, request]);

  const handleUploadEvidence = useCallback(async (side: "buyer" | "seller") => {
    if (!request) return;
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
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر رفع الإثبات." : "Failed to upload evidence."));
      }
      if (side === "buyer") setBuyerEvidenceFile(null);
      else setSellerEvidenceFile(null);
      setStatusMessage(isAr ? "تم رفع الإثبات بنجاح." : "Evidence uploaded.");
      await fetchRoom(true);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : (isAr ? "تعذر رفع الإثبات." : "Failed to upload evidence."));
    } finally {
      setEvidenceBusy(null);
    }
  }, [buyerEvidenceFile, fetchRoom, isAr, request, sellerEvidenceFile]);

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
      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(readApiErrorFallback(payload, isAr ? "تعذر إرسال التقييم." : "Failed to submit review."));
      }
      setReviewComment("");
      setStatusMessage(isAr ? "تم إرسال تقييم البائع." : "Seller rating submitted.");
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
        <div className="mx-auto max-w-7xl rounded-2xl border border-white/10 bg-black/30 p-6">
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
    <main className="min-h-screen bg-[#050505] px-3 py-4 text-white md:px-6 md:py-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <Card className="border-[#C9A227]/35 bg-gradient-to-br from-[#141414] via-[#0E0E0E] to-[#050505]">
          <CardHeader className="space-y-4">
            <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
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
                  <div key={step.id} className="flex min-w-[120px] items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedStep(step.id)}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`flex h-12 w-12 items-center justify-center rounded-full border text-lg transition ${
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

        {turn ? (
          <Card className={turn.isYourTurn ? "border-[#C9A227]/40 bg-[#C9A227]/10" : "border-[#6CAEFF]/35 bg-[#6CAEFF]/10"}>
            <CardHeader className="pb-2">
              <p className={`text-xs uppercase tracking-[0.14em] ${turn.isYourTurn ? "text-[#FDE68A]" : "text-[#BFDBFE]"}`}>{turn.title}</p>
              <CardTitle className="text-xl">{tradeStatusLabel(request.status, isAr, isOverdueTrade)}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-[#E5E7EB]">
              <p>{turn.detail}</p>
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
                  <p>{isAr ? `الإجمالي: ₪${room.sellerCommissionDueAmount.toFixed(2)}` : `Amount: ₪${room.sellerCommissionDueAmount.toFixed(2)}`}</p>
                  <p className="text-xs">{isAr ? "لن تتمكن من نشر عروض جديدة حتى السداد." : "New listing creation stays blocked until payment is cleared."}</p>
                </div>
              ) : null}
              {isActorBuyer && !request.buyerReview ? (
                <div className="rounded-xl border border-emerald-400/30 bg-black/20 p-3">
                  <p className="mb-2 font-medium text-white">{isAr ? "★★★★★ قيّم البائع واترك ملاحظتك" : "★★★★★ Rate Seller & Leave Feedback"}</p>
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

        {!showSuccessScreen ? <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
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

                {primaryAction ? (
                  <div className="space-y-2">
                    <Button
                      type="button"
                      className="h-12 w-full text-base font-semibold"
                      disabled={actionBusy || Boolean(primaryActionDisabledReason)}
                      onClick={() => void handleStatusUpdate(primaryAction.nextStatus)}
                    >
                      {actionBusy ? (isAr ? "جاري التنفيذ..." : "Processing...") : primaryAction.label}
                    </Button>
                    {primaryActionDisabledReason ? <p className="text-xs text-amber-300">{primaryActionDisabledReason}</p> : null}
                  </div>
                ) : (
                  <p className="text-sm text-[#9CA3AF]">{isAr ? "لا يوجد إجراء مطلوب الآن." : "No required action at this moment."}</p>
                )}

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

            <Card className="border-white/10 bg-[#0B0B0B]/90">
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
              <CardContent className="grid gap-2 text-sm md:grid-cols-4">
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

            <Card className="border-white/10 bg-[#0B0B0B]/90">
              <CardHeader>
                <CardTitle className="text-lg">{isAr ? "قسم الإثبات" : "Evidence"}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="font-medium text-white">{isAr ? "إثبات المشتري" : "Buyer Evidence"}</p>
                  {request.buyerEvidence ? (
                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.buyerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[#C9A227] hover:underline">
                      {request.buyerEvidence.fileName}
                    </a>
                  ) : (
                    <p className="mt-2 text-[#9CA3AF]">{isAr ? "لم يتم الرفع بعد." : "Not uploaded yet."}</p>
                  )}
                  {actorSide === "buyer" ? (
                    <div className="mt-3 space-y-2">
                      <Input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={(event) => setBuyerEvidenceFile(event.target.files?.[0] ?? null)} />
                      <Button type="button" size="sm" variant="secondary" disabled={!buyerEvidenceFile || evidenceBusy === "buyer"} onClick={() => void handleUploadEvidence("buyer")}>
                        <Upload className="h-4 w-4" /> {evidenceBusy === "buyer" ? (isAr ? "جارٍ الرفع..." : "Uploading...") : (isAr ? "رفع الإثبات" : "Upload Evidence")}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="font-medium text-white">{isAr ? "إثبات البائع" : "Seller Evidence"}</p>
                  {request.sellerEvidence ? (
                    <a href={`/api/alpha-exchange/purchase-requests/${request.id}/evidence/${request.sellerEvidence.id}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[#C9A227] hover:underline">
                      {request.sellerEvidence.fileName}
                    </a>
                  ) : (
                    <p className="mt-2 text-[#9CA3AF]">{isAr ? "لم يتم الرفع بعد." : "Not uploaded yet."}</p>
                  )}
                  {actorSide === "seller" ? (
                    <div className="mt-3 space-y-2">
                      <Input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={(event) => setSellerEvidenceFile(event.target.files?.[0] ?? null)} />
                      <Button type="button" size="sm" variant="secondary" disabled={!sellerEvidenceFile || evidenceBusy === "seller"} onClick={() => void handleUploadEvidence("seller")}>
                        <Upload className="h-4 w-4" /> {evidenceBusy === "seller" ? (isAr ? "جارٍ الرفع..." : "Uploading...") : (isAr ? "رفع الإثبات" : "Upload Evidence")}
                      </Button>
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

          <div className="space-y-4">
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
                  <p className="mt-1">{isAr ? `المبلغ الإجمالي: ₪${room.sellerCommissionDueAmount.toFixed(2)}` : `Total due: ₪${room.sellerCommissionDueAmount.toFixed(2)}`}</p>
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
