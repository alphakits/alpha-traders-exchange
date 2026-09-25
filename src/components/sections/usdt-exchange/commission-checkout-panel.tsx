"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getClientCommissionWalletForNetwork } from "@/lib/commission-config";
import type { CommissionCheckout } from "@/lib/commission-checkout-workflow";
interface CheckoutState {
  status: "ready" | "waiting" | "paid" | "changed";
  checkout: CommissionCheckout | null;
  walletAddress: string | null;
  pendingCount: number;
  totalDueUsdt: number;
}
const ENDPOINT = "/api/alpha-exchange/commissions/checkout";
function valid(value: unknown): value is CheckoutState {
  if (!value || typeof value !== "object") return false;
  const state = value as CheckoutState;
  return ["ready", "waiting", "paid", "changed"].includes(state.status) && Number.isSafeInteger(state.pendingCount) && state.pendingCount >= 0
    && Number.isFinite(state.totalDueUsdt) && state.totalDueUsdt >= 0
    && (!state.checkout || (Number.isSafeInteger(state.checkout.expectedMicros) && state.checkout.expectedMicros > 0
      && Number.isSafeInteger(state.checkout.dueMicros) && state.checkout.dueMicros > 0
      && typeof state.walletAddress === "string" && ["TRC20", "BEP20"].includes(state.checkout.network)
      && state.walletAddress === getClientCommissionWalletForNetwork(state.checkout.network)));
}
export function CommissionCheckoutPanel({ isAr }: { isAr: boolean }) {
  const [data, setData] = useState<CheckoutState | null>(null);
  const [network, setNetwork] = useState<"TRC20" | "BEP20">("TRC20");
  const [amount, setAmount] = useState("");
  const [notSent, setNotSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [copied, setCopied] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const message = (en: string, ar: string) => isAr ? ar : en;
  const refresh = useCallback(async () => {
    if (!mounted.current || controller.current || !authorized) return;
    const current = new AbortController(); controller.current = current;
    const timer = setTimeout(() => current.abort(), 12_000);
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", credentials: "same-origin", signal: current.signal });
      if (response.status === 401 || response.status === 403) {
        if (mounted.current && controller.current === current) { setAuthorized(false); setData(null); setError(isAr ? "سجّل الدخول بحساب البائع." : "Sign in with your seller account."); }
        return;
      }
      const value: unknown = await response.json();
      if (!response.ok || !valid(value)) throw new Error("unavailable");
      if (mounted.current && controller.current === current) { setData(value); setError(""); setAmount((previous) => previous || value.totalDueUsdt.toFixed(2)); }
    } catch {
      if (mounted.current && controller.current === current) { setData(null); setError(isAr ? "تعذر تحديث حالة الدفع. لا ترسل دفعة أخرى؛ أعد المحاولة." : "Payment status is unavailable. Do not send another payment; retry the status check."); }
    } finally { clearTimeout(timer); if (controller.current === current) controller.current = null; }
  }, [authorized, isAr]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const poll = () => { if (!document.hidden) void refresh(); };
    const timer = setInterval(poll, 30_000);
    window.addEventListener("focus", poll); document.addEventListener("visibilitychange", poll);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener("focus", poll); document.removeEventListener("visibilitychange", poll); controller.current?.abort(); };
  }, [refresh]);
  async function create() {
    if (busy || !data || !notSent || !authorized || data.checkout) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(ENDPOINT, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, desiredAmount: amount, hasNotPaidYet: true }), signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!mounted.current) return;
      if (response.status === 401 || response.status === 403) { setAuthorized(false); setData(null); }
      if (!response.ok) {
        if (result.error === "outside_tolerance") throw new Error(isAr ? "المبلغ يجب أن يكون ضمن فرق 1 USDT من مجموع العمولات." : "The amount must be within 1 USDT of the commission total.");
        throw new Error(isAr ? "تعذر إنشاء تعليمات الدفع. حدّث الحالة قبل أي تحويل جديد." : "Payment instructions could not be created. Refresh the status before making any transfer.");
      }
      controller.current?.abort(); controller.current = null;
      await refresh();
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Payment unavailable"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); }
    catch { setCopied(""); setError(message("Copy unavailable. Select and copy the complete value manually.", "تعذر النسخ. حدّد القيمة كاملة وانسخها.")); }
  }
  const checkout = data?.checkout;
  const formatted = checkout ? (checkout.expectedMicros / 1e6).toFixed(6) : "";
  const controls = "w-full rounded-xl border border-white/20 bg-slate-950 px-4 py-3 text-white";
  return <main dir={isAr ? "rtl" : "ltr"} className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-white">
    <Link className="text-sm text-amber-300" href={`/${isAr ? "ar" : "en"}/usdt-exchange`}>{message("Back to marketplace", "العودة للسوق")}</Link>
    <h1 className="text-2xl font-bold">{message("Automatic commission checkout", "دفع العمولات تلقائيًا")}</h1>
    <p className="text-sm leading-6 text-slate-300">{message("Prepare your payment before sending. Send the amount shown once; the system verifies and settles it without owner approval.", "أنشئ تعليمات الدفع قبل التحويل. أرسل المبلغ الظاهر مرة واحدة؛ يتحقق النظام ويسوّي العمولة دون موافقة المالك.")}</p>
    {error ? <p role="alert" className="rounded-xl border border-amber-400/40 p-4 text-sm text-amber-200">{error}</p> : null}
    <button type="button" className="rounded-lg border border-white/20 px-4 py-2 text-sm" onClick={() => void refresh()} disabled={!authorized || busy}>{message("Refresh payment status", "تحديث حالة الدفع")}</button>
    {!data && !error ? <p role="status">{message("Loading your commissions…", "جارٍ تحميل العمولات…")}</p> : null}
    {data ? <section className="space-y-3 rounded-2xl border border-white/15 p-5">
      <p>{message("Outstanding commission total", "مجموع العمولات المستحقة")}: <strong>{data.totalDueUsdt.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT</strong></p>
      {data.status === "paid" && data.pendingCount === 0 ? <p role="status" className="text-emerald-300">{message("Payment verified. No commission dues remain. Other account restrictions still apply.", "تم التحقق من الدفع. لا توجد عمولات مستحقة. تبقى أي قيود أخرى على الحساب سارية.")}</p> : null}
      {data.status === "changed" ? <p role="alert" className="text-amber-200">{message("These commissions changed after the payment instructions were created. Do not send another payment. Check the original payment status.", "تغيّرت العمولات بعد إنشاء تعليمات الدفع. لا ترسل دفعة أخرى. راجع حالة الدفعة الأصلية.")}</p> : null}
      {!checkout && data.pendingCount > 0 ? <>
        <label className="block text-sm">{message("Network", "الشبكة")}<select className={controls} value={network} disabled={busy} onChange={(event) => setNetwork(event.target.value as "TRC20" | "BEP20")}><option value="TRC20">USDT · TRC20</option><option value="BEP20">USDT · BEP20</option></select></label>
        <label className="block text-sm">{message("Amount you plan to send (USDT)", "المبلغ الذي تنوي إرساله (USDT)")}<input className={controls} inputMode="decimal" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} /></label>
        <p className="text-xs leading-5 text-slate-300">{message("A difference of up to 1 USDT is allowed once for the combined payment. A small decimal reference may be added when an amount is already reserved. Copy the final amount displayed below, not an earlier amount.", "يسمح بفرق حتى 1 USDT مرة واحدة للدفعة المجمعة. قد تُضاف خانات عشرية صغيرة إذا كان المبلغ محجوزًا لدفعة أخرى. انسخ المبلغ النهائي الظاهر، وليس مبلغًا سابقًا.")}</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={notSent} disabled={busy} onChange={(event) => setNotSent(event.target.checked)} />{message("I have not sent this payment yet.", "لم أرسل هذه الدفعة بعد.")}</label>
        <button type="button" className="w-full rounded-xl bg-amber-400 px-5 py-3 font-semibold text-black disabled:opacity-40" disabled={busy || !notSent || !amount} onClick={() => void create()}>{busy ? message("Preparing…", "جارٍ الإنشاء…") : message("Prepare payment for all commissions", "إنشاء دفعة لجميع العمولات")}</button>
      </> : null}
    </section> : null}
    {checkout && data?.status === "waiting" ? <section className="space-y-4 rounded-2xl border border-emerald-400/40 p-5">
      <h2 className="font-semibold">{message("Send this amount once", "أرسل هذا المبلغ مرة واحدة")}</h2>
      <p className="text-2xl font-bold text-emerald-300" dir="ltr">{formatted} USDT</p>
      <button type="button" className="rounded-lg border border-white/20 px-4 py-2" onClick={() => void copy(formatted, "amount")}>{copied === "amount" ? message("Copied", "تم النسخ") : message("Copy exact amount", "نسخ المبلغ كاملًا")}</button>
      <p className="text-sm">{message("Network", "الشبكة")}: <strong>{checkout.network}</strong></p>
      <p className="break-all rounded-xl bg-black/30 p-3 font-mono text-sm" dir="ltr">{data.walletAddress}</p>
      <button type="button" className="rounded-lg border border-white/20 px-4 py-2" onClick={() => void copy(data.walletAddress ?? "", "wallet")}>{copied === "wallet" ? message("Copied", "تم النسخ") : message("Copy receiving address", "نسخ عنوان الاستلام")}</button>
      <p role="status" className="text-sm leading-6 text-slate-200">{message("Automatic checks run every minute. No screenshot, transaction-ID submission or owner approval is needed for a matching payment. Network confirmation can take longer. Do not resend while waiting.", "يتم الفحص التلقائي كل دقيقة. لا تحتاج الدفعة المطابقة إلى صورة أو إدخال معرّف معاملة أو موافقة المالك. قد يستغرق تأكيد الشبكة وقتًا أطول. لا تُعد الإرسال أثناء الانتظار.")}</p>
      <p className="text-xs leading-5 text-amber-200">{message("Use USDT on the selected network and ensure the net amount received equals the displayed amount. Do not round away a decimal reference or deduct a network fee from this amount.", "استخدم USDT على الشبكة المختارة، وتأكد أن صافي المبلغ المستلم يطابق المبلغ الظاهر. لا تحذف الخانات العشرية ولا تخصم رسوم الشبكة من هذا المبلغ.")}</p>
    </section> : null}
  </main>;
}
