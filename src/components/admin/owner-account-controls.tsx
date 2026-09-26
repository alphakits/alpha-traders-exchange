"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { beginOwnerPendingOperation, finishOwnerPendingOperation, readOwnerPendingOperations } from "@/lib/owner-pending-operation";
import { Button } from "@/components/ui/button";
import {
  availableOwnerAccountCommands, executeOwnerAccountCommand, isProtectedOwnerTarget,
  OWNER_EDITABLE_ROLES, requiresSellerControls, matchesOwnerAccountCommandState,
  type OwnerAccountCommand, type OwnerAccountTarget, type OwnerEditableRole,
} from "@/lib/owner-account-command";

const LABELS: Record<OwnerAccountCommand, { en: string; ar: string }> = {
  change_role: { en: "Change account role", ar: "تغيير دور الحساب" },
  disable: { en: "Disable account", ar: "تعطيل الحساب" },
  enable: { en: "Enable account", ar: "تفعيل الحساب" },
  suspend: { en: "Suspend seller access", ar: "إيقاف صلاحية البائع" },
  reactivate: { en: "Reactivate seller access", ar: "إعادة تفعيل صلاحية البائع" },
  revoke_seller: { en: "Permanently revoke seller access", ar: "إلغاء صلاحية البائع نهائيًا" },
};

type Props = {
  locale: "en" | "ar";
  target: OwnerAccountTarget;
  /** UI gate only. Existing server-side owner/API authorization remains mandatory. */
  isOwner: boolean;
  /** Fetch and return this canonical account without replaying a mutation. Null means unavailable. */
  onRefresh: () => Promise<OwnerAccountTarget | null>;
  /** Mount the sole dashboard-level dialog immediately, independently of filtered table rows. */
  initiallyOpen?: boolean;
  /** Called only when no request or unresolved readback remains. */
  onDismiss?: () => void;
};

/** Owner-only UI; the parent must pass data from the existing private owner endpoint. */
export function OwnerAccountControls({ locale, target, isOwner, onRefresh, initiallyOpen = false, onDismiss }: Props) {
  const isAr = locale === "ar";
  const text = (en: string, ar: string) => isAr ? ar : en;
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const pendingVerification = useRef<{ id: string; command: OwnerAccountCommand; role: OwnerEditableRole } | null>(null);
  const mounted = useRef(true);
  const operationId = useRef<string | null>(null);
  const [open, setOpen] = useState(initiallyOpen);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<OwnerAccountCommand>(() => availableOwnerAccountCommands(target)[0] ?? "disable");
  const [role, setRole] = useState<OwnerEditableRole>("buyer");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<"saved" | "rejected" | "unknown" | null>(null);
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const commands = availableOwnerAccountCommands(target);

  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current;
    return () => { mounted.current = false; dialog?.close?.(); };
  }, []);
  useEffect(() => {
    if (!isOwner) return;
    try {
      const saved = readOwnerPendingOperations().find(row => row.targetId === target.id);
      if (!saved) return;
      if (saved.command === "dashboard_action") return;
      if (saved.command === "rank") {
        setRequiresRefresh(true);
        setMessage(text("Resolve the pending rank action in the dashboard first.", "تحقق من إجراء الرتبة المعلق في اللوحة أولًا."));
        return;
      }
      const savedRole = OWNER_EDITABLE_ROLES.includes(saved.value as OwnerEditableRole) ? saved.value as OwnerEditableRole : "buyer";
      operationId.current = saved.id;
      pendingVerification.current = { id: saved.targetId, command: saved.command, role: savedRole };
      setCommand(saved.command); setRole(savedRole); setRequiresRefresh(true); setResult("unknown");
      setMessage(text("A previous action still needs verification. Refresh the account; no command will be repeated.", "إجراء سابق يحتاج إلى التحقق. حدّث الحساب؛ لن يتم تكرار أي أمر."));
    } catch {
      setRequiresRefresh(true);
      setMessage(text("Action recovery is unavailable. No new command was sent.", "تعذر استعادة حالة الإجراء. لم يتم إرسال أمر جديد."));
    }
    // Recover once for the selected account; live readback owns subsequent state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, isOwner]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      try { if (!dialog.open) dialog.showModal(); }
      catch {
        setOpen(false);
        setMessage(isAr ? "تعذر فتح نافذة الإجراء. لم يتم إرسال أي تغيير." : "The action dialog could not open. No change was submitted.");
      }
    } else if (dialog.open) dialog.close();
  }, [open, isAr]);

  function close() {
    if (submitting.current) return;
    setOpen(false);
    triggerRef.current?.focus();
    // Unknown/saved-but-unreconciled commands must survive closing the dialog.
    // The root host is not discarded until a canonical readback confirms the result.
    if (!pendingVerification.current) onDismiss?.();
  }
  async function refresh(): Promise<boolean> {
    try {
      const fresh = await onRefresh();
      const expected = pendingVerification.current;
      if (!fresh || fresh.id !== (expected?.id ?? target.id)) return false;
      if (expected && !matchesOwnerAccountCommandState(fresh, expected.command, expected.role)) return false;
      if (operationId.current) finishOwnerPendingOperation(operationId.current, "clear");
      operationId.current = null;
      pendingVerification.current = null;
      return true;
    } catch { return false; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isOwner || submitting.current || requiresRefresh || result === "saved" || result === "unknown") return;
    if (!reason.trim() || (command === "revoke_seller" && !acknowledged)) {
      setMessage(text("Enter a reason and confirm the selected action.", "أدخل السبب وأكّد الإجراء المختار."));
      return;
    }
    // Capture the target/action exactly once. Changing a selector cannot retarget an in-flight request.
    const selected = { target: { ...target, roles: [...(target.roles ?? [])] }, command, reason: reason.trim(), role };
    try {
      operationId.current = beginOwnerPendingOperation({ targetId: target.id, command, value: role }).id;
    } catch {
      setRequiresRefresh(true);
      setMessage(text("A previous action needs verification or recovery storage is unavailable. No new command was sent.", "يحتاج إجراء سابق إلى التحقق أو تعذر حفظ حالة الاستعادة. لم يتم إرسال أمر جديد."));
      return;
    }
    pendingVerification.current = { id: selected.target.id, command: selected.command, role: selected.role };
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const outcome = await executeOwnerAccountCommand(selected.target, selected.command, selected.reason, selected.role);
      try { if (operationId.current) finishOwnerPendingOperation(operationId.current, outcome.outcome === "rejected" ? "clear" : outcome.outcome); }
      catch { /* Keep the durable pending marker; no retry is sent. */ }
      if (outcome.outcome === "rejected") { operationId.current = null; pendingVerification.current = null; }
      if (!mounted.current) return;
      setResult(outcome.outcome);
      if (outcome.outcome === "rejected") {
        const msg = outcome.code === "command_in_progress"
          ? text("Another change for this account is still pending. Wait for its result.", "يوجد تغيير آخر قيد التنفيذ لهذا الحساب. انتظر نتيجته.")
          : outcome.code === "sign_in_required"
            ? text("Your session expired. Sign in again before changing the account.", "انتهت الجلسة. سجّل الدخول مجددًا قبل تغيير الحساب.")
            : outcome.code === "owner_access_required"
              ? text("The server denied this action. An active owner session is required.", "رفض الخادم الإجراء. يلزم تسجيل دخول نشط للمالك.")
              : text("The server rejected this action for the current account state. Refresh and review the available seller/account controls; no success was confirmed.", "رفض الخادم هذا الإجراء لحالة الحساب الحالية. حدّث البيانات وراجع صلاحيات البائع والحساب؛ لم يتم تأكيد النجاح.");
        setMessage(msg);
        return;
      }
      pendingVerification.current = { id: selected.target.id, command: selected.command, role: selected.role };
      setRequiresRefresh(true);
      if (outcome.outcome === "unknown") {
        setMessage(text("The result could not be confirmed. The server may have saved it. Refresh the account before trying another action; this command was not automatically retried.", "تعذر تأكيد النتيجة وربما حُفظ التغيير. حدّث الحساب قبل أي إجراء آخر؛ لم تتم إعادة إرسال الأمر تلقائيًا."));
        return;
      }
      setMessage(text("The server confirmed the change. Refreshing account state…", "أكد الخادم حفظ التغيير. جارٍ تحديث حالة الحساب…"));
      const refreshed = await refresh();
      if (!mounted.current) return;
      setRequiresRefresh(!refreshed);
      setMessage(refreshed
        ? text("Change saved and verified against the refreshed account state.", "تم حفظ التغيير والتحقق منه في حالة الحساب المحدثة.")
        : text("The server confirmed the change, but its current account state could not be reconciled. Refresh the account view; do not repeat the saved command.", "تم حفظ التغيير لكن تعذر تحديث اللوحة. حدّث عرض الحساب ولا تكرر الأمر المحفوظ."));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function reconcile() {
    if (!isOwner || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const ok = await refresh();
      if (!mounted.current) return;
      setRequiresRefresh(!ok);
      if (ok) setResult("saved");
      setMessage(ok
        ? text("The refreshed account confirms the change. Review its current status before another action.", "تؤكد حالة الحساب المحدثة التغيير. راجعها قبل أي إجراء آخر.")
        : text("The account state is not yet confirmed. Do not repeat the command.", "لم يتم تأكيد حالة الحساب بعد. لا تكرر الأمر."));
      // In embedded/root mode, keep the result visible until the owner closes it.
      if (ok && !open) setOpen(true);
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  if (!isOwner) return null;
  if (isProtectedOwnerTarget(target)) return <span className="text-xs text-[#9CA3AF]">{text("Owner account protection", "حماية حساب المالك")}</span>;
  return <div className="space-y-2">
    <Button ref={triggerRef} type="button" size="sm" variant="secondary" disabled={busy || requiresRefresh || !commands.length} onClick={() => {
      pendingVerification.current = null; setCommand(commands[0]); setRole("buyer"); setReason(""); setAcknowledged(false); setMessage(""); setResult(null); setOpen(true);
    }}>{text("Manage account", "إدارة الحساب")}</Button>
    {!open && message ? <p role="status" className="max-w-sm whitespace-normal text-xs text-amber-200">{message}</p> : null}
    {!open && requiresRefresh ? <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3" role="status">
      <p className="mb-2 break-words text-sm"><bdi>{target.fullName}</bdi></p>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={reconcile}>{text("Refresh account", "تحديث الحساب")}</Button>
    </div> : null}
    <dialog ref={dialogRef} dir={isAr ? "rtl" : "ltr"} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-[#C9A227]/40 bg-[#101010] p-5 text-white backdrop:bg-black/80"
      onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClose={() => { if (!submitting.current) setOpen(false); }}>
      <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
        <h2 id={`${id}-title`} className="text-lg font-semibold">{text("Owner account action", "إجراء المالك على الحساب")}</h2>
        <p className="break-words font-medium"><bdi>{target.fullName}</bdi></p>
        <p id={`${id}-description`} className="text-sm text-[#D1D5DB]">{requiresSellerControls(target)
          ? text("Seller approval, rank, and account access are separate. Use seller controls to remove selling privileges; rank changes do not remove approval.", "اعتماد البائع ورتبته وتفعيل الحساب صلاحيات منفصلة. استخدم إجراءات البائع لإلغاء البيع؛ تغيير الرتبة لا يلغي الاعتماد.")
          : text("Choose an account action. Granting seller access still requires the existing seller-application approval process.", "اختر إجراء الحساب. منح صلاحية البائع يتطلب مسار الموافقة على طلب البائع الحالي.")}</p>
        <fieldset disabled={busy || result === "saved" || result === "unknown" || requiresRefresh} className="space-y-3">
          <label htmlFor={`${id}-action`} className="block text-sm">{text("Action", "الإجراء")}</label>
          <select id={`${id}-action`} className="h-12 w-full rounded-xl border border-white/20 bg-black px-3" value={command} onChange={event => { setCommand(event.target.value as OwnerAccountCommand); setResult(null); setMessage(""); setAcknowledged(false); }}>
            {commands.map(value => <option value={value} key={value}>{LABELS[value][locale]}</option>)}
          </select>
          {command === "change_role" ? <><label htmlFor={`${id}-role`} className="block text-sm">{text("New role", "الدور الجديد")}</label><select id={`${id}-role`} value={role} onChange={event => setRole(event.target.value as OwnerEditableRole)} className="h-12 w-full rounded-xl border border-white/20 bg-black px-3">{OWNER_EDITABLE_ROLES.map(value => <option key={value} value={value}>{value}</option>)}</select></> : null}
          <label htmlFor={`${id}-reason`} className="block text-sm">{text("Reason (required for the audit record)", "السبب (مطلوب لسجل التدقيق)")}</label>
          <textarea id={`${id}-reason`} required value={reason} onChange={event => setReason(event.target.value)} rows={3} className="w-full rounded-xl border border-white/20 bg-black p-3" />
          {command === "disable" ? <p className="text-sm text-amber-200">{text("Disabling blocks account access, not only selling. Review unresolved trades before continuing.", "التعطيل يمنع الدخول للحساب وليس البيع فقط. راجع الصفقات غير المحسومة قبل المتابعة.")}</p> : null}
          {command === "revoke_seller" ? <label className="flex items-start gap-3 rounded-xl border border-red-500/30 p-3 text-sm text-red-200"><input type="checkbox" required checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1" /><span>{text("I confirm permanent seller revocation through the compliance workflow. Open listings may close; trade and commission history must remain recorded.", "أؤكد إلغاء صلاحية البائع نهائيًا عبر مسار الامتثال. قد تُغلق العروض المفتوحة ويجب الحفاظ على سجل الصفقات والعمولات.")}</span></label> : null}
        </fieldset>
        {message ? <p role={result === "saved" ? "status" : "alert"} aria-live="polite" className="rounded-xl border border-white/20 p-3 text-sm">{message}</p> : null}
        <div className="flex flex-wrap gap-2">
          {requiresRefresh ? <Button type="button" variant="secondary" disabled={busy} onClick={reconcile}>{text("Refresh account", "تحديث الحساب")}</Button> : null}
          <Button type="submit" disabled={busy || requiresRefresh || result === "saved" || result === "unknown"}>{busy ? text("Saving…", "جارٍ الحفظ…") : text("Confirm action", "تأكيد الإجراء")}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>{text("Close", "إغلاق")}</Button>
        </div>
      </form>
    </dialog>
  </div>;
}
