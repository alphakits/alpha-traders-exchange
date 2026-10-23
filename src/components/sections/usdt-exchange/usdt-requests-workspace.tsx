"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { calculateCardlessUsdtAmount, calculateTradePaymentTotal, getCardlessWithdrawalBankOptions, type CardlessVerificationKind } from "@alpha-traders/contracts";
import { CardlessWithdrawalFields } from "@/components/sections/trade-room/cardless-withdrawal-fields";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import type { DemandTerms, DemandView, DemandWorkspace } from "@/types/usdt-demand";

const root = "/api/alpha-exchange/usdt-requests";
const field = "mt-2 min-h-12 w-full rounded-xl border border-white/20 bg-[#111318] px-3 py-2 text-white outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-300/20";
const primary = "inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-300 px-5 py-3 font-semibold text-black disabled:opacity-40";
const secondary = "inline-flex min-h-12 items-center justify-center rounded-xl border border-white/20 px-4 py-3 text-sm hover:bg-white/5 disabled:opacity-40";
const panel = "rounded-2xl border border-white/10 bg-[#111318] p-5 sm:p-6";
const initial: DemandTerms = { amount: "", price: "", network: "TRC20", paymentMethod: "Bank Transfer", city: "" };
function paymentLabel(method: string, ar: boolean) {
  if (!ar) return method;
  return ({ "Bank Transfer": "تحويل بنكي", "Cardless ATM Withdrawal": "سحب دون بطاقة", "Face-to-Face (Meet in Person)": "لقاء شخصي" } as Record<string, string>)[method] ?? method;
}
function stateLabel(state: string, ar: boolean) {
  const labels: Record<string, [string, string]> = { open: ["Open", "مفتوح"], paused: ["Price needs review", "السعر بحاجة للمراجعة"], matched: ["Trade in progress", "الصفقة جارية"], fulfilled: ["Completed", "مكتمل"], expired: ["Expired", "منتهي"], cancelled: ["Cancelled", "ملغى"], trade_cancelled: ["Trade cancelled", "تم إلغاء الصفقة"] };
  return labels[state]?.[ar ? 1 : 0] ?? state;
}
async function api<T>(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { cache: "no-store", ...options, signal: options.signal ?? AbortSignal.timeout(25_000), headers: { "Content-Type": "application/json", ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? body.message ?? "Please refresh and try again.");
  return body as T;
}

export function UsdtRequestsWorkspace({ locale, actorId, demandId }: { locale: "en" | "ar"; actorId: string; demandId?: string }) {
  const ar = locale === "ar";
  const router = useRouter();
  const params = useSearchParams();
  const selectedOfferId = params?.get("offer");
  const session = useOptionalCanonicalSession();
  const accountMatches = !session || session.user?.id === actorId;
  const [data, setData] = useState<DemandWorkspace | null>(null);
  const [scope, setScope] = useState("mine");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sequence = useRef(0);
  const submission = useRef<{ body: string; id: string } | null>(null);
  const [terms, setTerms] = useState<DemandTerms>(initial);
  const [editing, setEditing] = useState(false);
  const [editingRequest, setEditingRequest] = useState<{ id: string; revision: number } | null>(null);
  const [cash, setCash] = useState("1000");
  const [listingId, setListingId] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [responseRequest, setResponseRequest] = useState<{ id: string; revision: number } | null>(null);
  const [reviewOffer, setReviewOffer] = useState<DemandView["offers"][number] | null>(null);
  const [wallet, setWallet] = useState("");
  const [bank, setBank] = useState("");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<CardlessVerificationKind>("id_number");
  const [verification, setVerification] = useState("");
  const [safety, setSafety] = useState(false);
  const current = demandId ? data?.requests.find(request => request.id === demandId) : undefined;
  const hasWorkspace = data !== null;
  const url = demandId ? `${root}/${encodeURIComponent(demandId)}` : `${root}?scope=${scope}`;
  const invalidatePendingLoads = useCallback(() => { ++sequence.current; }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const call = ++sequence.current;
    const next = await api<DemandWorkspace>(url, { signal });
    if (signal?.aborted || call !== sequence.current || next.actorId !== actorId) return;
    setData(next);
    setReviewOffer(old => old ? next.requests.flatMap(r => r.offers).find(o => o.id === old.id && o.available && o.price === old.price && o.revision === old.revision) ?? null : null);
  }, [url, actorId]);
  useEffect(() => {
    setData(null); setError(""); setEditing(false); setEditingRequest(null); setResponseRequest(null); setListingId(""); setOfferPrice(""); setReviewOffer(null); setWallet(""); setBank(""); setCode(""); setVerification(""); setSafety(false);
    submission.current = null;
    const controller = new AbortController();
    if (!accountMatches) return;
    const refresh = () => { if (!busyRef.current && !document.hidden) void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); }); };
    refresh(); const timer = window.setInterval(refresh, 20_000); window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); invalidatePendingLoads(); };
  }, [load, accountMatches, invalidatePendingLoads]);
  useEffect(() => {
    // A seller's selection applies to the amount/network they reviewed. A
    // refreshed request revision requires an explicit new listing selection.
    setListingId(""); setOfferPrice(""); setResponseRequest(null); submission.current = null;
  }, [current?.id, current?.revision]);
  useEffect(() => {
    if (selectedOfferId && hasWorkspace) document.getElementById(`offer-${selectedOfferId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedOfferId, hasWorkspace]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current || !accountMatches) return;
    busyRef.current = true; setBusy(true); setError(""); setSuccess("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function operation(body: unknown) {
    const serialized = JSON.stringify(body);
    if (submission.current?.body !== serialized) submission.current = { body: serialized, id: crypto.randomUUID() };
    return submission.current!.id;
  }
  const formTerms = { ...terms, amount: terms.paymentMethod === "Cardless ATM Withdrawal" ? calculateCardlessUsdtAmount(cash, terms.price, true) ?? "" : terms.amount };
  const estimate = calculateTradePaymentTotal(formTerms.amount, formTerms.price, true);
  const openRequest = data?.requests.find(r => ["open", "paused"].includes(r.state));
  const canEdit = current?.isMine && !["matched", "fulfilled"].includes(current.state);
  const reviewTotal = current && reviewOffer ? calculateTradePaymentTotal(current.amount, reviewOffer.price, true) : null;
  const text = (en: string, arabic: string) => ar ? arabic : en;
  async function submitTerms(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (editingRequest) {
        if (editingRequest.id !== demandId) throw new Error(text("This request changed. Close the form and review it again.", "تغيّر هذا الطلب. أغلق النموذج وراجعه مجددًا."));
        await api(`${root}/${encodeURIComponent(editingRequest.id)}`, { method: "PATCH", body: JSON.stringify({ action: "renew", revision: editingRequest.revision, terms: formTerms }) });
        setEditing(false); setEditingRequest(null); await load();
      } else {
        if (demandId) throw new Error(text("This request changed. Close the form and review it again.", "تغيّر هذا الطلب. أغلق النموذج وراجعه مجددًا."));
        const result = await api<{ destination: string }>(root, { method: "POST", body: JSON.stringify({ terms: formTerms, operationId: operation(formTerms) }) });
        setEditing(false); setEditingRequest(null);
        router.push(result.destination);
      }
    });
  }
  async function submitResponse(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (!current || !responseRequest || responseRequest.id !== current.id || responseRequest.revision !== current.revision) {
        throw new Error(text("This request changed. Review it and select your listing again.", "تغيّر هذا الطلب. راجعه واختر عرضك مجددًا."));
      }
      const body = { listingId, price: offerPrice, revision: responseRequest.revision };
      await api(`${root}/${encodeURIComponent(responseRequest.id)}/offers`, { method: "POST", body: JSON.stringify({ ...body, operationId: operation(body) }) });
      submission.current = null; setResponseRequest(null); setListingId(""); setOfferPrice("");
      await load(); setSuccess(text("Your response was sent.", "تم إرسال ردك."));
    });
  }
  if (!accountMatches) return <main className="mx-auto max-w-4xl p-6"><p role="alert">{text("Your session changed. Sign in again to continue.", "تغيّرت جلستك. سجّل الدخول مجددًا.")}</p></main>;
  return <main dir={ar ? "rtl" : "ltr"} className="mx-auto min-h-screen max-w-5xl space-y-6 px-4 py-8 text-white sm:px-6">
    <header className="space-y-4">
      <Link href="/usdt-exchange" className="text-sm text-gray-300 underline underline-offset-4">{text("Back to Alpha Exchange", "العودة إلى Alpha Exchange")}</Link>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">ALPHA EXCHANGE</p>
      <h1 className="text-3xl font-semibold sm:text-4xl">{text("Request", "اطلب")} <span className="text-emerald-400">USDT</span></h1>
      <p className="max-w-2xl text-gray-300">{text("Tell approved sellers how much you need. Review their responses and continue securely in your Trade Room.", "حدّد المبلغ الذي تحتاجه للبائعين المعتمدين. راجع ردودهم وتابع بأمان في غرفة الصفقة.")}</p>
    </header>
    <section aria-label={text("Price reference", "مرجع السعر")} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amber-300/25 bg-amber-300/5 p-5">
      <div><p className="text-sm text-gray-300">{text("USD/ILS reference", "مرجع USD/ILS")}</p><p className="mt-1 text-2xl font-semibold text-emerald-400">{data?.reference ? `₪${data.reference.price}` : "—"}</p></div>
      <div><p className="text-sm text-gray-300">{text("Allowed price · ±₪0.35", "السعر المسموح · ±₪0.35")}</p><p className="mt-1 font-semibold text-emerald-400" dir="ltr">{data?.reference ? `₪${data.reference.minimum} – ₪${data.reference.maximum}` : text("Waiting for a fresh quote", "بانتظار سعر حديث")}</p></div>
    </section>
    {error && <p role="alert" className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-red-200">{error}</p>}
    {success && <p role="status" className="rounded-xl bg-emerald-500/10 p-4 text-emerald-300">{success}</p>}
    {!data && <p role="status">{text("Loading requests…", "جارٍ تحميل الطلبات…")}</p>}
    {!demandId && <nav aria-label={text("Request views", "عرض الطلبات")} className="flex gap-3">
      <button className={scope === "mine" ? primary : secondary} aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>{text("My requests", "طلباتي")}</button>
      {data?.canRespond && <button className={scope === "available" ? primary : secondary} aria-pressed={scope === "available"} onClick={() => setScope("available")}>{text("Available requests", "الطلبات المتاحة")}</button>}
    </nav>}
    {data && !demandId && scope === "mine" && !openRequest && <button className={primary} onClick={() => { submission.current = null; setEditingRequest(null); setTerms({ ...initial, price: data.reference ? Number(data.reference.price).toFixed(2) : "" }); setEditing(true); }}>{text("Create a request", "إنشاء طلب")}</button>}
    {editing && <form onSubmit={submitTerms} className={panel}>
      <fieldset disabled={busy} className="space-y-5">
        <legend className="mb-4 text-xl font-semibold">{current ? text("Update and renew", "تحديث وتجديد") : text("Your request", "طلبك")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>{text("Payment method", "طريقة الدفع")}<select className={field} value={terms.paymentMethod} onChange={e => setTerms({ ...terms, paymentMethod: e.target.value as DemandTerms["paymentMethod"] })}>{["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"].map(m => <option key={m} value={m}>{paymentLabel(m, ar)}</option>)}</select></label>
          <label>{text("Network", "الشبكة")}<select className={field} value={terms.network} onChange={e => setTerms({ ...terms, network: e.target.value as DemandTerms["network"] })}>{["TRC20", "BEP20", "ERC20", "SOL"].map(n => <option key={n}>{n}</option>)}</select></label>
          {terms.paymentMethod === "Cardless ATM Withdrawal" ? <label>{text("ATM cash total incl. 1% fee (ILS)", "إجمالي النقد شامل رسوم 1% (شيكل)")}<select className={field} value={cash} onChange={e => setCash(e.target.value)}>{Array.from({ length: 100 }, (_, i) => (i + 1) * 100).map(n => <option key={n} value={n}>₪{n.toLocaleString("en")}</option>)}</select></label> : <label>{text("Amount (USDT)", "المبلغ (USDT)")}<input className={field} required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" maxLength={16} value={terms.amount} onChange={e => setTerms({ ...terms, amount: e.target.value })} /></label>}
          <label>{text("Requested price per USDT (ILS)", "السعر المطلوب لكل USDT (شيكل)")}<input className={field} required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" maxLength={7} value={terms.price} onChange={e => setTerms({ ...terms, price: e.target.value })} /></label>
          {terms.paymentMethod === "Face-to-Face (Meet in Person)" && <label>{text("Meeting city", "مدينة اللقاء")}<input className={field} required minLength={2} maxLength={80} value={terms.city} onChange={e => setTerms({ ...terms, city: e.target.value })} /></label>}
        </div>
        <p className="text-emerald-400">{formTerms.amount || "—"} USDT · {text("Estimated payment", "الدفع المتوقع")}: ₪{estimate ?? "—"}</p>
        <p className="rounded-xl bg-yellow-300/10 p-3 text-sm text-yellow-200">{text("Includes the 1% buyer fee. Posting a request is free. Your request expires after 24 hours; it does not guarantee a match.", "يشمل رسوم المشتري 1%. نشر الطلب مجاني. ينتهي الطلب بعد 24 ساعة ولا يضمن إيجاد بائع.")}</p>
        <div className="flex flex-wrap gap-3"><button className={primary} disabled={!data?.reference || busy}>{busy ? text("Saving…", "جارٍ الحفظ…") : text("Publish request", "نشر الطلب")}</button><button type="button" className={secondary} onClick={() => { setEditing(false); setEditingRequest(null); }}>{text("Close", "إغلاق")}</button></div>
      </fieldset>
    </form>}
    {data?.requests.map(d => <article key={d.id} className={panel}>
      <div className="flex flex-wrap justify-between gap-4"><div><p className="text-sm text-gray-400">{d.requesterName}</p><h2 className="mt-2 text-3xl font-semibold text-emerald-400">{d.amount} <span className="text-lg">USDT</span></h2><p className="mt-2 text-emerald-400">₪{d.price} {text("per USDT", "لكل USDT")}</p></div><span className="h-fit rounded-full border border-amber-300/25 px-3 py-1 text-xs text-amber-200">{stateLabel(d.state, ar)}</span></div>
      <p className="mt-4 text-sm text-gray-300">{paymentLabel(d.paymentMethod, ar)} · {d.network}{d.city ? ` · ${d.city}` : ""}</p>
      <p className="mt-2 text-xs text-gray-400">{text("Expires", "ينتهي")}: {new Date(d.expiresAt).toLocaleString(ar ? "ar" : "en", { dateStyle: "medium", timeStyle: "short" })}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {!demandId && <Link className={primary} href={`/usdt-exchange/requests/${encodeURIComponent(d.id)}`}>{text("View request", "عرض الطلب")}</Link>}
        {d.purchaseRequestId && <Link className={primary} href={`/trade-room/${encodeURIComponent(d.purchaseRequestId)}`}>{text("Open Trade Room", "فتح غرفة الصفقة")}</Link>}
        {demandId && canEdit && <><button className={secondary} disabled={busy} onClick={() => { setEditingRequest({ id: d.id, revision: d.revision }); setTerms({ amount: d.amount, price: d.price, network: d.network, paymentMethod: d.paymentMethod, city: d.city }); setCash(String(Number(calculateTradePaymentTotal(d.amount, d.price, true) ?? "1000"))); setEditing(true); }}>{text("Update / renew", "تحديث / تجديد")}</button>{!["cancelled", "expired", "trade_cancelled"].includes(d.state) && <button className={secondary} disabled={busy} onClick={() => void run(async () => { await api(url, { method: "PATCH", body: JSON.stringify({ action: "cancel", revision: d.revision }) }); await load(); })}>{text("Cancel request", "إلغاء الطلب")}</button>}</>}
      </div>
      {d.state === "paused" && <p className="mt-4 text-sm text-yellow-200">{text("Matching is paused until the reference is fresh and your price is within the allowed range. Your price never changes automatically.", "تتوقف المطابقة حتى يتوفر سعر حديث ويصبح سعرك ضمن النطاق المسموح. لا يتغير سعرك تلقائيًا.")}</p>}
    </article>)}
    {data && !data.requests.length && !editing && <p className={panel}>{text("No requests to show yet.", "لا توجد طلبات لعرضها بعد.")}</p>}
    {data?.nextCursor && <button className={secondary} disabled={busy} onClick={() => void run(async () => { const next = await api<DemandWorkspace>(`${url}&cursor=${encodeURIComponent(data.nextCursor!)}`); setData({ ...next, requests: [...data.requests, ...next.requests] }); })}>{text("Load more", "تحميل المزيد")}</button>}
    {current && !current.isMine && current.state === "open" && data?.canRespond && <section className={panel}>
      <h2 className="text-xl font-semibold">{text("Respond to this request", "الرد على هذا الطلب")}</h2>
      <p className="mt-2 text-sm text-gray-300">{text("Offer the full requested amount using an approved listing. The buyer reviews your price before opening a trade.", "قدّم كامل المبلغ المطلوب عبر عرض معتمد. يراجع المشتري سعرك قبل فتح الصفقة.")}</p>
      {data.listings.length > 0 && <form className="mt-5 space-y-4" onSubmit={submitResponse}><fieldset disabled={busy} className="space-y-4">
        <label className="block">{text("Your listing", "عرضك")}<select className={field} required value={listingId} onChange={e => { setListingId(e.target.value); setOfferPrice(e.target.value ? current.price : ""); setResponseRequest(e.target.value ? { id: current.id, revision: current.revision } : null); }}><option value="">{text("Select a listing", "اختر عرضًا")}</option>{data.listings.map(l => <option key={l.id} value={l.id}>{l.amount} USDT · ₪{l.price}</option>)}</select></label>
        <label className="block">{text("Your response price (ILS)", "سعر ردك (شيكل)")}<input required className={field} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={offerPrice} onChange={e => setOfferPrice(e.target.value)} /></label>
        <button className={primary} disabled={busy || !data.reference || !responseRequest}>{text("Send response", "إرسال الرد")}</button>
      </fieldset></form>}
      <Link className={`${secondary} mt-5`} href={`/usdt-exchange?demand=${encodeURIComponent(current.id)}#create-listing`}>{text("Create a listing for this request", "إنشاء عرض لهذا الطلب")}</Link>
      <p className="mt-3 text-xs text-gray-400">{text("New listings keep the existing owner approval process. Return here after approval to send your response.", "تخضع العروض الجديدة لموافقة المالك كالمعتاد. عد إلى هنا بعد الموافقة لإرسال ردك.")}</p>
    </section>}
    {current && <section className="space-y-4"><h2 className="text-xl font-semibold">{text("Seller responses", "ردود البائعين")}</h2>
      {!current.offers.length && <p className="text-gray-400">{text("No responses yet. Eligible sellers can view your request.", "لا توجد ردود بعد. يمكن للبائعين المؤهلين مشاهدة طلبك.")}</p>}
      {current.offers.map(o => <article id={`offer-${o.id}`} key={o.id} className={`${panel} scroll-mt-24 ${selectedOfferId === o.id ? "ring-2 ring-amber-300" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-4"><div><p>{o.sellerName}</p><p className="mt-2 text-xl font-semibold text-emerald-400">₪{o.price} / USDT</p><p className="mt-2 text-sm text-yellow-200">{text("Total incl. 1% buyer fee", "الإجمالي شامل رسوم المشتري 1%")}: <span className="text-emerald-400">₪{calculateTradePaymentTotal(current.amount, o.price, true)}</span></p></div>
          {current.isMine && <button className={primary} disabled={busy || !o.available} onClick={() => { setReviewOffer(o); setWallet(""); setCode(""); setVerification(""); setSafety(false); }}>{o.available ? text("Review response", "مراجعة الرد") : text("Unavailable", "غير متاح")}</button>}
          {o.isMine && o.state === "open" && <button className={secondary} disabled={busy} onClick={() => void run(async () => { await api(`${url}/offers`, { method: "DELETE", body: JSON.stringify({ offerId: o.id }) }); await load(); })}>{text("Withdraw response", "سحب الرد")}</button>}
        </div>
      </article>)}
    </section>}
    {current && reviewOffer && <form className={`${panel} border-amber-300/40`} onSubmit={e => { e.preventDefault(); void run(async () => {
      const result = await api<{ destination: string }>("/api/alpha-exchange/purchase-requests", { method: "POST", body: JSON.stringify({
        listingId: reviewOffer.listingId, usdtAmount: current.amount, receivingNetwork: current.network, paymentMethod: current.paymentMethod,
        buyerReceivingWalletAddress: wallet, feePolicyVersion: "buyer_seller_1pct_v1", usdtDemandId: current.id,
        usdtDemandOfferId: reviewOffer.id, usdtDemandRevision: current.revision, safetyAcknowledged: safety,
        bankName: bank, cardlessWithdrawalCode: code, cardlessVerificationKind: kind, cardlessVerificationValue: verification, cardlessIlsAmount: current.paymentMethod === "Cardless ATM Withdrawal" ? reviewTotal : undefined,
      }) });
      router.push(result.destination);
    }); }}>
      <fieldset disabled={busy} className="space-y-5">
        <legend className="text-xl font-semibold">{text("Review and open trade", "راجع وافتح الصفقة")}</legend>
        <p>{current.amount} USDT · ₪{reviewOffer.price} / USDT · {paymentLabel(current.paymentMethod, ar)}</p>
        <p className="text-emerald-400">{text("Total including 1% buyer fee", "الإجمالي شامل رسوم المشتري 1%")}: ₪{reviewTotal ?? "—"}</p>
        <label className="block">{text("Your receiving wallet", "محفظتك المستلمة")} ({current.network})
          <input required className={field} dir="ltr" autoComplete="off" maxLength={200} value={wallet} onChange={e => setWallet(e.target.value)} />
        </label>
        {current.paymentMethod === "Cardless ATM Withdrawal" && <>
          <label className="block">{text("Issuing bank", "البنك المصدر")}
            <select required className={field} value={bank} onChange={e => setBank(e.target.value)}>
              <option value="">{text("Select your bank", "اختر بنكك")}</option>
              {getCardlessWithdrawalBankOptions().map(b => <option key={b.code} value={b.name}>{ar ? b.nameAr : b.name}</option>)}
            </select>
          </label>
          <CardlessWithdrawalFields isAr={ar} phase="request" disabled={busy} code={code} verificationKind={kind} verificationValue={verification} onCodeChange={setCode} onKindChange={setKind} onValueChange={setVerification} />
        </>}
        <label className="flex items-start gap-3 text-sm text-gray-300">
          <input type="checkbox" required className="mt-1 h-5 w-5" checked={safety} onChange={e => setSafety(e.target.checked)} />
          <span>{text("I checked the amount, price, payment method and wallet network. I will follow the instructions in the Trade Room.", "راجعت المبلغ والسعر وطريقة الدفع وشبكة المحفظة. سألتزم بتعليمات غرفة الصفقة.")}</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <button className={primary} disabled={busy || !safety || !reviewOffer.available || !data?.reference}>{busy ? text("Opening trade…", "جارٍ فتح الصفقة…") : text("Open Trade Room", "فتح غرفة الصفقة")}</button>
          <button type="button" className={secondary} disabled={busy} onClick={() => setReviewOffer(null)}>{text("Close", "إغلاق")}</button>
        </div>
      </fieldset>
    </form>}
  </main>;
}
