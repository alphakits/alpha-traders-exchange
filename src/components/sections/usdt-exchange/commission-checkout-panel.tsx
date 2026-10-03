"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { runClientRequest } from "@/lib/client-request-deadline";
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as CheckoutState;
  if (!["ready", "waiting", "paid", "changed"].includes(state.status)
    || !Number.isSafeInteger(state.pendingCount) || state.pendingCount < 0
    || !Number.isFinite(state.totalDueUsdt) || state.totalDueUsdt < 0
    || (state.pendingCount === 0) !== (state.totalDueUsdt === 0)) return false;
  if (state.status === "paid" && state.pendingCount !== 0) return false;
  if (state.status === "ready" || state.status === "paid") return state.checkout === null && state.walletAddress === null;
  const checkout = state.checkout;
  return Boolean(checkout && typeof checkout === "object" && !Array.isArray(checkout)
    && typeof checkout.id === "string" && checkout.id && typeof checkout.sellerId === "string" && checkout.sellerId
    && Number.isSafeInteger(checkout.expectedMicros) && checkout.expectedMicros > 0
    && Number.isSafeInteger(checkout.dueMicros) && checkout.dueMicros > 0
    && Math.abs(checkout.expectedMicros - checkout.dueMicros) <= 1_000_000
    && (checkout.roundedMicros === undefined || (Number.isSafeInteger(checkout.roundedMicros)
      && checkout.roundedMicros === Math.ceil(checkout.expectedMicros / 1e6) * 1e6
      && checkout.roundedMicros > checkout.expectedMicros && checkout.roundedMicros >= checkout.dueMicros
      && checkout.roundedMicros - checkout.dueMicros <= 1_000_000))
    && (state.status !== "waiting" || state.pendingCount > 0)
    && ["TRC20", "BEP20"].includes(checkout.network)
    && state.walletAddress === getClientCommissionWalletForNetwork(checkout.network));
}
type PanelProps = { isAr: boolean; embedded?: boolean; onSettled?: () => void };
export function CommissionCheckoutPanel(props: PanelProps) {
  const session = useOptionalCanonicalSession();
  // Account changes must discard the previous seller's amounts and requests.
  return <CheckoutContent key={session ? session.user?.id ?? "signed-out" : "server-authorized"}
    {...props} sessionAvailable={!session || Boolean(session.user)} />;
}
function CheckoutContent({ isAr, embedded = false, onSettled, sessionAvailable }: PanelProps & { sessionAvailable: boolean }) {
  const [data, setData] = useState<CheckoutState | null>(null);
  const [network, setNetwork] = useState<"TRC20" | "BEP20">("TRC20");
  const [amount, setAmount] = useState("");
  const [notSent, setNotSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(sessionAvailable);
  const [copied, setCopied] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const authorizedRef = useRef(sessionAvailable);
  const mounted = useRef(true);
  const settledNotified = useRef(false);
  const settledCallback = useRef(onSettled);
  useEffect(() => { settledCallback.current = onSettled; }, [onSettled]);
  useEffect(() => {
    if (data?.status === "paid" && data.pendingCount === 0 && !settledNotified.current) {
      settledNotified.current = true;
      settledCallback.current?.();
    } else if (data && data.pendingCount > 0) settledNotified.current = false;
  }, [data]);
  const message = (en: string, ar: string) => isAr ? ar : en;
  const cancelRead = useCallback(() => {
    const current = controller.current;
    controller.current = null;
    current?.abort();
  }, []);
  const deny = useCallback(() => {
    authorizedRef.current = false;
    cancelRead();
    const current = mutation.current;
    mutation.current = null;
    current?.abort();
    setAuthorized(false); setData(null); setAmount(""); setNotSent(false); setCopied(""); setBusy(false);
    setError(isAr ? "سجّل الدخول بحساب البائع." : "Sign in with your seller account.");
  }, [cancelRead, isAr]);
  const refresh = useCallback(async () => {
    if (!mounted.current || controller.current || mutation.current || !authorizedRef.current
      || document.hidden || navigator.onLine === false) return;
    const current = new AbortController(); controller.current = current;
    try {
      const { response, value } = await runClientRequest(current, 12_000, async (signal) => {
        const response = await fetch(ENDPOINT, { cache: "no-store", credentials: "same-origin", signal });
        if (response.status === 401 || response.status === 403) return { response, value: null };
        return { response, value: await response.json() as unknown };
      });
      if (!mounted.current || controller.current !== current || current.signal.aborted || !authorizedRef.current) return;
      if (response.status === 401 || response.status === 403) {
        deny();
        return;
      }
      if (!response.ok || !valid(value)) throw new Error("unavailable");
      setData(value); setError(""); setAmount((previous) => previous || value.totalDueUsdt.toFixed(2));
    } catch {
      if (mounted.current && controller.current === current) { setData(null); setError(isAr ? "تعذر تحديث حالة الدفع. لا ترسل دفعة أخرى؛ أعد المحاولة." : "Payment status is unavailable. Do not send another payment; retry the status check."); }
    } finally { if (controller.current === current) controller.current = null; }
  }, [deny, isAr]);
  useEffect(() => {
    mounted.current = true; setBusy(false);
    if (!authorizedRef.current) deny();
    else void refresh();
    const poll = () => {
      if (document.hidden || navigator.onLine === false) cancelRead();
      else void refresh();
    };
    const timer = setInterval(poll, 30_000);
    window.addEventListener("focus", poll); document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll); window.addEventListener("offline", poll);
    window.addEventListener("alpha-auth-signed-out", deny);
    return () => {
      mounted.current = false; clearInterval(timer);
      window.removeEventListener("focus", poll); document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll); window.removeEventListener("offline", poll);
      window.removeEventListener("alpha-auth-signed-out", deny);
      cancelRead();
      const current = mutation.current; mutation.current = null; current?.abort();
    };
  }, [cancelRead, deny, refresh]);
  async function create() {
    if (mutation.current || !data || !notSent || !authorizedRef.current || data.checkout || navigator.onLine === false) return;
    cancelRead();
    const current = new AbortController(); mutation.current = current;
    setBusy(true); setError("");
    let reconcile = true;
    try {
      const { response, result } = await runClientRequest(current, 20_000, async (signal) => {
        const response = await fetch(ENDPOINT, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network, desiredAmount: amount, hasNotPaidYet: true }), signal });
        if (response.status === 401 || response.status === 403) return { response, result: null };
        return { response, result: await response.json() as unknown };
      });
      if (!mounted.current || mutation.current !== current || !authorizedRef.current) return;
      if (response.status === 401 || response.status === 403) { deny(); return; }
      if (!response.ok && result && typeof result === "object" && "error" in result && result.error === "outside_tolerance") {
        reconcile = false;
        setError(isAr ? "المبلغ يجب أن يكون ضمن فرق 1 USDT من مجموع العمولات." : "The amount must be within 1 USDT of the commission total.");
      }
    } catch {
      // A lost response can still mean the server issued the checkout. Read its
      // canonical state; never automatically repeat a financial mutation.
    } finally {
      if (mounted.current && mutation.current === current && authorizedRef.current) {
        mutation.current = null;
        if (reconcile) {
          setData(null); setNotSent(false); setCopied("");
          setError(isAr ? "جارٍ التحقق من حالة الدفع. لا ترسل دفعة أخرى." : "Checking the payment status. Do not send another payment.");
          await refresh();
        }
        if (mounted.current && authorizedRef.current) setBusy(false);
      }
    }
  }
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); }
    catch { setCopied(""); setError(message("Copy unavailable. Select and copy the complete value manually.", "تعذر النسخ. حدّد القيمة كاملة وانسخها.")); }
  }
  const checkout = data?.checkout;
  const formatted = checkout ? (checkout.expectedMicros / 1e6).toFixed(6) : "";
  const controls = "w-full rounded-xl border border-white/20 bg-slate-950 px-4 py-3 text-white";
  const Container = embedded ? "section" : "main";
  return <Container dir={isAr ? "rtl" : "ltr"} className="mx-auto max-w-2xl space-y-5 px-4 py-8 text-white">
    {!embedded ? <Link className="text-sm text-amber-300" href={`/${isAr ? "ar" : "en"}/usdt-exchange`}>{message("Back to marketplace", "العودة للسوق")}</Link> : null}
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
      {checkout.roundedMicros ? <div className="space-y-2 rounded-xl border border-emerald-400/30 p-3">
        <p className="text-sm">{message("You may instead send this reserved rounded amount:", "يمكنك بدلًا من ذلك إرسال هذا المبلغ المقرب والمحجوز لك:")}</p>
        <p className="text-xl font-bold text-emerald-300" dir="ltr">{(checkout.roundedMicros / 1e6).toFixed(0)} USDT</p>
        <button type="button" className="rounded-lg border border-white/20 px-4 py-2" onClick={() => void copy((checkout.roundedMicros! / 1e6).toFixed(0), "rounded")}>{copied === "rounded" ? message("Copied", "تم النسخ") : message("Copy rounded amount", "نسخ المبلغ المقرب")}</button>
        <p className="text-sm text-slate-300">{message("Send only one of these amounts. Both are verified automatically; the excess is recorded with your payment.", "أرسل مبلغًا واحدًا فقط من هذين المبلغين. يتم تأكيد أي منهما تلقائيًا وتسجيل الزيادة مع دفعتك.")}</p>
      </div> : null}
      <p className="text-sm">{message("Network", "الشبكة")}: <strong>{checkout.network}</strong></p>
      <p className="break-all rounded-xl bg-black/30 p-3 font-mono text-sm" dir="ltr">{data.walletAddress}</p>
      <button type="button" className="rounded-lg border border-white/20 px-4 py-2" onClick={() => void copy(data.walletAddress ?? "", "wallet")}>{copied === "wallet" ? message("Copied", "تم النسخ") : message("Copy receiving address", "نسخ عنوان الاستلام")}</button>
      <p role="status" className="text-sm leading-6 text-slate-200">{message("Automatic checks run every minute. No screenshot, transaction-ID submission or owner approval is needed for a matching payment. Network confirmation can take longer. Do not resend while waiting.", "يتم الفحص التلقائي كل دقيقة. لا تحتاج الدفعة المطابقة إلى صورة أو إدخال معرّف معاملة أو موافقة المالك. قد يستغرق تأكيد الشبكة وقتًا أطول. لا تُعد الإرسال أثناء الانتظار.")}</p>
      <p className="text-xs leading-5 text-amber-200">{message("Use USDT on the selected network and send a displayed payment amount. Pay the network fee separately so the full amount arrives. If no rounded option is shown, copy the exact decimal reference.", "استخدم USDT على الشبكة المختارة وأرسل أحد مبالغ الدفع الظاهرة. ادفع رسوم الشبكة بشكل منفصل ليصل المبلغ كاملًا. إذا لم يظهر خيار مبلغ مقرب، انسخ المبلغ كاملًا بخاناته العشرية.")}</p>
    </section> : null}
  </Container>;
}
