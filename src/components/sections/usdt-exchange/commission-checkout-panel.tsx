"use client";
import Link from "next/link";
import { HelpDetails } from "@/components/ui/help-details";
import { currencyText } from "@/components/ui/currency-text";
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
  checkedAt?: string;
  lastVerificationCheckAt?: string;
  verificationCode?: string;
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
  const Container = "section";
  return <Container dir={isAr ? "rtl" : "ltr"} className="commission-surface mx-auto max-w-2xl space-y-5 px-4 py-6 text-white">
    {!embedded ? <Link className="inline-flex min-h-11 items-center text-sm text-amber-300" href={`/${isAr ? "ar" : "en"}/usdt-exchange`}>{message("Back to marketplace", "العودة للسوق")}</Link> : null}
    <h1 className="commission-notice text-2xl font-bold">{message("Pay commission", "دفع العمولة")}</h1>
    {error ? <p role="alert" className="rounded-xl border border-amber-400/40 p-4 text-sm text-amber-200">{error}</p> : null}
    {!data && !error ? <p role="status" className="commission-notice">{message("Loading your commissions…", "جارٍ تحميل العمولات…")}</p> : null}
    {data ? <section className="space-y-4 rounded-2xl border border-white/15 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="commission-notice text-sm">{message("Amount due", "المبلغ المستحق")}</span>
        <strong className="currency-money text-2xl" dir="ltr">{data.totalDueUsdt.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT</strong>
      </div>
      {data.verificationCode ? <p role="status" className="commission-notice rounded-xl border border-amber-300/20 p-3 text-sm">{data.verificationCode === "receipt_pending" ? message("Payment found. Waiting for network confirmation. Do not send again.", "وُجدت الدفعة. ننتظر تأكيد الشبكة. لا تُعد الإرسال.") : data.verificationCode === "verification_unavailable" ? message("Verification is delayed. We will keep checking. Do not send again.", "تأخر التحقق. نواصل الفحص. لا تُعد الإرسال.") : message("Payment needs review. Check the original amount, network, and address. Do not pay again.", "تحتاج الدفعة للمراجعة. راجع المبلغ والشبكة والعنوان الأصلي. لا تدفع مجددًا.")}</p> : null}
      {data.status === "paid" && data.pendingCount === 0 ? <p role="status" className="commission-notice">{message("Paid. No commission due. Other account restrictions may still apply.", "تم الدفع. لا توجد عمولة مستحقة. قد تبقى قيود أخرى على الحساب.")}</p> : null}
      {data.status === "changed" ? <p role="alert" className="commission-notice">{message("The amount due changed. Check your original payment. Do not send again.", "تغيّر المبلغ المستحق. راجع دفعتك الأصلية. لا تُعد الإرسال.")}</p> : null}
      {!checkout && data.pendingCount > 0 ? <>
        <p className="text-sm text-slate-300">{message("Choose your network, then get payment instructions.", "اختر الشبكة، ثم اعرض تعليمات الدفع.")}</p>
        <label className="block text-sm">{message("Network", "الشبكة")}<select className={controls + " mt-2"} value={network} disabled={busy} onChange={(event) => setNetwork(event.target.value as "TRC20" | "BEP20")}><option value="TRC20">USDT · TRC20</option><option value="BEP20">USDT · BEP20</option></select></label>
        <label className="block text-sm">{message("Payment amount (USDT)", "مبلغ الدفع (USDT)")}<input className={controls + " currency-money mt-2"} inputMode="decimal" dir="ltr" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={notSent} disabled={busy} onChange={(event) => setNotSent(event.target.checked)} />{message("I have not sent this payment yet.", "لم أرسل هذه الدفعة بعد.")}</label>
        <button type="button" className="min-h-12 w-full rounded-xl bg-amber-400 px-5 py-3 font-semibold text-black disabled:opacity-40" disabled={busy || !notSent || !amount} onClick={() => void create()}>{busy ? message("Preparing…", "جارٍ الإنشاء…") : message("Get payment instructions", "عرض تعليمات الدفع")}</button>
      </> : null}
    </section> : null}
    {checkout && data?.status === "waiting" ? <section className="space-y-4 rounded-2xl border border-amber-300/30 p-5">
      <h2 className="font-semibold">{message("Send once", "أرسل مرة واحدة")}</h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="currency-money text-2xl font-bold" dir="ltr">{formatted} USDT</p>
        <button type="button" className="min-h-11 rounded-lg border border-white/20 px-4 py-2 text-sm" onClick={() => void copy(formatted, "amount")}>{copied === "amount" ? message("Copied", "تم النسخ") : message("Copy exact amount", "نسخ المبلغ كاملًا")}</button>
      </div>
      <p className="text-sm">{message("Network", "الشبكة")}: <strong>{checkout.network}</strong></p>
      <p className="break-all rounded-xl bg-black/30 p-3 font-mono text-sm" dir="ltr">{data.walletAddress}</p>
      <button type="button" className="min-h-11 w-full rounded-lg border border-white/20 px-4 py-2" onClick={() => void copy(data.walletAddress ?? "", "wallet")}>{copied === "wallet" ? message("Copied", "تم النسخ") : message("Copy receiving address", "نسخ عنوان الاستلام")}</button>
      <p className="commission-notice rounded-xl bg-amber-300/10 p-3 text-sm leading-6">{currencyText(message("Send USDT on this network. Pay network fees separately so the full amount arrives. Do not send again while waiting.", "أرسل USDT على هذه الشبكة. ادفع رسوم الشبكة منفصلة ليصل المبلغ كاملًا. لا تُعد الإرسال أثناء الانتظار."))}</p>
      <p role="status" className="text-sm leading-6 text-slate-200">{message("Waiting for payment confirmation. We check every minute; network confirmation may take longer.", "بانتظار تأكيد الدفع. نفحص كل دقيقة؛ وقد يستغرق تأكيد الشبكة وقتًا أطول.")}</p>
      {checkout.roundedMicros ? <HelpDetails title={message("Need a whole-number amount?", "تحتاج مبلغًا بدون كسور؟")}>
        <p>{message("You can send this reserved amount instead. Send only one payment.", "يمكنك إرسال هذا المبلغ المحجوز بدلًا منه. أرسل دفعة واحدة فقط.")}</p>
        <p className="currency-money text-xl font-bold" dir="ltr">{(checkout.roundedMicros / 1e6).toFixed(0)} USDT</p>
        <button type="button" className="min-h-11 rounded-lg border border-white/20 px-4 py-2" onClick={() => void copy((checkout.roundedMicros! / 1e6).toFixed(0), "rounded")}>{copied === "rounded" ? message("Copied", "تم النسخ") : message("Copy rounded amount", "نسخ المبلغ المقرب")}</button>
        <p>{message("Any excess is recorded with your payment.", "تُسجّل أي زيادة مع دفعتك.")}</p>
      </HelpDetails> : null}
    </section> : null}
    <button type="button" className="min-h-11 rounded-lg border border-white/20 px-4 py-2 text-sm" onClick={() => void refresh()} disabled={!authorized || busy}>{message("Refresh payment status", "تحديث حالة الدفع")}</button>
    <HelpDetails title={message("Payment details", "تفاصيل الدفع")}>
      <p>{message("Up to 1 USDT above or below the combined total is accepted after verification. Ambiguous payments need review. Copy the final amount, including its decimal reference.", "يُقبل فرق حتى 1 USDT زيادة أو نقصانًا عن الإجمالي بعد التحقق. الدفعات غير الواضحة تحتاج للمراجعة. انسخ المبلغ النهائي بكامل كسوره.")}</p>
      <p>{message("Matching payments settle automatically. No screenshot, transaction ID, or owner approval is needed. Do not send a top-up while waiting.", "تُسوّى الدفعات المطابقة تلقائيًا دون صورة أو معرّف معاملة أو موافقة المالك. لا ترسل مبلغًا إضافيًا أثناء الانتظار.")}</p>
      {data?.checkedAt && Number.isFinite(Date.parse(data.checkedAt)) ? <p>{message("Status refreshed", "آخر تحديث للحالة")}: <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString(isAr ? "ar" : "en-US")}</time></p> : null}
      {data?.lastVerificationCheckAt && Number.isFinite(Date.parse(data.lastVerificationCheckAt)) ? <p>{message("Last payment check", "آخر فحص للدفع")}: <time dateTime={data.lastVerificationCheckAt}>{new Date(data.lastVerificationCheckAt).toLocaleString(isAr ? "ar" : "en-US")}</time></p> : null}
    </HelpDetails>
  </Container>;
}
