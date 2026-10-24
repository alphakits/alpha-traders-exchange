"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/navigation";
import { calculateCardlessUsdtAmount, calculateTradePaymentTotal, getCardlessWithdrawalBankOptions, getWalletAddressValidationError, normalizeWalletAddress, parseCardlessWithdrawalDetails, type CardlessVerificationKind } from "@alpha-traders/contracts";
import { CardlessWithdrawalFields } from "@/components/sections/trade-room/cardless-withdrawal-fields";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { formatIls, formatPriceReference, formatUsdt } from "@/lib/usdt-demand-format";
import { fetchClientJson } from "@/lib/client-request-deadline";
import type { DemandTerms, DemandView, DemandWorkspace } from "@/types/usdt-demand";
import { FeeBreakdown, NextStep, RequestMoneyText, RequestStatus, RequestSteps, paymentLabel, requestField as field, requestPanel as panel, requestPrimary as primary, requestSecondary as secondary } from "./usdt-request-details";
import { RequestForm } from "./usdt-request-form";
import { SellerResponseForm } from "./usdt-response-form";
import { RequestCounterpartyIdentity } from "./request-counterparty-identity";

const root = "/api/alpha-exchange/usdt-requests";
const initial: DemandTerms = { amount: "", price: "", network: "TRC20", paymentMethod: "Bank Transfer", city: "" };
async function api<T>(url: string, options: RequestInit = {}) {
  const { response, payload: body } = await fetchClientJson<T & { error?: string; message?: string }>(url, {
    cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options.headers },
  }, 25_000).catch(error => {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new Error("Could not load the current details. Please refresh and try again.");
    throw error;
  });
  if (!response.ok) throw new Error(body.error ?? body.message ?? "Please refresh and try again.");
  return body as T;
}
function reveal(id: string) {
  requestAnimationFrame(() => {
    const element = document.getElementById(id);
    element?.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" });
    (element?.matches("[tabindex='-1']") ? element : element?.querySelector<HTMLElement>("input, select, [tabindex='-1']"))?.focus({ preventScroll: true });
  });
}
function mergeRequests(rows: DemandView[]) {
  return [...new Map(rows.map(row => [row.id, row])).values()];
}

export function UsdtRequestsWorkspace({ locale, actorId, demandId }: { locale: "en" | "ar"; actorId: string; demandId?: string }) {
  const ar = locale === "ar";
  const text = (en: string, arabic: string) => ar ? arabic : en;
  const router = useRouter();
  const params = useSearchParams();
  const selectedOfferId = params?.get("offer");
  const requestedScope = params?.get("scope") === "available" ? "available" : "mine";
  const session = useOptionalCanonicalSession();
  const [invalidActor, setInvalidActor] = useState<string | null>(null);
  const accountMatches = invalidActor !== actorId && (!session || session.user?.id === actorId);
  const [data, setData] = useState<DemandWorkspace | null>(null);
  const [scope, setScope] = useState(requestedScope);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const busyRef = useRef(false);
  const sequence = useRef(0);
  const loadedLimit = useRef(30);
  const submission = useRef<{ body: string; id: string } | null>(null);
  const [terms, setTerms] = useState<DemandTerms>(initial);
  const [editing, setEditing] = useState(false);
  const [editingRequest, setEditingRequest] = useState<{ id: string; revision: number } | null>(null);
  const [cash, setCash] = useState("1000");
  const [listingId, setListingId] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [responseRequest, setResponseRequest] = useState<{ id: string; revision: number } | null>(null);
  const [reviewOffer, setReviewOffer] = useState<DemandView["offers"][number] | null>(null);
  const [confirmation, setConfirmation] = useState<{ kind: "cancel" | "withdraw"; id: string; revision: number } | null>(null);
  const [wallet, setWallet] = useState("");
  const [bank, setBank] = useState("");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<CardlessVerificationKind>("id_number");
  const [verification, setVerification] = useState("");
  const [safety, setSafety] = useState(false);
  const current = demandId ? data?.requests.find(request => request.id === demandId) : undefined;
  const url = demandId ? root + "/" + encodeURIComponent(demandId) : root + "?scope=" + scope;
  const contextKey = actorId + "|" + (demandId ?? "") + "|" + scope + "|" + accountMatches;
  const activeContext = useRef(contextKey);
  activeContext.current = contextKey;
  const invalidateLoads = useCallback(() => { ++sequence.current; }, []);
  const hasWorkspace = data !== null;
  const reference = refreshFailed || (data?.reference?.validUntil && Date.parse(data.reference.validUntil) <= now) ? null : data?.reference ?? null;
  useEffect(() => { setScope(requestedScope); }, [requestedScope]);
  function changeScope(next: "mine" | "available") {
    setScope(next);
    router.replace("/usdt-exchange/requests?scope=" + next, { scroll: false });
  }
  useEffect(() => {
    if (!demandId && data && !data.canRespond && scope === "available") {
      setScope("mine");
      router.replace("/usdt-exchange/requests?scope=mine", { scroll: false });
    }
  }, [data, demandId, scope, router]);
  const clearReview = useCallback(() => {
    setReviewOffer(null); setWallet(""); setBank(""); setCode(""); setVerification(""); setKind("id_number"); setSafety(false);
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const call = ++sequence.current;
    const valid = () => !signal?.aborted && call === sequence.current && activeContext.current === contextKey;
    try {
      const next = await api<DemandWorkspace>(url, { signal });
      if (!valid()) return;
      if (next.actorId !== actorId) { setInvalidActor(actorId); setData(null); return; }
      const cursors = new Set<string>();
      while (!demandId && next.nextCursor && next.requests.length < loadedLimit.current && !cursors.has(next.nextCursor)) {
        cursors.add(next.nextCursor);
        const page = await api<DemandWorkspace>(url + "&cursor=" + encodeURIComponent(next.nextCursor), { signal });
        if (!valid()) return;
        if (page.actorId !== actorId) { setInvalidActor(actorId); setData(null); return; }
        next.requests = mergeRequests([...next.requests, ...page.requests]); next.nextCursor = page.nextCursor;
      }
      if (valid()) { setData(next); setRefreshFailed(false); setError(""); }
    } catch (error) {
      if (!valid()) return;
      setRefreshFailed(true);
      throw error;
    }
  }, [url, actorId, demandId, contextKey]);
  useEffect(() => {
    setData(null); setRefreshFailed(false); setError(""); setSuccess(""); setEditing(false); setTerms(initial); setCash("1000"); setEditingRequest(null); setResponseRequest(null); setListingId(""); setOfferPrice(""); setConfirmation(null); clearReview();
    loadedLimit.current = 30; submission.current = null; busyRef.current = false; setBusy(false);
    const controller = new AbortController();
    if (!accountMatches) return;
    const refresh = () => {
      if (!busyRef.current && !document.hidden) void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    };
    refresh();
    const timer = window.setInterval(refresh, 20_000); window.addEventListener("focus", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh); invalidateLoads(); };
  }, [load, accountMatches, clearReview, invalidateLoads]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    // A changed amount/network must be reviewed before the seller responds again.
    setListingId(""); setOfferPrice(""); setResponseRequest(null); submission.current = null;
  }, [current?.id, current?.revision]);
  useEffect(() => {
    if (reviewOffer && !current?.offers.some(o => o.id === reviewOffer.id && o.available && o.price === reviewOffer.price && o.revision === reviewOffer.revision)) {
      clearReview();
      setSuccess(ar ? "تغيّر هذا الرد ولم يعد متاحًا. راجع الردود الحالية قبل المتابعة." : "This response changed and is no longer available. Review the current responses before continuing.");
    }
  }, [current, reviewOffer, clearReview, ar]);
  useEffect(() => {
    if (selectedOfferId && hasWorkspace) reveal("offer-" + selectedOfferId);
  }, [selectedOfferId, hasWorkspace]);
  async function run(action: (isCurrent: () => boolean) => Promise<void>) {
    if (busyRef.current || !accountMatches) return;
    const key = contextKey;
    const isCurrent = () => activeContext.current === key;
    busyRef.current = true; ++sequence.current; setBusy(true); setError(""); setSuccess("");
    try { await action(isCurrent); } catch (e) {
      if (isCurrent()) { setError(e instanceof Error ? e.message : text("Please try again.", "يرجى المحاولة مجددًا.")); reveal("request-feedback"); }
    } finally { if (isCurrent()) { busyRef.current = false; setBusy(false); } }
  }
  function operation(body: unknown) {
    const serialized = JSON.stringify(body);
    if (submission.current?.body !== serialized) submission.current = { body: serialized, id: crypto.randomUUID() };
    return submission.current!.id;
  }
  const formTerms = { ...terms, amount: terms.paymentMethod === "Cardless ATM Withdrawal" ? calculateCardlessUsdtAmount(cash, terms.price, true) ?? "" : terms.amount };
  const openRequestId = data?.publishing?.openRequestId ?? data?.requests.find(r => r.isMine && ["open", "paused"].includes(r.state))?.id;
  const canEdit = current?.isMine && !["matched", "fulfilled"].includes(current.state);
  const staleEditor = Boolean(editingRequest && (editingRequest.id !== current?.id || editingRequest.revision !== current.revision));
  const reviewTotal = current && reviewOffer ? calculateTradePaymentTotal(current.amount, reviewOffer.price, true) : null;
  const reviewedIdentity = current?.offers.find(offer => offer.id === reviewOffer?.id)?.seller ?? reviewOffer?.seller;
  const walletError = current && wallet ? getWalletAddressValidationError(current.network, wallet) : null;
  const atmReady = current?.paymentMethod !== "Cardless ATM Withdrawal" || Boolean(bank && parseCardlessWithdrawalDetails({ withdrawalCode: code, verificationKind: kind, verificationValue: verification }).ok);
  const reviewReady = Boolean(wallet.trim() && !walletError && atmReady && safety && reviewOffer?.available && reference
    && current?.state === "open" && Date.parse(current.expiresAt) > now
    && Number(reviewOffer.price) >= Number(reference.minimum) && Number(reviewOffer.price) <= Number(reference.maximum));
  const reviewHelp = current && (current.state !== "open" || Date.parse(current.expiresAt) <= now)
    ? text("This request has closed or expired. Refresh to see its current status.", "أُغلق هذا الطلب أو انتهت صلاحيته. حدّث لعرض حالته الحالية.")
    : !reference ? text("Refresh the price and availability before opening a trade. Your details stay on this screen.", "حدّث السعر والتوفر قبل فتح الصفقة. تبقى تفاصيلك في هذه الشاشة.")
      : reviewOffer && (Number(reviewOffer.price) < Number(reference.minimum) || Number(reviewOffer.price) > Number(reference.maximum))
        ? text("This response is outside the current price range. Refresh to review available responses.", "هذا الرد خارج نطاق السعر الحالي. حدّث لمراجعة الردود المتاحة.")
        : text("Complete the wallet, required payment details and confirmation above to continue.", "أكمل المحفظة وتفاصيل الدفع المطلوبة والتأكيد أعلاه للمتابعة.");
  const selling = current ? !current.isMine : scope === "available";
  const activeTrade = Boolean(current?.purchaseRequestId && ["matched", "fulfilled"].includes(current.state));
  const activeOffers = current?.offers.filter(o => o.available) ?? [];
  const pastOffers = current?.offers.filter(o => !o.available) ?? [];
  const ownResponse = current?.offers.find(o => o.isMine && o.state === "open" && o.available);
  function editRequest(d: DemandView) {
    submission.current = null; setError(""); setEditingRequest({ id: d.id, revision: d.revision });
    setTerms({ amount: d.amount, price: d.price, network: d.network, paymentMethod: d.paymentMethod, city: d.city });
    setCash(String(Number(calculateTradePaymentTotal(d.amount, d.price, true) ?? "1000"))); setEditing(true); reveal("request-form");
  }
  function createRequest() {
    submission.current = null; setError(""); setEditingRequest(null); setTerms({ ...initial, price: reference ? formatIls(reference.price).replace(/,/g, "") : "" }); setEditing(true); reveal("request-form");
  }
  async function submitTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity() || staleEditor) return;
    await run(async isCurrent => {
      if (editingRequest) {
        if (editingRequest.id !== demandId) return;
        await api(root + "/" + encodeURIComponent(editingRequest.id), { method: "PATCH", body: JSON.stringify({ action: "renew", revision: editingRequest.revision, terms: formTerms }) });
        if (!isCurrent()) return;
        setEditing(false); setEditingRequest(null); await load();
        if (isCurrent()) setSuccess(text("Your request was updated and renewed for 24 hours.", "تم تحديث طلبك وتجديده لمدة 24 ساعة."));
      } else {
        if (demandId) return;
        const result = await api<{ destination: string }>(root, { method: "POST", body: JSON.stringify({ terms: formTerms, operationId: operation(formTerms) }) });
        if (isCurrent()) { setEditing(false); router.push(result.destination); }
      }
    });
  }
  async function submitResponse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    await run(async isCurrent => {
      if (!current || !responseRequest || responseRequest.id !== current.id || responseRequest.revision !== current.revision) throw new Error(text("This request changed. Review it and select your listing again.", "تغيّر هذا الطلب. راجعه واختر عرضك مجددًا."));
      const body = { listingId, price: offerPrice, revision: responseRequest.revision };
      await api(root + "/" + encodeURIComponent(responseRequest.id) + "/offers", { method: "POST", body: JSON.stringify({ ...body, operationId: operation(body) }) });
      if (!isCurrent()) return;
      submission.current = null; setResponseRequest(null); setListingId(""); setOfferPrice("");
      await load(); if (isCurrent()) setSuccess(text("Your response was sent.", "تم إرسال ردك."));
    });
  }
  function chooseOffer(o: DemandView["offers"][number]) {
    clearReview(); setReviewOffer(o); setError(""); reveal("trade-review");
  }
  async function confirmAction() {
    const selected = confirmation;
    if (!selected || !current) return;
    await run(async isCurrent => {
      if (selected.kind === "cancel") await api(root + "/" + encodeURIComponent(selected.id), { method: "PATCH", body: JSON.stringify({ action: "cancel", revision: selected.revision }) });
      else await api(root + "/" + encodeURIComponent(current.id) + "/offers", { method: "DELETE", body: JSON.stringify({ offerId: selected.id }) });
      if (!isCurrent()) return;
      setConfirmation(null); await load();
      if (isCurrent()) setSuccess(selected.kind === "cancel" ? text("Request cancelled. You can review and renew it later.", "تم إلغاء الطلب. يمكنك مراجعته وتجديده لاحقًا.") : text("Response withdrawn. The buyer can no longer select it.", "تم سحب الرد. لم يعد بإمكان المشتري اختياره."));
    });
  }
  function renderOffer(o: DemandView["offers"][number]) {
    const confirming = confirmation?.kind === "withdraw" && confirmation.id === o.id;
    const status = o.state === "accepted" ? text("Selected", "تم اختياره") : o.state === "withdrawn" ? text("Withdrawn", "مسحوب") : o.state === "superseded" ? text("Replaced", "تم استبداله") : text("Unavailable", "غير متاح");
    return <article id={"offer-" + o.id} data-testid="offer-card" key={o.id} className={panel + " scroll-mt-24 " + (selectedOfferId === o.id ? "ring-2 ring-amber-300" : "")}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-full">{o.seller ? <RequestCounterpartyIdentity identity={o.seller} locale={locale} audience="seller" /> : <p className="font-medium">{o.sellerName}</p>}<p className="mt-2 text-xl font-semibold tabular-nums text-emerald-300"><bdi dir="ltr">₪{formatIls(o.price)}</bdi> <span className="text-sm text-gray-400">/ USDT</span></p>
          <p className="mt-2 text-sm text-gray-300">{text("Total incl. 1% buyer fee", "الإجمالي شامل رسوم المشتري 1%")}: <bdi dir="ltr" className="font-semibold tabular-nums text-emerald-300">₪{formatIls(calculateTradePaymentTotal(current!.amount, o.price, true))}</bdi></p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!o.available && <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-gray-400">{status}</span>}
          {o.available && current?.isMine && <button className={primary} disabled={busy} onClick={() => chooseOffer(o)}>{text("Review response", "مراجعة الرد")}</button>}
          {o.available && o.isMine && <span className="text-sm text-amber-200">{text("Waiting for buyer", "بانتظار المشتري")}</span>}
          {o.isMine && o.state === "open" && !confirming && <button className={secondary} disabled={busy} onClick={() => setConfirmation({ kind: "withdraw", id: o.id, revision: o.revision })}>{text("Withdraw response", "سحب الرد")}</button>}
        </div>
      </div>
      {confirming && <div className="mt-4 space-y-3 rounded-xl border border-amber-300/20 p-4"><p className="text-sm">{text("Withdraw this response? The buyer will no longer be able to select it.", "هل تريد سحب هذا الرد؟ لن يتمكن المشتري من اختياره.")}</p><div className="flex flex-wrap gap-3"><button disabled={busy} className={secondary} onClick={() => setConfirmation(null)}>{text("Keep response", "إبقاء الرد")}</button><button disabled={busy} className={primary} onClick={() => void confirmAction()}>{text("Confirm withdrawal", "تأكيد السحب")}</button></div></div>}
    </article>;
  }
  if (!accountMatches) return <main className="mx-auto max-w-4xl space-y-4 p-6"><p role="alert">{text("Your session changed. Reload this page to continue with your current account.", "تغيّرت جلستك. أعد تحميل هذه الصفحة للمتابعة بحسابك الحالي.")}</p><button className={secondary} onClick={() => window.location.reload()}>{text("Reload page", "إعادة تحميل الصفحة")}</button></main>;
  return <main dir={ar ? "rtl" : "ltr"} className="mx-auto min-h-screen max-w-5xl space-y-6 px-4 py-8 pb-28 text-white sm:px-6">
    <header className="space-y-4">
      <Link href={demandId ? "/usdt-exchange/requests?scope=" + (current && !current.isMine && data?.canRespond ? "available" : "mine") : "/usdt-exchange"} className="inline-flex min-h-11 items-center text-sm text-sky-300 underline underline-offset-4">{demandId ? text("Back to requests", "العودة إلى الطلبات") : text("Back to Alpha Exchange", "العودة إلى Alpha Exchange")}</Link>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">ALPHA EXCHANGE</p>
      <h1 className="text-3xl font-semibold sm:text-4xl">{text("Request", "اطلب")} <span className="text-emerald-400">USDT</span></h1>
      <p className="max-w-2xl leading-7 text-gray-300">{selling ? text("Choose a buyer request, send your price, and continue together in the Trade Room.", "اختر طلب مشتري وأرسل سعرك ثم تابعا معًا في غرفة الصفقة.") : text("Choose how much to buy. Compare seller responses, then review the total before opening your Trade Room.", "حدّد الكمية التي تريد شراءها. قارن ردود البائعين ثم راجع الإجمالي قبل فتح غرفة الصفقة.")}</p>
    </header>
    {!demandId && <nav aria-label={text("Request views", "عرض الطلبات")} className="flex flex-wrap gap-3">
      <button className={scope === "mine" ? primary : secondary} aria-pressed={scope === "mine"} onClick={() => changeScope("mine")}>{text("My buying requests", "طلبات الشراء الخاصة بي")}</button>
      {data?.canRespond && <button className={scope === "available" ? primary : secondary} aria-pressed={scope === "available"} onClick={() => changeScope("available")}>{text("Buyer requests · Sell USDT", "طلبات المشترين · بيع USDT")}</button>}
    </nav>}
    <RequestSteps selling={selling} ar={ar} step={current?.purchaseRequestId || reviewOffer ? 2 : current ? 1 : 0} />
    <section aria-label={text("Price reference", "مرجع السعر")} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-5">
      <div className="min-w-0"><p className="text-xs text-gray-400">{text("USD/ILS reference", "مرجع USD/ILS")}</p><p className="mt-1 text-xl font-semibold tabular-nums text-emerald-300 [overflow-wrap:anywhere]"><bdi dir="ltr">{reference ? "₪" + formatPriceReference(reference.price) : "—"}</bdi></p></div>
      <div><p className="text-xs text-gray-400"><RequestMoneyText>{text("Allowed price per USDT · ±₪0.35", "السعر المسموح لكل USDT · ±₪0.35")}</RequestMoneyText></p><p className="mt-1 font-medium text-emerald-300">{reference ? <bdi dir="ltr">₪{formatIls(reference.minimum)} – ₪{formatIls(reference.maximum)}</bdi> : text("Waiting for a fresh quote", "بانتظار سعر حديث")}</p></div>
      <button className={secondary} disabled={busy} onClick={() => void run(async () => { await load(); })}>{text("Refresh", "تحديث")}</button>
      {data && !data.reference && <p className="w-full text-sm text-amber-200">{text("A fresh reference is needed before publishing or opening a trade. Your form stays here; refresh to try again.", "يلزم سعر مرجعي حديث قبل النشر أو فتح صفقة. تبقى بياناتك هنا؛ حدّث للمحاولة مجددًا.")}</p>}
    </section>
    {error && <p id="request-feedback" tabIndex={-1} role="alert" className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-red-200 focus:outline-none"><RequestMoneyText>{error}</RequestMoneyText></p>}
    {refreshFailed && data && <p role="status" className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">{text("We could not refresh the latest price and availability. Your draft is saved on this screen. Choose Refresh before publishing, responding or opening a trade.", "تعذر تحديث السعر والتوفر. تبقى مسودتك في هذه الشاشة. اختر تحديث قبل النشر أو الرد أو فتح صفقة.")}</p>}
    {success && <p role="status" className="rounded-xl bg-emerald-500/10 p-4 text-emerald-300">{success}</p>}
    {!data && !error && <p role="status">{text("Loading requests…", "جارٍ تحميل الطلبات…")}</p>}
    {data && !demandId && !editing && (scope === "mine" ? <NextStep ar={ar} title={openRequestId ? text("Your request is open", "طلبك مفتوح") : text("Tell sellers what you need", "أخبر البائعين بما تحتاجه")}>
      <p>{openRequestId ? text("Open your request to compare responses, review its details, or renew it. You can keep one buying request open at a time.", "افتح طلبك لمقارنة الردود أو مراجعة تفاصيله أو تجديده. يمكنك إبقاء طلب شراء واحد مفتوحًا في كل مرة.") : text("Choose your USDT amount, payment method and network. Approved sellers can then send you their prices.", "حدّد كمية USDT وطريقة الدفع والشبكة. بعدها يستطيع البائعون المعتمدون إرسال أسعارهم.")}</p>
      {openRequestId ? <Link className={primary} href={"/usdt-exchange/requests/" + encodeURIComponent(openRequestId)}>{text("Open my request", "فتح طلبي")}</Link> : <button className={primary} onClick={createRequest}>{text("Create a request", "إنشاء طلب")}</button>}
    </NextStep> : <NextStep ar={ar} title={data.requests.length ? text("Choose a request you can fulfil", "اختر طلبًا يمكنك تلبيته") : text("No buyer requests right now", "لا توجد طلبات مشترين حاليًا")}>
      <p>{data.requests.length ? text("Check the amount, payment method and network, then view the request to send a price from your approved listing.", "راجع الكمية وطريقة الدفع والشبكة، ثم افتح الطلب لإرسال سعر من عرضك المعتمد.") : text("New requests appear here automatically. Keep your listings approved and your available amount up to date.", "تظهر الطلبات الجديدة هنا تلقائيًا. تأكد من اعتماد عروضك وتحديث الكمية المتاحة.")}</p>
      <Link className={secondary} href="/usdt-exchange">{text("Manage my listings", "إدارة عروضي")}</Link>
    </NextStep>)}
    {current && !editing && <NextStep ar={ar} title={activeTrade ? (current.state === "fulfilled" ? text("Your trade is completed", "اكتملت صفقتك") : text("Continue in your Trade Room", "تابع في غرفة الصفقة")) : current.state === "paused" ? text("Review the price before continuing", "راجع السعر قبل المتابعة") : current.state !== "open" ? text("This request is closed", "هذا الطلب مغلق") : current.isMine ? (activeOffers.length ? text("Compare your seller responses", "قارن ردود البائعين") : text("Your request is waiting for sellers", "طلبك بانتظار البائعين")) : ownResponse ? text("Your response is waiting for the buyer", "ردك بانتظار المشتري") : text("Send the buyer your price", "أرسل سعرك للمشتري")}>
      <p>{activeTrade ? (current.state === "fulfilled" ? text("Open the Trade Room to review the completed trade and its final details.", "افتح غرفة الصفقة لمراجعة الصفقة المكتملة وتفاصيلها النهائية.") : text("Follow the next instruction in the Trade Room to continue this trade.", "اتبع الخطوة التالية في غرفة الصفقة لمتابعة هذه الصفقة.")) : current.state === "paused" ? (current.isMine ? text("Matching pauses when the quote is unavailable or the price leaves the allowed range. Refresh the quote, or update and renew your request. Prices never change automatically.", "تتوقف المطابقة عندما لا يتوفر سعر مرجعي أو يكون السعر خارج النطاق المسموح. حدّث السعر المرجعي أو عدّل طلبك وجدّده. لا تتغير الأسعار تلقائيًا.") : text("This request is paused until a fresh quote is available and the buyer’s price is in range. Refresh later or browse other open requests.", "هذا الطلب متوقف حتى يتوفر سعر مرجعي حديث ويكون سعر المشتري ضمن النطاق. حدّث لاحقًا أو تصفح الطلبات المفتوحة الأخرى.")) : current.state !== "open" ? (current.isMine ? text("Review and renew it when you are ready to buy again. Existing responses stay in your history.", "راجعه وجدّده عندما تكون مستعدًا للشراء مجددًا. تبقى الردود السابقة في السجل.") : text("You can browse other open buyer requests.", "يمكنك تصفح طلبات المشترين المفتوحة الأخرى.")) : current.isMine ? (activeOffers.length ? text("Each response shows your full payment including the buyer fee. Choose Review response to check the details and wallet before opening a trade.", "يعرض كل رد إجمالي دفعتك شاملًا رسوم المشتري. اختر مراجعة الرد للتحقق من التفاصيل والمحفظة قبل فتح الصفقة.") : text("Eligible sellers can see your request. Responses refresh automatically here. You can update or cancel the request while you wait.", "يمكن للبائعين المؤهلين مشاهدة طلبك. تتحدث الردود هنا تلقائيًا. يمكنك تحديث الطلب أو إلغاؤه أثناء الانتظار.")) : ownResponse ? text("The buyer must review your response before a trade opens. You can update your price below or withdraw the response.", "يجب أن يراجع المشتري ردك قبل فتح الصفقة. يمكنك تحديث سعرك أدناه أو سحب الرد.") : text("Use an approved listing that covers the full amount and matches the payment method, network and meeting city when needed.", "استخدم عرضًا معتمدًا يغطي كامل الكمية ويتوافق مع طريقة الدفع والشبكة ومدينة اللقاء عند الحاجة.")}</p>
    </NextStep>}
    {editing && <RequestForm ar={ar} terms={terms} setTerms={next => { setTerms(next); setError(""); }} cash={cash} setCash={setCash} reference={reference} publishing={data?.publishing} busy={busy} renewing={Boolean(editingRequest)} stale={staleEditor} now={now} onSubmit={submitTerms} onClose={() => { setEditing(false); setEditingRequest(null); }} onReload={() => { if (current) editRequest(current); }} />}
    {data?.requests.map(d => <article data-testid="request-card" key={d.id} className={panel}>
      <div className="flex flex-wrap justify-between gap-4"><div className="min-w-0 max-w-full">{d.requester ? <RequestCounterpartyIdentity identity={d.requester} locale={locale} audience="buyer" /> : <p className="text-sm text-gray-400">{d.requesterName}</p>}<h2 className="mt-2 text-[clamp(1.125rem,5vw,1.875rem)] font-semibold tabular-nums text-emerald-300 [overflow-wrap:anywhere]"><bdi dir="ltr">{formatUsdt(d.amount)} <span className="text-lg">USDT</span></bdi></h2><p className="mt-2 text-gray-300"><bdi dir="ltr" className="font-medium tabular-nums text-emerald-300">₪{formatIls(d.price)}</bdi> {text("per USDT", "لكل USDT")}</p></div><RequestStatus state={d.state} ar={ar} /></div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-300">{[paymentLabel(d.paymentMethod, ar), d.network, d.city].filter(Boolean).map(label => <span key={label} className="min-w-0 max-w-full rounded-lg bg-white/5 px-3 py-2 [overflow-wrap:anywhere]">{label}</span>)}</div>
      <p className="mt-4 text-sm text-gray-300">{text("At requested price, incl. 1% buyer fee", "بالسعر المطلوب، شامل رسوم المشتري 1%")}: <bdi dir="ltr" className="font-semibold tabular-nums text-emerald-300">₪{formatIls(calculateTradePaymentTotal(d.amount, d.price, true))}</bdi></p>
      <p className="mt-2 text-xs text-gray-400">{["open", "paused"].includes(d.state) ? text("Expires", "ينتهي") : text("Updated", "تم التحديث")}: {new Date(["open", "paused"].includes(d.state) ? d.expiresAt : d.updatedAt).toLocaleString(ar ? "ar" : "en", { dateStyle: "medium", timeStyle: "short" })}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {!demandId && <Link className={d.purchaseRequestId ? secondary : primary} href={"/usdt-exchange/requests/" + encodeURIComponent(d.id)}>{d.isMine ? text("View request & responses", "عرض الطلب والردود") : text("View & respond", "عرض وإرسال رد")}</Link>}
        {d.purchaseRequestId && <Link className={primary} href={"/trade-room/" + encodeURIComponent(d.purchaseRequestId)}>{d.state === "trade_cancelled" ? text("View previous Trade Room", "عرض غرفة الصفقة السابقة") : text("Open Trade Room", "فتح غرفة الصفقة")}</Link>}
        {demandId && canEdit && <><button className={secondary} disabled={busy} onClick={() => editRequest(d)}>{text("Update / renew", "تحديث / تجديد")}</button>{["open", "paused"].includes(d.state) && confirmation?.kind !== "cancel" && <button className={secondary} disabled={busy} onClick={() => setConfirmation({ kind: "cancel", id: d.id, revision: d.revision })}>{text("Cancel request", "إلغاء الطلب")}</button>}</>}
      </div>
      {confirmation?.kind === "cancel" && confirmation.id === d.id && <div className="mt-4 space-y-3 rounded-xl border border-amber-300/20 p-4"><p className="text-sm">{text("Cancel this request? Sellers will no longer be able to respond. You can renew it later.", "هل تريد إلغاء هذا الطلب؟ لن يتمكن البائعون من الرد. يمكنك تجديده لاحقًا.")}</p><div className="flex flex-wrap gap-3"><button disabled={busy} className={secondary} onClick={() => setConfirmation(null)}>{text("Keep request", "إبقاء الطلب")}</button><button disabled={busy} className={primary} onClick={() => void confirmAction()}>{text("Confirm cancellation", "تأكيد الإلغاء")}</button></div></div>}
    </article>)}
    {data && !data.requests.length && scope === "mine" && <p className="text-sm text-gray-400">{text("Your requests and their history will appear here.", "ستظهر طلباتك وسجلها هنا.")}</p>}
    {data?.nextCursor && <button className={secondary} disabled={busy} onClick={() => void run(async isCurrent => {
      const next = await api<DemandWorkspace>(url + "&cursor=" + encodeURIComponent(data.nextCursor!));
      if (!isCurrent()) return;
      if (next.actorId !== actorId) { setInvalidActor(actorId); setData(null); return; }
      const requests = mergeRequests([...data.requests, ...next.requests]); loadedLimit.current = requests.length;
      setData({ ...next, requests });
    })}>{text("Load more", "تحميل المزيد")}</button>}
    {current && !current.isMine && current.state === "open" && data?.canRespond && <SellerResponseForm ar={ar} current={current} listings={data.listings} reference={reference} listingId={listingId} offerPrice={offerPrice} busy={busy} ready={Boolean(responseRequest && responseRequest.id === current.id && responseRequest.revision === current.revision)} now={now} onListingChange={id => { setListingId(id); setOfferPrice(id ? current.price : ""); setResponseRequest(id ? { id: current.id, revision: current.revision } : null); setError(""); }} onPriceChange={price => { setOfferPrice(price); setError(""); }} onSubmit={submitResponse} />}
    {current && <section className="space-y-4" aria-label={text("Seller responses", "ردود البائعين")}><h2 className="text-xl font-semibold">{text("Seller responses", "ردود البائعين")}{activeOffers.length > 0 && <span className="ms-2 text-sm text-gray-400">({activeOffers.length})</span>}</h2>
      {!activeOffers.length && <p className="text-sm text-gray-400">{current.state === "open" ? text("No active responses yet.", "لا توجد ردود نشطة بعد.") : text("There are no active responses for this request.", "لا توجد ردود نشطة لهذا الطلب.")}</p>}
      {activeOffers.map(renderOffer)}
      {pastOffers.length > 0 && <details open={pastOffers.some(o => o.id === selectedOfferId)} className="space-y-4"><summary className="min-h-12 cursor-pointer py-3 text-sm text-gray-400">{text("Response history", "سجل الردود")} ({pastOffers.length})</summary>{pastOffers.map(renderOffer)}</details>}
    </section>}
    {current && reviewOffer && <form id="trade-review" aria-label={text("Trade review", "مراجعة الصفقة")} className={panel + " scroll-mt-24 border-amber-300/40"} onSubmit={e => {
      e.preventDefault(); if (!e.currentTarget.reportValidity() || !reviewReady) return;
      void run(async isCurrent => {
        const result = await api<{ destination: string }>("/api/alpha-exchange/purchase-requests", { method: "POST", body: JSON.stringify({
          listingId: reviewOffer.listingId, usdtAmount: current.amount, receivingNetwork: current.network, paymentMethod: current.paymentMethod,
          buyerReceivingWalletAddress: normalizeWalletAddress(wallet), feePolicyVersion: "buyer_seller_1pct_v1", usdtDemandId: current.id,
          usdtDemandOfferId: reviewOffer.id, usdtDemandRevision: current.revision, safetyAcknowledged: safety,
          bankName: bank, cardlessWithdrawalCode: code, cardlessVerificationKind: kind, cardlessVerificationValue: verification,
          cardlessIlsAmount: current.paymentMethod === "Cardless ATM Withdrawal" ? reviewTotal : undefined,
        }) });
        if (isCurrent()) router.push(result.destination);
      });
    }}>
      <fieldset disabled={busy} className="space-y-5">
        <legend className="mb-4 text-xl font-semibold" tabIndex={-1}>{text("Review and open trade", "راجع وافتح الصفقة")}</legend>
        {reviewedIdentity ? <RequestCounterpartyIdentity identity={reviewedIdentity} locale={locale} audience="seller" /> : <p className="font-medium">{reviewOffer.sellerName}</p>}
        <p className="text-sm text-gray-300 [overflow-wrap:anywhere]">{paymentLabel(current.paymentMethod, ar)} · {current.network}{current.city ? " · " + current.city : ""}</p>
        <FeeBreakdown amount={current.amount} price={reviewOffer.price} ar={ar} title={text("Your final payment", "دفعتك النهائية")} />
        <label className="block">{text("Your receiving wallet", "محفظتك المستلمة")} ({current.network})
          <input required className={field} dir="ltr" autoComplete="off" spellCheck={false} maxLength={200} aria-invalid={Boolean(walletError)} aria-describedby="wallet-help" value={wallet} onChange={e => { setWallet(e.target.value); setError(""); }} />
        </label>
        <p id="wallet-help" className={"text-sm " + (walletError ? "text-red-200" : "text-gray-400")}>{walletError ? text("Enter a valid wallet address for " + current.network + ".", "أدخل عنوان محفظة صالحًا لشبكة " + current.network + ".") : text("Use your own receiving address on " + current.network + ". The network must match your wallet.", "استخدم عنوان محفظتك المستلمة على " + current.network + ". يجب أن تتطابق الشبكة مع محفظتك.")}</p>
        {current.paymentMethod === "Cardless ATM Withdrawal" && <>
          <label className="block">{text("Issuing bank", "البنك المصدر")}<select required className={field} value={bank} onChange={e => setBank(e.target.value)}><option value="">{text("Select your bank", "اختر بنكك")}</option>{getCardlessWithdrawalBankOptions().map(b => <option key={b.code} value={b.name}>{ar ? b.nameAr : b.name}</option>)}</select></label>
          <CardlessWithdrawalFields isAr={ar} phase="request" disabled={busy} code={code} verificationKind={kind} verificationValue={verification} onCodeChange={setCode} onKindChange={setKind} onValueChange={setVerification} />
        </>}
        <label className="flex items-start gap-3 text-sm leading-6 text-gray-300"><input type="checkbox" required className="mt-1 h-5 w-5 shrink-0 accent-amber-300" checked={safety} onChange={e => setSafety(e.target.checked)} /><span>{text("I checked the amount, price, payment method and wallet network. I will follow the instructions in the Trade Room.", "راجعت المبلغ والسعر وطريقة الدفع وشبكة المحفظة. سألتزم بتعليمات غرفة الصفقة.")}</span></label>
        <p className="rounded-xl bg-white/5 p-4 text-sm leading-6 text-gray-300">{text("Opening the Trade Room does not send a payment. The seller reviews the trade there, and the room shows you what to do next.", "فتح غرفة الصفقة لا يرسل دفعة. يراجع البائع الصفقة هناك، وتوضح لك الغرفة الخطوة التالية.")}</p>
        {!reviewReady && <p className="text-sm text-amber-200">{reviewHelp}</p>}
        <div className="flex flex-wrap gap-3"><button className={primary} disabled={busy || !reviewReady}>{busy ? text("Opening trade…", "جارٍ فتح الصفقة…") : text("Open Trade Room", "فتح غرفة الصفقة")}</button><button type="button" className={secondary} disabled={busy} onClick={clearReview}>{text("Back to responses", "العودة إلى الردود")}</button></div>
      </fieldset>
    </form>}
  </main>;
}
