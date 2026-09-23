"use client";

import { useEffect, useState } from "react";
import { FileClock, MessageCircle, ShieldCheck } from "lucide-react";
import { localizeCardlessWithdrawalMessage } from "@alpha-traders/contracts";
import { Button } from "@/components/ui/button";
import { TradeOwnerActions } from "@/components/admin/trade-owner-actions";
import { currencyText } from "@/components/ui/currency-text";
import { formatTradeId } from "@/lib/format-id";
import { ISRAEL_TIME_ZONE } from "@/lib/israel-calendar";
import { marketplacePaymentMethodLabelForLocale } from "@/lib/marketplace-display-localization";
import { localizeTradeRoomSystemMessage } from "@/lib/trade-room-system-message-localization";
import type { AuditLogEntry, PurchaseRequest, TradeChatMessage, TradeDisputeCase, TradeEvidenceFile, UserRole } from "@/types/alpha-exchange";

export type OwnerTradeHistoryData = {
  request: PurchaseRequest;
  counterpart: { buyerName: string; sellerName: string };
  messages: TradeChatMessage[];
  ownerHistory?: {
    evidenceFiles: TradeEvidenceFile[];
    disputes: TradeDisputeCase[];
    auditLogs: AuditLogEntry[];
  };
};

type Props = { locale: "ar" | "en"; requestId: string };

const panelClass = "scroll-mt-28 rounded-2xl border border-white/10 bg-[#0B0B0B] p-4 sm:p-5";
const linkClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-medium text-white hover:border-[#C9A227] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A227]";

/** Reading history has no side effects. Owner mutations are explicit actions. */
export function OwnerTradeHistoryPage({ locale, requestId }: Props) {
  const isAr = locale === "ar";
  const [room, setRoom] = useState<OwnerTradeHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setRoom((current) => current?.request.id === requestId ? current : null);
    setError(null);
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const response = await fetch(`/api/alpha-exchange/trade-room/${encodeURIComponent(requestId)}?view=history`, {
          cache: "no-store", signal: controller.signal,
        });
        const payload = await response.json() as OwnerTradeHistoryData;
        if (!response.ok || payload.request?.id !== requestId || !Array.isArray(payload.messages)) throw new Error("history_unavailable");
        if (active) setRoom(payload);
      } catch {
        if (active) setError(isAr ? "تعذر تحميل سجل الصفقة. تحقق من اتصالك وصلاحية حساب المالك ثم أعد المحاولة." : "Could not load trade history. Check your connection and owner access, then retry.");
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [attempt, isAr, requestId]);

  return (
    <main dir={isAr ? "rtl" : "ltr"} lang={locale} className="min-h-screen bg-[#050505] px-3 py-5 text-white sm:px-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <a href={`/${locale}/admin/alpha-exchange?section=purchase-requests&requestId=${encodeURIComponent(requestId)}&details=1`} className={linkClass}>
          {isAr ? "العودة إلى طلبات الشراء" : "Back to purchases"}
        </a>
        {loading && !room ? <p role="status" className={panelClass}>{isAr ? "جاري تحميل سجل غرفة الصفقة…" : "Loading trade room history…"}</p> : null}
        {error ? <div role="alert" className={panelClass}><p>{error}</p><Button type="button" variant="secondary" className="mt-3" onClick={() => setAttempt((value) => value + 1)}>{isAr ? "إعادة المحاولة" : "Retry"}</Button></div> : null}
        {room ? <OwnerTradeHistory locale={locale} room={room} onUpdated={() => setAttempt((value) => value + 1)} /> : null}
      </div>
    </main>
  );
}

export function OwnerTradeHistory({ locale, room, onUpdated }: { locale: "ar" | "en"; room: OwnerTradeHistoryData; onUpdated?: () => void }) {
  const isAr = locale === "ar";
  const t = (en: string, ar: string) => isAr ? ar : en;
  const request = room.request;
  const date = (value?: string) => value ? new Date(value).toLocaleString(isAr ? "ar-IL-u-nu-latn" : "en-IL", { timeZone: ISRAEL_TIME_ZONE }) : "—";
  const statusLabels: Record<PurchaseRequest["status"], string> = {
    pending: t("Pending", "قيد الانتظار"), accepted: t("Accepted", "مقبولة"), payment_sent: t("Payment sent", "تم إرسال الدفع"),
    funds_received: t("Funds received", "تم استلام الأموال"), usdt_release_pending: t("USDT release pending", "بانتظار إرسال USDT"),
    usdt_sent: t("USDT sent", "تم إرسال USDT"), completed: t("Completed", "مكتملة"),
    review_open: t("Completed · review open", "مكتملة · التقييم متاح"), locked: t("Closed", "مغلقة"),
    declined: t("Declined", "مرفوضة"), cancelled: t("Cancelled", "ملغاة"),
  };
  const actorLabel = (userId: string, role: UserRole) => {
    if (userId === request.buyerId) return `${t("Buyer", "المشتري")} · ${room.counterpart.buyerName}`;
    if (userId === request.sellerId) return `${t("Seller", "البائع")} · ${room.counterpart.sellerName}`;
    if (role === "owner") return t("Owner", "المالك");
    if (role === "admin") return t("Admin", "الإدارة");
    return t("System", "النظام");
  };
  const messages = [...room.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const timeline = [...(request.timeline ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const evidence = room.ownerHistory?.evidenceFiles ?? [request.buyerEvidence, request.sellerEvidence].filter((entry) => entry !== undefined);
  const disputes = room.ownerHistory?.disputes ?? [];
  const auditLogs = room.ownerHistory?.auditLogs ?? [];
  const reviews = [
    { label: t("Buyer review of seller", "تقييم المشتري للبائع"), review: request.buyerReview },
    { label: t("Seller review of buyer", "تقييم البائع للمشتري"), review: request.sellerBuyerReview },
  ];

  return <>
    <header className={`${panelClass} border-rose-400/25 bg-gradient-to-br from-rose-400/[0.07] to-transparent`}>
      <p className="flex items-center gap-2 text-xs font-medium text-rose-200"><ShieldCheck className="h-4 w-4" aria-hidden="true" />{onUpdated ? t("Owner trade management", "إدارة الصفقة للمالك") : t("Owner review · read only", "مراجعة المالك · للقراءة فقط")}</p>
      <h1 className="mt-2 text-xl font-semibold">{t("Trade room history", "سجل غرفة الصفقة")} <bdi dir="ltr">{formatTradeId(request.displayNumber, request.tradeId ?? request.id)}</bdi></h1>
      <p className="mt-2 text-sm text-[#D1D5DB]">{t("Review the saved conversation, attachments, and every recorded trade event.", "راجع المحادثة والمرفقات المحفوظة وجميع أحداث الصفقة المسجلة.")}</p>
      <p className="mt-2 text-xs text-[#9CA3AF]">{t("All times are shown in Israel time.", "جميع الأوقات معروضة حسب توقيت إسرائيل.")}</p>
      <p className="mt-3 text-sm text-emerald-200">{currencyText(statusLabels[request.status])}</p>
      <nav aria-label={t("Trade history sections", "أقسام سجل الصفقة")} className="mt-4 flex flex-wrap gap-2">
        <a className={linkClass} href="#history-chat"><MessageCircle className="h-4 w-4" aria-hidden="true" />{t("Chat", "المحادثة")} ({messages.length})</a>
        <a className={linkClass} href="#history-timeline"><FileClock className="h-4 w-4" aria-hidden="true" />{t("Timeline", "السجل الزمني")} ({timeline.length})</a>
        <a className={linkClass} href="#history-evidence">{t("Evidence & reviews", "الإثباتات والتقييمات")}</a>
        {disputes.length || auditLogs.length ? <a className={linkClass} href="#history-audit">{t("Disputes & audit", "النزاعات وسجل الإجراءات")}</a> : null}
        {onUpdated ? <a className={linkClass} href="#owner-trade-actions">{t("Owner Actions", "إجراءات المالك")}</a> : null}
      </nav>
    </header>

    <section className={panelClass} aria-labelledby="history-details-heading">
      <h2 id="history-details-heading" className="font-semibold">{t("Trade details", "تفاصيل الصفقة")}</h2>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[
          [t("Buyer", "المشتري"), room.counterpart.buyerName], [t("Seller", "البائع"), room.counterpart.sellerName],
          [t("Amount", "الكمية"), `${request.usdtAmount} USDT`], [t("Payment amount", "مبلغ الدفع"), `${request.fiatAmount} ${request.currency}`],
          [t("Agreed price", "السعر المتفق عليه"), request.pricePerUsdt ? `${request.pricePerUsdt} ${request.currency} / USDT` : "—"],
          [t("Payment method", "طريقة الدفع"), marketplacePaymentMethodLabelForLocale(request.paymentMethod, locale)],
          [t("Network", "الشبكة"), request.network], [t("Bank", "البنك"), request.bankName ?? "—"],
          [t("Created", "تاريخ الإنشاء"), date(request.createdAt)], [t("Completed", "تاريخ الإكمال"), date(request.completedAt)],
          [t("Last update", "آخر تحديث"), date(request.updatedAt)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-[#9CA3AF]">{label}</dt><dd dir="auto" className="mt-1 break-words">{currencyText(value)}</dd></div>)}
      </dl>
      {request.buyerReceivingWalletAddress ? <p className="mt-4 break-all text-sm"><span className="text-[#9CA3AF]">{t("Buyer wallet", "محفظة المشتري")}: </span><bdi dir="ltr">{request.buyerReceivingWalletAddress}</bdi></p> : null}
      {request.buyerNotes ? <p dir="auto" className="mt-3 whitespace-pre-wrap text-sm"><span className="text-[#9CA3AF]">{t("Buyer notes", "ملاحظات المشتري")}: </span>{currencyText(request.buyerNotes)}</p> : null}
      {request.closeReason || request.closeExplanation ? <p className="mt-3 whitespace-pre-wrap text-sm text-amber-200">{t("Closure", "الإغلاق")}: {currencyText([request.closeReason, request.closeExplanation].filter(Boolean).join(" · "))}</p> : null}
      {request.termsProposal ? <div className="mt-4 rounded-xl border border-white/10 p-3 text-sm">
        <p className="font-medium">{t("Latest terms proposal", "آخر اقتراح لشروط الصفقة")}</p>
        <p className="mt-2">{currencyText(`${request.termsProposal.usdtAmount} USDT · ${request.termsProposal.fiatAmount} ${request.currency} · ${request.termsProposal.pricePerUsdt} ${request.currency} / USDT`)}</p>
        <p className="mt-1 text-[#9CA3AF]">{({ pending: t("Pending", "قيد الانتظار"), accepted: t("Accepted", "مقبول"), declined: t("Declined", "مرفوض"), withdrawn: t("Withdrawn", "مسحوب") })[request.termsProposal.status]} · {date(request.termsProposal.resolvedAt ?? request.termsProposal.createdAt)}</p>
      </div> : null}
    </section>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section id="history-chat" className={panelClass} aria-labelledby="history-chat-heading">
        <h2 id="history-chat-heading" className="flex items-center gap-2 font-semibold"><MessageCircle className="h-4 w-4 text-[#C9A227]" aria-hidden="true" />{t("Chat history", "سجل المحادثة")} ({messages.length})</h2>
        {messages.length ? <ol className="mt-4 space-y-3">{messages.map((message) => {
          const protectedDetails = message.credentialKind === "cardless_code" && (!message.message || /^Cardless withdrawal (?:details protected|(?:code|details) (?:unavailable|hidden after cash collection)|code redeemed)$/.test(message.message));
          const body = protectedDetails ? t("Protected withdrawal details were shared during this trade.", "تمت مشاركة بيانات سحب محمية خلال هذه الصفقة.")
            : message.credentialKind === "cardless_code" ? localizeCardlessWithdrawalMessage(message.message, locale)
            : message.kind === "system" ? localizeTradeRoomSystemMessage(message.message, locale).text : message.message;
          return <li key={message.id} className={`rounded-xl border p-3 text-sm ${message.kind === "system" ? "border-blue-400/20 bg-blue-400/5" : message.senderUserId === request.sellerId ? "border-[#C9A227]/25 bg-[#C9A227]/5" : "border-white/10 bg-white/[0.02]"}`}>
            <p className="text-xs font-medium text-[#D1D5DB]">{message.kind === "system" ? t("System", "النظام") : currencyText(actorLabel(message.senderUserId, message.senderRole))}</p>
            {body ? <p dir="auto" className="mt-2 whitespace-pre-wrap break-words">{currencyText(body)}</p> : null}
            {message.imageUrl ? <a href={message.imageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center break-all text-[#FDE68A] underline underline-offset-4">{currencyText(message.imageName || t("Open attachment", "فتح المرفق"))}</a> : null}
            <time dateTime={message.createdAt} className="mt-2 block text-xs text-[#9CA3AF]">{date(message.createdAt)}</time>
            {message.deletedAt ? <p className="mt-1 text-xs text-amber-200">{t("Deleted", "تم الحذف")} · {date(message.deletedAt)}</p> : null}
          </li>;
        })}</ol> : <p className="mt-4 text-sm text-[#9CA3AF]">{t("No chat messages were recorded for this trade.", "لا توجد رسائل محفوظة لهذه الصفقة.")}</p>}
      </section>

      <section id="history-timeline" className={panelClass} aria-labelledby="history-timeline-heading">
        <h2 id="history-timeline-heading" className="flex items-center gap-2 font-semibold"><FileClock className="h-4 w-4 text-[#C9A227]" aria-hidden="true" />{t("Full trade timeline", "السجل الزمني الكامل للصفقة")} ({timeline.length})</h2>
        {timeline.length ? <ol className="mt-4 space-y-3">{timeline.map((event) => <li key={event.id} className="border-s-2 border-[#C9A227]/35 ps-3 text-sm">
          <p dir="auto" className="whitespace-pre-wrap break-words">{currencyText(localizeTradeRoomSystemMessage(event.message, locale).text)}</p>
          <p className="mt-1 text-xs text-[#D1D5DB]">{currencyText(actorLabel(event.actorUserId, event.actorRole))}</p>
          <time dateTime={event.createdAt} className="mt-1 block text-xs text-[#9CA3AF]">{date(event.createdAt)}</time>
        </li>)}</ol> : <p className="mt-4 text-sm text-[#9CA3AF]">{t("No timeline events were recorded for this trade.", "لا توجد أحداث مسجلة لهذه الصفقة.")}</p>}
      </section>
    </div>

    <section id="history-evidence" className={panelClass} aria-labelledby="history-evidence-heading">
      <h2 id="history-evidence-heading" className="font-semibold">{t("Evidence & reviews", "الإثباتات والتقييمات")}</h2>
      {evidence.length ? <ul className="mt-3 space-y-2">{evidence.map((file) => <li key={file.id} className="text-sm">
        <p className="text-[#9CA3AF]">{file.side === "buyer" ? t("Buyer evidence", "إثبات المشتري") : t("Seller evidence", "إثبات البائع")} · {date(file.uploadedAt)}{file.status === "replaced" ? ` · ${t("Replaced", "تم الاستبدال")}` : ""}</p>
        <a href={`/api/alpha-exchange/purchase-requests/${encodeURIComponent(request.id)}/evidence/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center break-all text-[#FDE68A] underline underline-offset-4">{currencyText(file.fileName)}</a>
      </li>)}</ul> : <p className="mt-3 text-sm text-[#9CA3AF]">{t("No payment evidence is attached to this trade.", "لا توجد إثباتات دفع مرفقة بهذه الصفقة.")}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{reviews.map(({ label, review }) => <div key={label} className="rounded-xl border border-white/10 p-3 text-sm">
        <h3 className="font-medium">{label}</h3>
        {review ? <><p className="mt-2 text-[#FDE68A]">{review.rating}/5{review.hidden ? ` · ${t("Hidden", "مخفي")}` : ""}</p><p dir="auto" className="mt-2 whitespace-pre-wrap break-words">{currencyText(review.comment)}</p><time dateTime={review.createdAt} className="mt-2 block text-xs text-[#9CA3AF]">{date(review.createdAt)}</time></> : <p className="mt-2 text-[#9CA3AF]">{t("No review submitted.", "لم يتم إرسال تقييم.")}</p>}
      </div>)}</div>
      {request.sellerResponse ? <div className="mt-3 rounded-xl border border-white/10 p-3 text-sm"><h3 className="font-medium">{t("Seller response", "رد البائع")}</h3><p dir="auto" className="mt-2 whitespace-pre-wrap break-words">{currencyText(request.sellerResponse.message)}</p><time dateTime={request.sellerResponse.createdAt} className="mt-2 block text-xs text-[#9CA3AF]">{date(request.sellerResponse.createdAt)}</time></div> : null}
    </section>
    {disputes.length || auditLogs.length ? <section id="history-audit" className={panelClass} aria-labelledby="history-audit-heading">
      <h2 id="history-audit-heading" className="font-semibold">{t("Disputes & audit history", "النزاعات وسجل الإجراءات")}</h2>
      {disputes.map((dispute) => <div key={dispute.id} className="mt-3 rounded-xl border border-amber-400/20 p-3 text-sm">
        <p className="font-medium text-amber-200">{dispute.status === "resolved" ? t("Resolved dispute", "نزاع تم حله") : t("Open dispute", "نزاع مفتوح")}</p>
        <p dir="auto" className="mt-2 whitespace-pre-wrap break-words">{currencyText(dispute.reason)}</p>
        <time dateTime={dispute.createdAt} className="mt-2 block text-xs text-[#9CA3AF]">{date(dispute.createdAt)}</time>
        {dispute.resolutionNotes ? <p dir="auto" className="mt-2 whitespace-pre-wrap break-words">{t("Resolution", "القرار")}: {currencyText(dispute.resolutionNotes)}</p> : null}
        {dispute.resolvedAt ? <p className="mt-2 text-xs text-[#9CA3AF]">{t("Resolved", "تاريخ الحل")}: {date(dispute.resolvedAt)}</p> : null}
      </div>)}
      {auditLogs.length ? <ol className="mt-4 space-y-3">{auditLogs.map((entry) => <li key={entry.id} className="rounded-xl border border-white/10 p-3 text-sm">
        <p dir="auto" className="whitespace-pre-wrap break-words">{currencyText(localizeTradeRoomSystemMessage(entry.details || entry.action.replaceAll("_", " "), locale).text)}</p>
        {entry.reason ? <p dir="auto" className="mt-2 whitespace-pre-wrap break-words">{currencyText(entry.reason)}</p> : null}
        <time dateTime={entry.createdAt} className="mt-2 block text-xs text-[#9CA3AF]">{date(entry.createdAt)}</time>
      </li>)}</ol> : null}
    </section> : null}
    {onUpdated ? <TradeOwnerActions key={request.id} locale={locale} request={request} isOwner openDispute={disputes.find((dispute) => dispute.status === "open")} onUpdated={onUpdated} /> : null}
  </>;
}
