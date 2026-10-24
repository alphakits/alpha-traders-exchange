"use client";

import { useState, type FormEvent } from "react";
import { calculateCardlessUsdtAmount, calculateTradePaymentTotal, parseCardlessCashAmount } from "@alpha-traders/contracts";
import { formatIls, formatUsdt } from "@/lib/usdt-demand-format";
import type { DemandTerms, DemandWorkspace } from "@/types/usdt-demand";
import { GroupedDecimalInput } from "./usdt-number-input";
import { FeeBreakdown, RequestMoneyText, paymentLabel, requestField as field, requestMoneyField as moneyField, requestPanel as panel, requestPrimary as primary, requestSecondary as secondary } from "./usdt-request-details";

export type RequestFormProps = {
  ar: boolean;
  terms: DemandTerms;
  setTerms: (terms: DemandTerms) => void;
  cash: string;
  setCash: (cash: string) => void;
  reference: DemandWorkspace["reference"];
  publishing?: DemandWorkspace["publishing"];
  busy: boolean;
  renewing: boolean;
  stale: boolean;
  now: number;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onReload: () => void;
};

const paymentMethods: DemandTerms["paymentMethod"][] = ["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"];
const networks: DemandTerms["network"][] = ["TRC20", "BEP20", "ERC20", "SOL"];
const cashOptions = Array.from({ length: 100 }, (_, index) => String((index + 1) * 100));
const amountPattern = /^\d{1,9}(?:\.\d{1,6})?$/;
const pricePattern = /^\d{1,4}(?:\.\d{1,2})?$/;
const cityPattern = /^[\p{L}\p{M}\s.,'’\-]*$/u;

function cents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}

function countdown(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RequestForm({ ar, terms, setTerms, cash, setCash, reference, publishing, busy, renewing, stale, now, onSubmit, onClose, onReload }: RequestFormProps) {
  const [submissionError, setSubmissionError] = useState("");
  const [amountKey, setAmountKey] = useState(0);
  const [priceKey, setPriceKey] = useState(0);
  const text = (en: string, arabic: string) => ar ? arabic : en;
  const atm = terms.paymentMethod === "Cardless ATM Withdrawal";
  const meeting = terms.paymentMethod === "Face-to-Face (Meet in Person)";
  const formTerms = { ...terms, amount: atm ? calculateCardlessUsdtAmount(cash, terms.price, true) ?? "" : terms.amount };
  const amountValid = amountPattern.test(formTerms.amount) && /[1-9]/.test(formTerms.amount);
  const priceValid = pricePattern.test(terms.price) && /[1-9]/.test(terms.price);
  const priceCents = priceValid ? cents(terms.price) : null;
  const minimum = reference ? cents(reference.minimum) : null;
  const maximum = reference ? cents(reference.maximum) : null;
  const quoteAvailable = reference !== null && minimum !== null && maximum !== null;
  const priceInRange = quoteAvailable && priceCents !== null && priceCents >= minimum! && priceCents <= maximum!;
  const total = amountValid && priceValid ? calculateTradePaymentTotal(formTerms.amount, terms.price, true) : null;
  const totalCents = total ? cents(total) : null;
  const city = terms.city.trim();
  const cityValid = !meeting || (city.length >= 2 && city.length <= 80 && cityPattern.test(city) && /\p{L}/u.test(city));
  const amountError = amountValid ? "" : atm
    ? text("Choose an ATM cash total and a valid price to calculate your USDT.", "اختر إجمالي النقد وسعرًا صالحًا لحساب كمية USDT.")
    : text("Enter a positive USDT amount, with up to 9 whole digits and 6 decimal places.", "أدخل كمية USDT أكبر من صفر، حتى 9 أرقام صحيحة و6 منازل عشرية.");
  const priceError = !priceValid
    ? text("Enter a positive price with up to 2 decimal places.", "أدخل سعرًا أكبر من صفر حتى منزلتين عشريتين.")
    : quoteAvailable && !priceInRange
      ? text(`Choose a price between ₪${formatIls(reference!.minimum)} and ₪${formatIls(reference!.maximum)}.`, `اختر سعرًا بين ₪${formatIls(reference!.minimum)} و₪${formatIls(reference!.maximum)}.`)
      : "";
  const cityError = cityValid ? "" : text("Enter a meeting city using letters (2–80 characters).", "أدخل مدينة اللقاء باستخدام الحروف (من 2 إلى 80 حرفًا).");
  const nextAllowed = publishing?.nextAllowedAt ? Date.parse(publishing.nextAllowedAt) : 0;
  const wait = Number.isFinite(nextAllowed) ? Math.max(0, nextAllowed - now) : 0;
  const waitLabel = countdown(wait);
  const disabledReason = stale ? text("This request changed. Reload the latest details before saving.", "تغيّر هذا الطلب. أعد تحميل أحدث التفاصيل قبل الحفظ.")
    : busy ? text("Saving your request…", "جارٍ حفظ طلبك…")
      : !quoteAvailable ? text("Waiting for a fresh price reference. Please try again shortly.", "بانتظار مرجع سعر حديث. حاول مجددًا بعد قليل.")
        : !renewing && publishing?.openRequestId ? text("You already have an open request. Update or cancel it before creating another.", "لديك طلب مفتوح بالفعل. حدّثه أو ألغِه قبل إنشاء طلب آخر.")
          : wait > 0 ? text(`You can publish or renew again in ${waitLabel}.`, `يمكنك النشر أو التجديد مجددًا خلال ${waitLabel}.`)
            : publishing?.remaining === 0 ? text("You have used all 5 publishes or renewals in the last 24 hours. Wait for your limit to reset.", "استخدمت عمليات النشر أو التجديد الخمس خلال آخر 24 ساعة. انتظر حتى يتجدد الحد.")
              : amountError || priceError || cityError
                || (totalCents === null || totalCents < BigInt(1) ? text("The payment total must be at least ₪0.01.", "يجب أن يكون إجمالي الدفع ₪0.01 على الأقل.") : "")
                || (atm && (!parseCardlessCashAmount(cash) || parseCardlessCashAmount(total) !== parseCardlessCashAmount(cash))
                  ? text("Choose an ATM cash total from ₪100 to ₪10,000 in ₪100 steps.", "اختر إجمالي نقد من ₪100 إلى ₪10,000 بمضاعفات ₪100.") : "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const valid = event.currentTarget.reportValidity();
    if (!valid || disabledReason) return;
    setSubmissionError("");
    onSubmit(event);
  }

  return <form id="request-form" aria-label={text("Request details", "تفاصيل الطلب")} dir={ar ? "rtl" : "ltr"} className={`${panel} scroll-mt-24`} onSubmit={submit}
    onInput={() => setSubmissionError("")} onChange={() => setSubmissionError("")}
    onInvalidCapture={event => setSubmissionError(ar ? "صحّح الحقل المحدد قبل المتابعة." : (event.target as HTMLInputElement).validationMessage)}>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-xl font-semibold">{renewing ? text("Update and renew", "تحديث وتجديد") : text("Your request", "طلبك")}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-400">{text("Set the amount and price you want. Sellers can respond with their prices.", "حدّد الكمية والسعر المطلوبين. يمكن للبائعين الرد بأسعارهم.")}</p></div>
      <span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-300">{text("Free to post", "النشر مجاني")}</span>
    </div>
    {stale && <div role="alert" className="mb-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4">
      <p className="text-sm leading-6 text-amber-100">{text("This request changed. Reload the latest details before saving.", "تغيّر هذا الطلب. أعد تحميل أحدث التفاصيل قبل الحفظ.")}</p>
      <button type="button" className={`${secondary} mt-3`} onClick={onReload} disabled={busy}>{text("Reload latest details", "إعادة تحميل أحدث التفاصيل")}</button>
    </div>}
    <fieldset disabled={busy || stale} className="min-w-0 space-y-6">
      <legend className="sr-only">{text("Request terms", "شروط الطلب")}</legend>
      <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
        <div><label htmlFor="request-payment" className="text-sm font-medium">{text("Payment method", "طريقة الدفع")}</label>
          <select id="request-payment" className={field} value={terms.paymentMethod} onChange={event => setTerms({ ...terms, paymentMethod: event.target.value as DemandTerms["paymentMethod"], city: event.target.value === "Face-to-Face (Meet in Person)" ? terms.city : "" })}>
            {paymentMethods.map(method => <option key={method} value={method}>{paymentLabel(method, ar)}</option>)}
          </select><p className="mt-2 text-xs leading-5 text-gray-400">{text("Choose how you will pay the seller.", "اختر كيفية دفع المبلغ للبائع.")}</p>
        </div>
        <div><label htmlFor="request-network" className="text-sm font-medium">{text("Network", "الشبكة")}</label>
          <select id="request-network" className={field} value={terms.network} onChange={event => setTerms({ ...terms, network: event.target.value as DemandTerms["network"] })}>{networks.map(network => <option key={network}>{network}</option>)}</select>
          <p className="mt-2 text-xs leading-5 text-gray-400">{text("Use the network supported by your receiving wallet.", "اختر الشبكة التي تدعمها محفظتك المستلمة.")}</p>
        </div>
        {atm ? <div><label htmlFor="request-cash" className="text-sm font-medium">{text("ATM cash total incl. 1% fee (ILS)", "إجمالي النقد شامل رسوم 1% (شيكل)")}</label>
          <select id="request-cash" className={moneyField} value={cash} onChange={event => setCash(event.target.value)} aria-describedby="request-amount-help">{cashOptions.map(amount => <option key={amount} value={amount}>₪{formatIls(amount)}</option>)}</select>
          <p id="request-amount-help" className="mt-2 text-xs leading-5 text-gray-400">{text("Choose the exact cash amount. Your USDT is calculated after including the buyer fee.", "اختر مبلغ النقد بالضبط. تُحسب كمية USDT بعد احتساب رسوم المشتري.")}</p>
          <p className="mt-2 text-sm text-emerald-300"><bdi dir="ltr">{formatUsdt(formTerms.amount)} USDT</bdi></p>
        </div> : <div><label htmlFor="request-amount" className="text-sm font-medium">{text("Amount (USDT)", "المبلغ (USDT)")}</label>
          <GroupedDecimalInput key={amountKey} id="request-amount" className={moneyField} required value={terms.amount} onValueChange={amount => { setTerms({ ...terms, amount }); setSubmissionError(""); }} maxIntegerDigits={9} maxFractionDigits={6} placeholder="5,000" autoComplete="off" aria-describedby="request-amount-help" aria-invalid={Boolean(terms.amount && amountError) || undefined} />
          <div className="mt-2 flex flex-wrap gap-2" aria-label={text("Quick amounts", "كميات سريعة")}>{["500", "1000", "5000"].map(amount => <button key={amount} type="button" className="min-h-11 rounded-lg border border-blue-400/30 bg-blue-400/[0.06] px-3 text-xs tabular-nums text-emerald-300 hover:border-blue-300/60 hover:bg-blue-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" onClick={() => { setTerms({ ...terms, amount }); setAmountKey(key => key + 1); setSubmissionError(""); }}>{formatUsdt(amount)} USDT</button>)}</div>
          <p id="request-amount-help" className="mt-2 text-xs leading-5 text-gray-400">{text("Enter the full amount you want to receive, with up to 6 decimal places.", "أدخل كامل الكمية التي تريد استلامها، حتى 6 منازل عشرية.")}</p>
        </div>}
        <div><label htmlFor="request-price" className="text-sm font-medium">{text("Requested price per USDT (ILS)", "السعر المطلوب لكل USDT (شيكل)")}</label>
          <GroupedDecimalInput key={priceKey} id="request-price" className={moneyField} required value={terms.price} onValueChange={price => { setTerms({ ...terms, price }); setSubmissionError(""); }} maxIntegerDigits={4} maxFractionDigits={2} placeholder="3.30" autoComplete="off" aria-describedby="request-price-help" aria-invalid={Boolean(terms.price && priceError) || undefined} />
          <button type="button" className="mt-2 min-h-11 rounded-lg px-2 text-xs font-medium text-blue-300 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-40" disabled={!quoteAvailable} onClick={() => { if (reference) { setTerms({ ...terms, price: formatIls(reference.price).replace(/,/g, "") }); setPriceKey(key => key + 1); setSubmissionError(""); } }}>{text("Use reference price", "استخدام السعر المرجعي")}</button>
          <p id="request-price-help" className="mt-2 text-xs leading-5 text-gray-400"><RequestMoneyText>{quoteAvailable ? text(`Allowed price: ₪${formatIls(reference!.minimum)}–₪${formatIls(reference!.maximum)}. Your price never changes automatically.`, `السعر المسموح: ₪${formatIls(reference!.minimum)}–₪${formatIls(reference!.maximum)}. لا يتغير سعرك تلقائيًا.`) : text("A fresh reference is needed before publishing.", "يلزم مرجع سعر حديث قبل النشر.")}</RequestMoneyText></p>
        </div>
        {meeting && <div className="sm:col-span-2"><label htmlFor="request-city" className="text-sm font-medium">{text("Meeting city", "مدينة اللقاء")}</label>
          <input id="request-city" className={field} required minLength={2} maxLength={80} autoComplete="address-level2" value={terms.city} onChange={event => setTerms({ ...terms, city: event.target.value })} aria-describedby="request-city-help" aria-invalid={Boolean(terms.city && cityError) || undefined} />
          <p id="request-city-help" className="mt-2 text-xs leading-5 text-gray-400">{text("Sellers must be available in this city. Share the exact meeting place later in the Trade Room.", "يجب أن يتوفر البائع في هذه المدينة. شارك مكان اللقاء بالتحديد لاحقًا في غرفة الصفقة.")}</p>
        </div>}
      </div>
      <FeeBreakdown amount={amountValid ? formTerms.amount : ""} price={priceValid ? terms.price : ""} ar={ar} title={text("Estimated payment", "الدفع المتوقع")} />
    </fieldset>
    <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-gray-400">
      <p>{text("Posting is free. Requests expire after 24 hours and do not guarantee a match. Keep one open request at a time.", "النشر مجاني. تنتهي الطلبات بعد 24 ساعة ولا تضمن إيجاد بائع. يمكنك الاحتفاظ بطلب مفتوح واحد في كل مرة.")}</p>
      <p>{text("Wait 5 minutes between publishing or renewing. Maximum 5 publishes or renewals in 24 hours.", "انتظر 5 دقائق بين النشر أو التجديد. الحد الأقصى 5 عمليات نشر أو تجديد خلال 24 ساعة.")}</p>
      {publishing && <p className="mt-2 font-medium text-gray-200">{text(`${Math.max(0, publishing.remaining)} of 5 publishes or renewals remaining in this 24-hour window.`, `متبقٍ ${Math.max(0, publishing.remaining)} من أصل 5 عمليات نشر أو تجديد خلال فترة 24 ساعة الحالية.`)}</p>}
    </div>
    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      <button type="submit" className={primary} disabled={Boolean(disabledReason)} aria-describedby={disabledReason || submissionError ? "request-submit-help" : undefined}>{busy ? text("Saving…", "جارٍ الحفظ…") : renewing ? text("Save and renew", "حفظ وتجديد") : text("Publish request", "نشر الطلب")}</button>
      <button type="button" className={secondary} onClick={onClose} disabled={busy}>{text("Close", "إغلاق")}</button>
    </div>
    {(disabledReason || submissionError) && <p id="request-submit-help" role={submissionError ? "alert" : undefined} className="mt-3 text-sm leading-6 text-amber-200"><RequestMoneyText>{disabledReason || submissionError}</RequestMoneyText></p>}
  </form>;
}
