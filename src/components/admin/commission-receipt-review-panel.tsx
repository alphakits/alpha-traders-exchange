"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Commission = { id: string; displayNumber?: number; sellerId: string; sellerName: string; commissionAmount: number; hasPaymentInProgress: boolean };
type Batch = { id: string; sellerId: string; sellerName: string; commissionIds: string[]; expectedAmountMicros: number; lastAttemptCode?: string | null };
type Settlement = { id: string; sellerName: string; createdAt: string; expectedMicros: number; receivedMicros: number; waivedMicros: number; excessMicros: number };
type State = { enabled: boolean; commissions: Commission[]; batches: Batch[]; settlements: Settlement[]; checkedAt?: string };
type Receipt = { signature: string; network: "TRC20" | "BEP20"; amountMicros: number; timestamp: number; conflicting: boolean; reserved: boolean };
type History = { receipts: Receipt[]; checkedAt: string; complete: boolean; truncated: boolean };
const money = (micros: number) => Number.isSafeInteger(micros) ? (micros / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—";

export function CommissionReceiptReviewPanel({ locale }: { locale: "ar" | "en" }) {
  const ar = locale === "ar";
  const [state, setState] = useState<State | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [seller, setSeller] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [receiptKey, setReceiptKey] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const denied = useRef(false);
  const pendingRead = useRef<AbortController | null>(null);
  const pendingOther = useRef<AbortController | null>(null);
  const failure = ar ? "تعذر تحديث البيانات. لا ترسل دفعة أخرى؛ أعد تحميل البيانات." : "Data could not be refreshed. Do not send another payment; refresh the records.";
  const clearPrivate = useCallback(() => {
    denied.current = true; setState(null); setHistory(null); setSelected([]); setSeller(""); setReceiptKey(""); setConfirmed(false); setNotice("");
  }, []);
  const refresh = useCallback(async () => {
    if (denied.current || pendingRead.current || document.hidden) return;
    const controller = new AbortController(); pendingRead.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/admin/commission-batches", { cache: "no-store", signal: controller.signal });
      if (!alive.current) return;
      if (response.status === 401 || response.status === 403) { clearPrivate(); throw new Error("owner_session_required"); }
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json();
      if (!data || typeof data.enabled !== "boolean" || !Array.isArray(data.commissions) || !Array.isArray(data.batches) || !Array.isArray(data.settlements)) throw new Error("invalid_response");
      if (alive.current) { setState(data); setError(""); }
    } catch { if (alive.current) { setState(null); setError(failure); } }
    finally { clearTimeout(timeout); pendingRead.current = null; }
  }, [clearPrivate, failure]);
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = setInterval(() => { void refresh(); }, 30_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { alive.current = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); pendingRead.current?.abort(); pendingOther.current?.abort(); };
  }, [refresh]);
  async function scan() {
    if (pendingOther.current || denied.current) return;
    const controller = new AbortController(); pendingOther.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    setScanning(true); setError(""); setConfirmed(false);
    try {
      const response = await fetch("/api/admin/commission-receipts", { cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) { if (alive.current) clearPrivate(); throw new Error("owner_session_required"); }
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json();
      if (!data || !Array.isArray(data.receipts) || typeof data.complete !== "boolean") throw new Error("invalid_response");
      if (alive.current) { setHistory(data); setReceiptKey(""); }
    } catch { if (alive.current) { setHistory(null); setReceiptKey(""); setError(failure); } }
    finally { clearTimeout(timeout); pendingOther.current = null; if (alive.current) setScanning(false); }
  }
  const commissions = state?.commissions ?? [];
  const sellers = [...new Map(commissions.map((record) => [record.sellerId, record.sellerName])).entries()];
  const reservedIds = new Set(state?.batches.flatMap((batch) => batch.commissionIds) ?? []);
  const eligible = commissions.filter((record) => record.sellerId === seller && !record.hasPaymentInProgress && !reservedIds.has(record.id));
  const chosen = eligible.filter((record) => selected.includes(record.id));
  const due = chosen.reduce((sum, record) => sum + Math.round(record.commissionAmount * 1e6), 0);
  const receipt = history?.receipts.find((item) => `${item.network}:${item.signature}` === receiptKey);
  const delta = receipt ? receipt.amountMicros - due : 0;
  const acceptable = Boolean(state?.enabled && chosen.length && chosen.length === selected.length && receipt && !receipt.reserved && !receipt.conflicting && receipt.amountMicros > 0 && Math.abs(delta) <= 1_000_000);
  async function approve() {
    if (!acceptable || !confirmed || !receipt || pendingOther.current || denied.current) return;
    const controller = new AbortController(); pendingOther.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/admin/commission-batches", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ sellerId: seller, commissionIds: selected, signature: receipt.signature, network: receipt.network, confirmedOriginalPayer: true }) });
      if (response.status === 401 || response.status === 403) { if (alive.current) clearPrivate(); throw new Error("owner_session_required"); }
      if (response.status !== 202) throw new Error("not_accepted");
      const data = await response.json();
      if (data.status !== "awaiting_receipt_verification" || typeof data.batchId !== "string") throw new Error("invalid_response");
      if (alive.current) {
        setNotice(ar ? "تم ربط الإيصال. لم تُسجّل العمولة كمدفوعة بعد؛ يفحص النظام الاستلام تلقائيًا قبل التسوية." : "Receipt linked. Not marked paid yet: the scanner will independently verify receipt before settlement.");
        setSelected([]); setReceiptKey(""); setConfirmed(false); setHistory(null); void refresh();
      }
    } catch { if (alive.current) { setConfirmed(false); setError(failure); void refresh(); } }
    finally { clearTimeout(timeout); pendingOther.current = null; if (alive.current) setBusy(false); }
  }
  const control = "w-full rounded-lg border border-white/20 bg-slate-950 p-3 text-white";
  return <main dir={ar ? "rtl" : "ltr"} className="mx-auto max-w-5xl space-y-5 px-4 py-6 text-slate-100">
    <header><h1 className="text-2xl font-semibold">{ar ? "مطابقة إيصالات العمولات" : "Commission receipt reconciliation"}</h1>
      <p className="mt-2 text-sm text-slate-300">{ar ? "المطابقة الدقيقة تلقائية. الإيصالات المجهولة أو المجمعة تحتاج ربطًا موثوقًا بالبائع أولًا، ثم تُفحص وتُسوّى تلقائيًا بهامش ±1 USDT مرة واحدة للدفعة كاملة." : "Exact payment matching is automatic. An unidentified or combined receipt needs a reliable seller association first; receipt verification and settlement then run automatically with ±1 USDT tolerance once per payment group."}</p></header>
    {error ? <p role="alert" className="rounded-lg border border-amber-400/40 p-3">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg border border-emerald-400/40 p-3">{notice}</p> : null}
    <button type="button" className="rounded-lg border border-white/20 px-4 py-2" onClick={() => { void refresh(); }}>{ar ? "تحديث البيانات" : "Refresh records"}</button>
    {!state ? <p>{ar ? "بيانات التسوية غير متاحة حاليًا." : "Settlement data is not currently available."}</p> : <>
      <p className="text-sm">{state.enabled ? (ar ? "التسوية المجمعة مفعّلة — تأكيد الاستلام مطلوب دائمًا." : "Grouped settlement enabled — receipt confirmation is always required.") : (ar ? "التسوية المجمعة غير مفعّلة بعد." : "Grouped settlement is not enabled yet.")}</p>
      <section className="space-y-4 rounded-xl border border-white/15 p-4">
        <h2 className="text-lg font-semibold">{ar ? "ربط الإيصال الأصلي" : "Associate the original receipt"}</h2>
        <label className="block">{ar ? "البائع" : "Seller"}<select aria-label={ar ? "البائع" : "Seller"} className={control} value={seller} onChange={(event) => { setSeller(event.target.value); setSelected([]); setConfirmed(false); }}>
          <option value="">{ar ? "اختر البائع" : "Choose seller"}</option>{sellers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <fieldset className="space-y-2"><legend>{ar ? "العمولات التي تغطيها الدفعة" : "Commissions covered by this payment"}</legend>
          {eligible.map((record) => <label key={record.id} className="flex items-center gap-3 rounded-lg border border-white/10 p-3">
            <input type="checkbox" checked={selected.includes(record.id)} onChange={(event) => { setSelected((old) => event.target.checked ? [...old, record.id] : old.filter((id) => id !== record.id)); setConfirmed(false); }} />
            <span>{record.displayNumber ? `CM-${String(record.displayNumber).padStart(6, "0")}` : record.id} · {money(Math.round(record.commissionAmount * 1e6))} USDT</span>
          </label>)}
        </fieldset>
        <button type="button" disabled={scanning || busy} className="rounded-lg border border-emerald-400/40 px-4 py-2 disabled:opacity-50" onClick={() => { void scan(); }}>{scanning ? (ar ? "جارٍ فحص الإيصالات…" : "Checking receipts…") : (ar ? "تحميل الإيصالات — آخر 30 يومًا" : "Load receipts — last 30 days")}</button>
        {history && (!history.complete || history.truncated) ? <p role="status" className="text-amber-300">{ar ? "قائمة الإيصالات جزئية. عدم ظهور دفعة هنا لا يعني أنها لم تصل." : "Receipt history is partial. A missing entry does not mean the payment was not received."}</p> : null}
        <label className="block">{ar ? "الإيصال" : "Receipt"}<select aria-label={ar ? "الإيصال" : "Receipt"} className={control} value={receiptKey} onChange={(event) => { setReceiptKey(event.target.value); setConfirmed(false); }}>
          <option value="">{ar ? "اختر الإيصال الأصلي" : "Choose original receipt"}</option>
          {history?.receipts.map((item) => <option key={`${item.network}:${item.signature}`} disabled={item.reserved || item.conflicting} value={`${item.network}:${item.signature}`}>
            {money(item.amountMicros)} USDT · {item.network} · {new Date(item.timestamp).toISOString()} · {item.signature.slice(-16)}{item.reserved ? " (reserved)" : item.conflicting ? " (conflicting)" : ""}
          </option>)}
        </select></label>
        {receipt ? <p className="break-all text-xs text-slate-400" dir="ltr">{receipt.signature}</p> : null}
        <div className="rounded-lg bg-white/5 p-3 text-sm"><p>{ar ? "المستحق" : "Amount due"}: {money(due)} USDT</p><p>{ar ? "الإيصال المكتشف، قبل التحقق النهائي" : "Discovered receipt, before final verification"}: {receipt ? money(receipt.amountMicros) : "—"} USDT</p><p>{ar ? "الإعفاء" : "Waiver"}: {receipt ? money(Math.max(0, -delta)) : "—"} USDT · {ar ? "الزيادة" : "Excess"}: {receipt ? money(Math.max(0, delta)) : "—"} USDT</p>
          {receipt && chosen.length && !acceptable ? <p className="mt-2 text-amber-300">{ar ? "الدفعة غير مؤهلة للربط المحدد. لا تطلب دفعها مرة أخرى؛ راجع الإيصال الأصلي." : "This receipt is not eligible for the selected association. Do not request another payment; investigate the original receipt."}</p> : null}
        </div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>{ar ? "تحققت بشكل مستقل أن هذا الإيصال يخص هذا البائع وهذه العمولات. لم أعتمد على تشابه المبلغ وحده." : "I independently confirmed that this original receipt belongs to this seller and these commissions. I did not identify the payer from the amount alone."}</span>
        </label>
        <button type="button" disabled={!acceptable || !confirmed || busy || scanning} className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold disabled:opacity-40" onClick={() => { void approve(); }}>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "ربط الإيصال وبدء التحقق التلقائي" : "Link receipt for automatic verification")}</button>
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">{ar ? "بانتظار التحقق" : "Awaiting verification"}</h2>
        {state.batches.map((batch) => <div key={batch.id} className="rounded-lg border border-white/15 p-3 text-sm"><p>{batch.sellerName} · {money(batch.expectedAmountMicros)} USDT</p><p>{batch.lastAttemptCode ?? (ar ? "بانتظار فحص الاستلام" : "Waiting for receipt scan")}</p></div>)}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">{ar ? "تسويات مؤكدة" : "Verified settlements"}</h2>
        {state.settlements.map((item) => <article key={item.id} className="rounded-lg border border-white/15 p-3 text-sm"><p>{item.sellerName}</p><p>{ar ? "المستحق / المستلم / المعفى / الزيادة" : "Due / received / waived / excess"}: {money(item.expectedMicros)} / {money(item.receivedMicros)} / {money(item.waivedMicros)} / {money(item.excessMicros)} USDT</p><time className="text-xs text-slate-400">{item.createdAt}</time></article>)}
      </section>
    </>}
  </main>;
}
