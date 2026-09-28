"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { clearPendingTradeAction, executeTradeOwnerAction, isTradeActionInFlight, readPendingTradeAction, TRADE_ACTION_EVENT, type PendingTradeAction } from "@/lib/owner-trade-action";
import { readOwnerTradeHistory } from "@/lib/owner-trade-history-read";
import { adminTradeActions, isFinishedTrade } from "@/lib/admin-trade-actions";
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
  const mounted = useRef(true);
  const [pending, setPending] = useState<PendingTradeAction | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [auditChecked, setAuditChecked] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [fresh, setFresh] = useState<{ request: PurchaseRequest; hasOpenDispute: boolean; ownerHistory?: { disputes: TradeDisputeCase[] } } | null>(null);
  const current = fresh?.request.id === request.id ? fresh : null;
  const currentRequest = current?.request ?? request;
  const currentDispute = current?.ownerHistory ? current.ownerHistory.disputes.find(row => row.status === "open")
    : current?.hasOpenDispute === false ? null : openDispute;
  const controls = adminTradeActions(currentRequest, current?.hasOpenDispute ?? Boolean(currentDispute), isOwner);
  const locked = busy || Boolean(pending) || storageFailed || accessLost;
  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      try { setPending(readPendingTradeAction(request.id)); setStorageFailed(false); }
      catch { setStorageFailed(true); }
    };
    sync();
    window.addEventListener(TRADE_ACTION_EVENT, sync);
    return () => { mounted.current = false; window.removeEventListener(TRADE_ACTION_EVENT, sync); };
  }, [request.id]);
  useEffect(() => { setFresh(null); }, [request]);

  async function refreshCurrent() {
    const result = await readOwnerTradeHistory(request.id, new AbortController().signal, globalThis.fetch, 15_000, isOwner);
    if ([401, 403, 404].includes(result.status)) {
      if (mounted.current) { setAccessLost(true); setFresh(null); setAction(null); setReason(""); }
      throw new Error("Access unavailable");
    }
    const snapshot = result.payload as typeof fresh;
    if (!result.ok || snapshot?.request?.id !== request.id || typeof snapshot.request.status !== "string" || typeof snapshot.hasOpenDispute !== "boolean") throw new Error("Readback unavailable");
    const operation = readPendingTradeAction(request.id);
    if (operation?.outcome === "saved") {
      if (operation.action === "force-complete" && !isFinishedTrade(snapshot.request)) throw new Error("Completion not confirmed");
      if (operation.action === "force-close" && !snapshot.request.closedAt && !["cancelled", "declined"].includes(snapshot.request.status)) throw new Error("Closure not confirmed");
      if (operation.action === "resolve-dispute" && snapshot.hasOpenDispute) throw new Error("Resolution not confirmed");
    }
    if (mounted.current) setFresh(snapshot);
    return snapshot;
  }
  function refreshParent() {
    try {
      void Promise.resolve(onUpdated()).catch(() => {
        if (mounted.current) setError(t("Current state was read, but the surrounding page could not refresh. Check the history before another action.", "تمت قراءة الحالة الحالية لكن تعذر تحديث الصفحة. تحقق من السجل قبل أي إجراء آخر."));
      });
    } catch {
      if (mounted.current) setError(t("Current state was read, but the surrounding page could not refresh. Check the history before another action.", "تمت قراءة الحالة الحالية لكن تعذر تحديث الصفحة. تحقق من السجل قبل أي إجراء آخر."));
    }
  }
  async function recover() {
    if (busyRef.current || isTradeActionInFlight(request.id) || !pending || (pending.outcome !== "saved" && !auditChecked)) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await refreshCurrent();
      if (!mounted.current) return;
      clearPendingTradeAction(request.id, pending.id);
      setAction(null); setReason(""); setAuditChecked(false);
      setSuccess(t("Current trade state refreshed. No action was repeated.", "تم تحديث حالة الصفقة دون تكرار أي إجراء."));
      refreshParent();
    } catch {
      if (mounted.current) setError(t("Current state could not be verified. The action remains protected; do not repeat it.", "تعذر التحقق من الحالة الحالية. يبقى الإجراء محميًا؛ لا تكرره."));
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  const labels: Record<Action, string> = {
    "force-complete": t("Mark as completed", "تحديد الصفقة كمكتملة"),
    "force-close": t("Force close trade", "إغلاق الصفقة إجباريًا"),
    "unlock-review": t("Unlock Review", "فتح التقييم"),
    "resolve-dispute": t("Resolve Dispute", "حل النزاع"),
  };

  function select(nextAction: Action) {
    if (locked) return;
    setAction(nextAction); setReason(""); setError(""); setSuccess("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || !reason.trim() || busyRef.current || locked) return;
    busyRef.current = true; setBusy(true); setError(""); setSuccess(""); setAuditChecked(false);
    try {
      const result = await executeTradeOwnerAction({ tradeId: request.id, action, isOwner, disputeId: currentDispute?.id, reason });
      if (!mounted.current) return;
      if (result.outcome !== "saved") {
        setError(result.outcome === "rejected"
          ? t("Access or request limit prevented this action. Check your session before trying again.", "منعت الصلاحيات أو حدود الطلبات هذا الإجراء. تحقق من جلستك قبل المحاولة.")
          : t("The result is unconfirmed. Check the trade and audit history before unlocking actions. No action will be repeated automatically.", "نتيجة الإجراء غير مؤكدة. تحقق من الصفقة وسجل الإجراءات قبل فتح التحكم. لن يتم تكرار أي إجراء تلقائيًا."));
        return;
      }
      setAction(null); setReason("");
      setSuccess(t("Action saved. Verifying the current trade state…", "تم حفظ الإجراء. جارٍ التحقق من حالة الصفقة…"));
      const operation = readPendingTradeAction(request.id);
      try {
        await refreshCurrent();
        if (!mounted.current) return;
        if (operation) clearPendingTradeAction(request.id, operation.id);
        setSuccess(t("Action saved. Current trade state verified.", "تم حفظ الإجراء والتحقق من حالة الصفقة الحالية."));
        refreshParent();
      } catch {
        if (mounted.current) { setSuccess(t("Action saved.", "تم حفظ الإجراء.")); setError(t("Action saved, but current state could not be refreshed. Do not submit it again; use Verify current state.", "تم حفظ الإجراء لكن تعذر تحديث الحالة. لا ترسله مجددًا؛ استخدم التحقق من الحالة الحالية.")); }
      }
    } catch {
      if (mounted.current) setError(t("Action recovery is unavailable. Check the audit history before trying again.", "تعذر استعادة حالة الإجراء. تحقق من سجل الإجراءات قبل المحاولة مجددًا."));
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  if (accessLost) return <p role="alert" className="mt-4 rounded-xl border border-red-400/30 p-4 text-sm text-red-200">{t("Trade access is no longer available. Sign in with an authorized account to continue.", "لم تعد صلاحية الصفقة متاحة. سجل الدخول بحساب مخول للمتابعة.")}</p>;
  return <section id="owner-trade-actions" aria-labelledby={`${formId}-heading`} className="mt-4 scroll-mt-28 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
    <h2 id={`${formId}-heading`} className="text-sm font-semibold text-amber-300">{isOwner ? t("Owner Actions", "إجراءات المالك") : t("Admin Actions", "إجراءات الإدارة")}</h2>
    <p className="mt-2 text-xs text-[#D1D5DB]">{t("Every manual action requires a reason and is saved in the audit history.", "كل إجراء يدوي يتطلب سببًا ويتم حفظه في سجل الإجراءات.")}</p>
    {currentDispute ? <div className="mt-3 rounded-xl border border-red-400/30 p-3 text-sm">
      <p className="text-red-200">{t("Resolve the open dispute before changing this trade.", "حل النزاع المفتوح قبل تغيير هذه الصفقة.")}</p>
      <p dir="auto" className="mt-2 break-words text-[#D1D5DB]">{currentDispute.reason}</p>
      <Button type="button" variant="secondary" disabled={locked} className="mt-3" onClick={() => select("resolve-dispute")}>{labels["resolve-dispute"]}</Button>
    </div> : null}
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <Button type="button" disabled={locked || !controls.canComplete} onClick={() => select("force-complete")} className="min-h-11 whitespace-normal border-[#C9A227]/40 bg-[#C9A227]/20 text-[#F4D87A]">{labels["force-complete"]}</Button>
      <Button type="button" variant="secondary" disabled={locked || !controls.canClose} onClick={() => select("force-close")} className="min-h-11 whitespace-normal border-red-400/35 text-red-200">{labels["force-close"]}</Button>
      <Button type="button" variant="secondary" disabled={locked || !controls.canUnlockReview} onClick={() => select("unlock-review")} className="min-h-11 whitespace-normal">{labels["unlock-review"]}</Button>
    </div>
    <p className="mt-3 text-xs text-[#D1D5DB]">{controls.completed
      ? t("Already completed. Closing preserves the chat, reviews, commission and completed amounts.", "الصفقة مكتملة بالفعل. الإغلاق يحفظ المحادثة والتقييمات والعمولة والمبالغ المكتملة.")
      : controls.cancelled || currentRequest.closedAt
        ? t("This trade is already closed. Its full history remains available.", "هذه الصفقة مغلقة بالفعل. يبقى سجلها الكامل متاحًا.")
        : currentRequest.status === "pending"
          ? t("A pending request can be closed. Completion becomes available after acceptance.", "يمكن إغلاق الطلب المعلق. يصبح الإكمال متاحًا بعد قبول الطلب.")
          : currentRequest.termsProposal?.status === "pending"
            ? t("The pending amount or price proposal must be resolved before marking this trade completed.", "يجب حسم اقتراح المبلغ أو السعر المعلق قبل إكمال هذه الصفقة.")
          : !controls.canClose && !currentDispute
            ? t("Payment or transfer progress is recorded. Verify delivery and mark completed, or resolve the trade through its dispute review.", "تم تسجيل تقدم في الدفع أو التحويل. تحقق من التسليم وأكمل الصفقة أو عالجها عبر مراجعة النزاع.")
            : t("Mark completed only after verifying the exchange. Force close cancels a trade before payment begins.", "أكمل الصفقة بعد التحقق من التبادل. الإغلاق الإجباري يلغي الصفقة قبل بدء الدفع.")}</p>
    {currentRequest.closedAt ? <p className="mt-2 text-xs text-amber-200">{t("Trade closed by owner/admin. History retained.", "أغلقت الصفقة بواسطة المالك أو الإدارة. تم الاحتفاظ بالسجل.")}</p> : null}
    {action ? <form onSubmit={(event) => void submit(event)} className="mt-4 space-y-3 rounded-xl border border-white/15 bg-black/30 p-3">
      <h3 className="text-sm font-semibold">{labels[action]}</h3>
      {action === "force-complete" ? <p className="text-xs text-[#D1D5DB]">{t("Confirm payment and USDT delivery. This runs the normal completion, commission and review process.", "تحقق من الدفع وتسليم USDT. سيُنفّذ مسار الإكمال والعمولة والتقييم المعتاد.")}</p> : null}
      <label className="block text-sm" htmlFor={`${formId}-reason`}>{action === "resolve-dispute" ? t("Resolution notes", "ملاحظات حل النزاع") : t("Reason", "السبب")}</label>
      <textarea id={`${formId}-reason`} autoFocus required maxLength={1000} rows={3} disabled={locked} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-xl border border-white/20 bg-black/40 p-3 text-base text-white" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={locked || !reason.trim()}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Confirm action", "تأكيد الإجراء")}</Button>
        <Button type="button" variant="secondary" disabled={locked} onClick={() => setAction(null)}>{t("Back", "رجوع")}</Button>
      </div>
    </form> : null}
    {storageFailed ? <p role="alert" className="mt-3 text-sm text-red-200">{t("Action recovery storage is unavailable. No new action can be sent.", "تعذر حفظ حالة الاستعادة. لا يمكن إرسال إجراء جديد.")}</p> : null}
    {pending ? <div className="mt-3 space-y-3 rounded-xl border border-amber-300/40 p-3 text-sm">
      <p>{pending.outcome === "saved" ? t("The previous action was saved. Verify current state before further actions.", "تم حفظ الإجراء السابق. تحقق من الحالة الحالية قبل أي إجراء آخر.") : t("A previous action has no confirmed result. Check the trade and audit history before unlocking controls.", "نتيجة الإجراء السابق غير مؤكدة. تحقق من الصفقة وسجل الإجراءات قبل فتح التحكم.")}</p>
      {pending.outcome !== "saved" ? <label className="flex items-start gap-2"><input type="checkbox" checked={auditChecked} disabled={busy || isTradeActionInFlight(request.id)} onChange={event => setAuditChecked(event.target.checked)} />{t("I checked the trade and audit history for the previous action.", "راجعت الصفقة وسجل الإجراءات للتحقق من الإجراء السابق.")}</label> : null}
      <Button type="button" variant="secondary" disabled={busy || accessLost || isTradeActionInFlight(request.id) || (pending.outcome !== "saved" && !auditChecked)} onClick={() => void recover()}>{t("Verify current state", "تحقق من الحالة الحالية")}</Button>
    </div> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-red-200">{error}</p> : null}
    {success ? <p role="status" className="mt-3 text-sm text-emerald-200">{success}</p> : null}
  </section>;
}
