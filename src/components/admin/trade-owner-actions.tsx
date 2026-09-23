"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { adminTradeActions } from "@/lib/admin-trade-actions";
import type { PurchaseRequest, TradeDisputeCase } from "@/types/alpha-exchange";

type Action = "force-complete" | "force-close" | "unlock-review" | "resolve-dispute";
type Props = {
  locale: "en" | "ar";
  request: PurchaseRequest;
  isOwner: boolean;
  openDispute?: TradeDisputeCase | null;
  onUpdated: () => Promise<void> | void;
};

export function TradeOwnerActions({ locale, request, isOwner, openDispute, onUpdated }: Props) {
  const t = (en: string, ar: string) => locale === "ar" ? ar : en;
  const formId = useId();
  const busyRef = useRef(false);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const controls = adminTradeActions(request, Boolean(openDispute), isOwner);
  const labels: Record<Action, string> = {
    "force-complete": t("Mark as completed", "تحديد الصفقة كمكتملة"),
    "force-close": t("Force close trade", "إغلاق الصفقة إجباريًا"),
    "unlock-review": t("Unlock Review", "فتح التقييم"),
    "resolve-dispute": t("Resolve Dispute", "حل النزاع"),
  };

  function select(nextAction: Action) {
    setAction(nextAction); setReason(""); setError(""); setSuccess("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || !reason.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      const endpoint = action === "resolve-dispute"
        ? `/api/alpha-exchange/admin/disputes/${encodeURIComponent(openDispute!.id)}/resolve`
        : `/api/alpha-exchange/admin/purchase-requests/${encodeURIComponent(request.id)}/${action === "force-close" && !isOwner ? "force-cancel" : action}`;
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "resolve-dispute" ? { resolutionNotes: reason.trim() } : { reason: reason.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Action failed. Refresh the trade and try again.");
      setSuccess(t("Action saved. The trade history has been updated.", "تم حفظ الإجراء وتحديث سجل الصفقة."));
      setAction(null); setReason("");
      await onUpdated();
    } catch (cause) {
      setError(locale === "ar" ? "تعذر تنفيذ الإجراء. حدّث الصفقة وتحقق من حالتها واتصالك ثم أعد المحاولة." : cause instanceof Error ? cause.message : "Could not save the action. Please try again.");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  return <section id="owner-trade-actions" aria-labelledby={`${formId}-heading`} className="mt-4 scroll-mt-28 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
    <h2 id={`${formId}-heading`} className="text-sm font-semibold text-amber-300">{isOwner ? t("Owner Actions", "إجراءات المالك") : t("Admin Actions", "إجراءات الإدارة")}</h2>
    <p className="mt-2 text-xs text-[#D1D5DB]">{t("Every manual action requires a reason and is saved in the audit history.", "كل إجراء يدوي يتطلب سببًا ويتم حفظه في سجل الإجراءات.")}</p>
    {openDispute ? <div className="mt-3 rounded-xl border border-red-400/30 p-3 text-sm">
      <p className="text-red-200">{t("Resolve the open dispute before changing this trade.", "حل النزاع المفتوح قبل تغيير هذه الصفقة.")}</p>
      <p dir="auto" className="mt-2 break-words text-[#D1D5DB]">{openDispute.reason}</p>
      <Button type="button" variant="secondary" disabled={busy} className="mt-3" onClick={() => select("resolve-dispute")}>{labels["resolve-dispute"]}</Button>
    </div> : null}
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <Button type="button" disabled={busy || !controls.canComplete} onClick={() => select("force-complete")} className="min-h-11 whitespace-normal border-[#C9A227]/40 bg-[#C9A227]/20 text-[#F4D87A]">{labels["force-complete"]}</Button>
      <Button type="button" variant="secondary" disabled={busy || !controls.canClose} onClick={() => select("force-close")} className="min-h-11 whitespace-normal border-red-400/35 text-red-200">{labels["force-close"]}</Button>
      <Button type="button" variant="secondary" disabled={busy || !controls.canUnlockReview} onClick={() => select("unlock-review")} className="min-h-11 whitespace-normal">{labels["unlock-review"]}</Button>
    </div>
    <p className="mt-3 text-xs text-[#D1D5DB]">{controls.completed
      ? t("Already completed. Closing preserves the chat, reviews, commission and completed amounts.", "الصفقة مكتملة بالفعل. الإغلاق يحفظ المحادثة والتقييمات والعمولة والمبالغ المكتملة.")
      : controls.cancelled || request.closedAt
        ? t("This trade is already closed. Its full history remains available.", "هذه الصفقة مغلقة بالفعل. يبقى سجلها الكامل متاحًا.")
        : request.status === "pending"
          ? t("A pending request can be closed. Completion becomes available after acceptance.", "يمكن إغلاق الطلب المعلق. يصبح الإكمال متاحًا بعد قبول الطلب.")
          : request.termsProposal?.status === "pending"
            ? t("The pending amount or price proposal must be resolved before marking this trade completed.", "يجب حسم اقتراح المبلغ أو السعر المعلق قبل إكمال هذه الصفقة.")
          : !controls.canClose && !openDispute
            ? t("Payment or transfer progress is recorded. Verify delivery and mark completed, or resolve the trade through its dispute review.", "تم تسجيل تقدم في الدفع أو التحويل. تحقق من التسليم وأكمل الصفقة أو عالجها عبر مراجعة النزاع.")
            : t("Mark completed only after verifying the exchange. Force close cancels a trade before payment begins.", "أكمل الصفقة بعد التحقق من التبادل. الإغلاق الإجباري يلغي الصفقة قبل بدء الدفع.")}</p>
    {request.closedAt ? <p className="mt-2 text-xs text-amber-200">{t("Trade closed by owner/admin. History retained.", "أغلقت الصفقة بواسطة المالك أو الإدارة. تم الاحتفاظ بالسجل.")}</p> : null}
    {action ? <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-xl border border-white/15 bg-black/30 p-3">
      <h3 className="text-sm font-semibold">{labels[action]}</h3>
      {action === "force-complete" ? <p className="text-xs text-[#D1D5DB]">{t("Confirm payment and USDT delivery. This runs the normal completion, commission and review process.", "تحقق من الدفع وتسليم USDT. سيُنفّذ مسار الإكمال والعمولة والتقييم المعتاد.")}</p> : null}
      <label className="block text-sm" htmlFor={`${formId}-reason`}>{action === "resolve-dispute" ? t("Resolution notes", "ملاحظات حل النزاع") : t("Reason", "السبب")}</label>
      <textarea id={`${formId}-reason`} autoFocus required maxLength={1000} rows={3} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-xl border border-white/20 bg-black/40 p-3 text-base text-white" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !reason.trim()}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Confirm action", "تأكيد الإجراء")}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => setAction(null)}>{t("Back", "رجوع")}</Button>
      </div>
    </form> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-red-200">{error}</p> : null}
    {success ? <p role="status" className="mt-3 text-sm text-emerald-200">{success}</p> : null}
  </section>;
}
