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
  wiseDraftEnabled?: boolean;
  publishing?: DemandWorkspace["publishing"];
  busy: boolean;
  mode: "create" | "edit" | "renew";
  expiresAt?: string;
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

export function RequestForm({ ar, terms, setTerms, cash, setCash, reference, wiseDraftEnabled = false, publishing, busy, mode, expiresAt, stale, now, onSubmit, onClose, onReload }: RequestFormProps) {
  const [submissionError, setSubmissionError] = useState("");
  const [amountKey, setAmountKey] = useState(0);
  const [priceKey, setPriceKey] = useState(0);
  const text = (en: string, arabic: string) => ar ? arabic : en;
  const atm = terms.paymentMethod === "Cardless ATM Withdrawal";
  const meeting = terms.paymentMethod === "Face-to-Face (Meet in Person)";
  const wise = terms.bankTransferProvider === "wise";
  const prefix = wise ? "USD " : "₪";
  const formTerms = { ...terms, amount: atm ? calculateCardlessUsdtAmount(cash, terms.price, true) ?? "" : terms.amount };
  const amountValid = amountPattern.test(formTerms.amount) && /[1-9]/.test(formTerms.amount);
  const priceValid = pricePattern.test(terms.price) && /[1-9]/.test(terms.price);
  const priceCents = priceValid ? cents(terms.price) : null;
  const minimum = reference ? cents(reference.minimum) : null;
  const maximum = reference ? cents(reference.maximum) : null;
  const quoteAvailable = wise ? wiseDraftEnabled : reference !== null && minimum !== null && maximum !== null;
  const priceInRange = priceCents !== null && (wise ? priceCents > BigInt(0) : quoteAvailable && priceCents >= minimum! && priceCents <= maximum!);
  const total = amountValid && priceValid ? calculateTradePaymentTotal(formTerms.amount, terms.price, true) : null;
  const totalCents = total ? cents(total) : null;
  const city = terms.city.trim();
  const cityValid = !meeting || (city.length >= 2 && city.length <= 80 && cityPattern.test(city) && /\p{L}/u.test(city));
  const amountError = amountValid ? "" : atm
    ? text("Choose an ATM cash total and a valid price to calculate your USDT.", "اختر إجمالي النقد وسعرًا صالحًا لحساب كمية USDT.")
    : text("Enter a positive USDT amount, with up to 9 whole digits and 6 decimal places.", "أدخل كمية USDT أكبر من صفر، حتى 9 أرقام صحيحة و6 منازل عشرية.");
  const priceError = !priceValid
    ? text("Enter a positive price with up to 2 decimal places.", "أدخل سعرًا أكبر من صفر حتى منزلتين عشريتين.")
    : !wise && quoteAvailable && !priceInRange
      ? text(`Choose a price between ₪${formatIls(reference!.minimum)} and ₪${formatIls(reference!.maximum)}.`, `اختر سعرًا بين ₪${formatIls(reference!.minimum)} و₪${formatIls(reference!.maximum)}.`)
      : "";
  const cityError = cityValid ? "" : text("Enter a meeting city using letters (2–80 characters).", "أدخل مدينة اللقاء باستخدام الحروف (من 2 إلى 80 حرفًا).");
  const nextAllowed = publishing?.nextAllowedAt ? Date.parse(publishing.nextAllowedAt) : 0;
  const wait = Number.isFinite(nextAllowed) ? Math.max(0, nextAllowed - now) : 0;
  const waitLabel = countdown(wait);
  const editing = mode === "edit";
  const expired = editing && !(expiresAt && Date.parse(expiresAt) > now);
  const disabledReason = stale ? text("This request changed. Reload the latest details before saving.", "تغيّر هذا الطلب. أعد تحميل أحدث التفاصيل قبل الحفظ.")
    : busy ? text("Saving your request…", "جارٍ حفظ طلبك…")
      : expired ? text("This request expired while you were editing. Close this form and choose Publish again to use a new slot.", "انتهت صلاحية الطلب أثناء التعديل. أغلق النموذج واختر النشر مجددًا لاستخدام فرصة نشر جديدة.")
        : !quoteAvailable ? (wise ? text("Wise USD transfers are unavailable.", "تحويلات Wise بالدولار غير متاحة.") : text("Waiting for a fresh price reference. Please try again shortly.", "بانتظار مرجع سعر حديث. حاول مجددًا بعد قليل."))
        : !editing && publishing?.openRequestId ? text("You already have an open request. Edit or cancel it before publishing another.", "لديك طلب مفتوح بالفعل. عدّله أو ألغِه قبل نشر طلب آخر.")
          : !editing && wait > 0 ? text(`You can publish again in ${waitLabel}.`, `يمكنك النشر مجددًا خلال ${waitLabel}.`)
            : !editing && publishing?.remaining === 0 ? text("You have used both request slots in the last 24 hours. Your current open request can still be edited.", "استخدمت فرصتي النشر خلال آخر 24 ساعة. لا يزال بإمكانك تعديل طلبك المفتوح الحالي.")
              : amountError || priceError || cityError
                || (totalCents === null || totalCents < BigInt(1) ? text(`The payment total must be at least ${prefix}0.01.`, `يجب أن يكون إجمالي الدفع ${prefix}0.01 على الأقل.`) : "")
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
      <div><h2 className="text-xl font-semibold">{editing ? text("Edit your request", "تعديل طلبك") : mode === "renew" ? text("Publish your request again", "نشر طلبك مجددًا") : text("Your request", "طلبك")}</h2>
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
          <select id="request-payment" className={field} value={terms.paymentMethod} onChange={event => setTerms({ ...terms, paymentMethod: event.target.value as DemandTerms["paymentMethod"], city: event.target.value === "Face-to-Face (Meet in Person)" ? terms.city : "", ...(wise ? { currency: undefined, bankTransferProvider: undefined, price: "" } : {}) })}>
            {paymentMethods.map(method => <option key={method} value={method}>{paymentLabel(method, ar)}</option>)}
          </select><p className="mt-2 text-xs leading-5 text-gray-400">{text("Choose how you will pay the seller.", "اختر كيفية دفع المبلغ للبائع.")}</p>
        </div>
        {terms.paymentMethod === "Bank Transfer" && (wiseDraftEnabled || wise) && <div>
          <label htmlFor="request-bank-provider" className="text-sm font-medium">{text("Bank transfer provider", "مزود التحويل البنكي")}</label>
          <select id="request-bank-provider" className={field} value={wise ? "wise" : "israeli_bank"} onChange={event => setTerms({ ...terms, bankTransferProvider: event.target.value === "wise" ? "wise" : undefined, currency: event.target.value === "wise" ? "USD" : undefined, price: "" })}>
            <option value="israeli_bank">{text("Israeli bank · ILS", "بنك إسرائيلي · شيكل")}</option>
            <option value="wise" disabled={!wiseDraftEnabled}>Wise · USD</option>
          </select>
          <p className="mt-2 text-xs leading-5 text-gray-400">{text("Changing the currency clears the price. Enter a new price in the selected currency.", "يؤدي تغيير العملة إلى مسح السعر. أدخل سعرًا جديدًا بالعملة المحددة.")}</p>
        </div>}
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
          <div role="group" className="mt-2 flex flex-wrap gap-2" aria-label={text("Quick amounts", "كميات سريعة")}>{["500", "1000", "5000"].map(amount => <button key={amount} type="button" className="min-h-11 rounded-lg border border-blue-400/30 bg-blue-400/[0.06] px-3 text-xs tabular-nums text-emerald-300 hover:border-blue-300/60 hover:bg-blue-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" onClick={() => { setTerms({ ...terms, amount }); setAmountKey(key => key + 1); setSubmissionError(""); }}>{formatUsdt(amount)} USDT</button>)}</div>
          <p id="request-amount-help" className="mt-2 text-xs leading-5 text-gray-400">{text("Enter the full amount you want to receive, with up to 6 decimal places.", "أدخل كامل الكمية التي تريد استلامها، حتى 6 منازل عشرية.")}</p>
        </div>}
        <div><label htmlFor="request-price" className="text-sm font-medium">{wise ? text("Requested price per USDT (USD)", "السعر المطلوب لكل USDT (USD)") : text("Requested price per USDT (ILS)", "السعر المطلوب لكل USDT (شيكل)")}</label>
          <GroupedDecimalInput key={`${priceKey}:${wise}`} id="request-price" className={moneyField} required value={terms.price} onValueChange={price => { setTerms({ ...terms, price }); setSubmissionError(""); }} maxIntegerDigits={4} maxFractionDigits={2} placeholder={wise ? "1.00" : "3.30"} autoComplete="off" aria-describedby="request-price-help" aria-invalid={Boolean(terms.price && priceError) || undefined} />
          {!wise && <button type="button" className="mt-2 min-h-11 rounded-lg px-2 text-xs font-medium text-blue-300 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-40" disabled={!quoteAvailable} onClick={() => { if (reference) { setTerms({ ...terms, price: formatIls(reference.price).replace(/,/g, "") }); setPriceKey(key => key + 1); setSubmissionError(""); } }}>{text("Use reference price", "استخدام السعر المرجعي")}</button>}
          <p id="request-price-help" className="mt-2 text-xs leading-5 text-gray-400"><RequestMoneyText>{wise ? text("Enter your requested USD price. This is a negotiated price, not a currency conversion or a guaranteed USDT/USD rate.", "أدخل السعر المطلوب بالدولار. هذا سعر تفاوضي وليس تحويل عملة أو سعر USDT/USD مضمونًا.") : quoteAvailable ? text(`Allowed price: ₪${formatIls(reference!.minimum)}–₪${formatIls(reference!.maximum)}. Your price never changes automatically.`, `السعر المسموح: ₪${formatIls(reference!.minimum)}–₪${formatIls(reference!.maximum)}. لا يتغير سعرك تلقائيًا.`) : text("A fresh reference is needed before publishing.", "يلزم مرجع سعر حديث قبل النشر.")}</RequestMoneyText></p>
        </div>
        {meeting && <div className="sm:col-span-2"><label htmlFor="request-city" className="text-sm font-medium">{text("Meeting city", "مدينة اللقاء")}</label>
          <input id="request-city" className={field} required minLength={2} maxLength={80} autoComplete="address-level2" value={terms.city} onChange={event => setTerms({ ...terms, city: event.target.value })} aria-describedby="request-city-help" aria-invalid={Boolean(terms.city && cityError) || undefined} />
          <p id="request-city-help" className="mt-2 text-xs leading-5 text-gray-400">{text("Sellers must be available in this city. Share the exact meeting place later in the Trade Room.", "يجب أن يتوفر البائع في هذه المدينة. شارك مكان اللقاء بالتحديد لاحقًا في غرفة الصفقة.")}</p>
        </div>}
      </div>
      <FeeBreakdown amount={amountValid ? formTerms.amount : ""} price={priceValid ? terms.price : ""} currency={wise ? "USD" : "ILS"} ar={ar} title={text("Estimated payment", "الدفع المتوقع")} />
    </fieldset>
    <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-gray-400">
      {editing ? <><p className="font-medium text-gray-200">{text("Editing is free and keeps your original expiry time. It does not use another request slot.", "التعديل مجاني ويحافظ على وقت الانتهاء الأصلي، ولا يستخدم فرصة نشر أخرى.")}</p><p>{text("Sellers must respond to the updated terms. Once you select a response and open a trade, the request is locked.", "يجب على البائعين الرد على الشروط المعدّلة. عند اختيار رد وفتح صفقة، يُقفل الطلب.")}</p></> : <><p>{text("Free to post · 12 hours per request · One open request at a time. A match is not guaranteed.", "النشر مجاني · 12 ساعة لكل طلب · طلب مفتوح واحد في كل مرة. إيجاد بائع غير مضمون.")}</p><p>{text("Two publications in any 24 hours, with 5 minutes between them. Publishing again uses a slot; cancelling does not return it.", "عمليتا نشر خلال أي 24 ساعة، مع 5 دقائق بينهما. النشر مجددًا يستخدم فرصة، والإلغاء لا يعيدها.")}</p></>}
      {publishing && <p className="mt-2 font-medium text-gray-200">{text(`${Math.max(0, Math.min(2, publishing.remaining))} of 2 request slots remaining in the last 24 hours.`, `متبقٍ ${Math.max(0, Math.min(2, publishing.remaining))} من أصل فرصتي نشر خلال آخر 24 ساعة.`)}</p>}
      {editing && expiresAt && <p className="mt-2">{text("Original expiry", "وقت الانتهاء الأصلي")}: <time dateTime={expiresAt}>{new Date(expiresAt).toLocaleString(ar ? "ar" : "en", { dateStyle: "medium", timeStyle: "short" })}</time></p>}
    </div>
    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      <button type="submit" className={primary} disabled={Boolean(disabledReason)} aria-describedby={disabledReason || submissionError ? "request-submit-help" : undefined}>{busy ? text("Saving…", "جارٍ الحفظ…") : editing ? text("Save changes", "حفظ التغييرات") : mode === "renew" ? text("Publish again", "النشر مجددًا") : text("Publish request", "نشر الطلب")}</button>
      <button type="button" className={secondary} onClick={onClose} disabled={busy}>{text("Close", "إغلاق")}</button>
    </div>
    {(disabledReason || submissionError) && <p id="request-submit-help" role={submissionError ? "alert" : undefined} className="mt-3 text-sm leading-6 text-amber-200"><RequestMoneyText>{disabledReason || submissionError}</RequestMoneyText></p>}
  </form>;
}
