"use client";

import { useId, useReducer, type FormEvent } from "react";
import { calculateTradePaymentTotal, parseCardlessCashAmount } from "@alpha-traders/contracts";
import { Link } from "@/i18n/navigation";
import { formatIls, formatUsdt } from "@/lib/usdt-demand-format";
import type { DemandView, DemandWorkspace } from "@/types/usdt-demand";
import { FeeBreakdown, RequestMoneyText, paymentLabel, requestMoneyField, requestPanel, requestPrimary, requestSecondary } from "./usdt-request-details";
import { GroupedDecimalInput } from "./usdt-number-input";

type SellerResponseFormProps = {
  ar: boolean;
  current: DemandView;
  listings: DemandWorkspace["listings"];
  reference: DemandWorkspace["reference"];
  listingId: string;
  offerPrice: string;
  onListingChange: (id: string) => void;
  onPriceChange: (price: string) => void;
  busy: boolean;
  ready: boolean;
  now: number;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

// Mirrors respondToDemand: the cooldown includes withdrawn/superseded responses.
const responseCooldownMs = 60_000;

export function SellerResponseForm({ ar, current, listings, reference, listingId, offerPrice, onListingChange, onPriceChange, busy, ready, now, onSubmit }: SellerResponseFormProps) {
  const id = useId();
  const [priceInputRevision, resetPriceInput] = useReducer(revision => revision + 1, 0);
  const text = (en: string, arabic: string) => ar ? arabic : en;
  const ownOffers = current.offers.filter(offer => offer.isMine);
  const latestOwnOffer = ownOffers.at(-1);
  const updating = latestOwnOffer?.state === "open" && latestOwnOffer.revision === current.revision;
  const latestResponseAt = ownOffers.reduce((latest, offer) => Math.max(latest, Date.parse(offer.createdAt ?? "") || 0), 0);
  const cooldownSeconds = Math.max(0, Math.ceil((latestResponseAt + responseCooldownMs - now) / 1_000));
  const selectedListing = listings.find(listing => listing.id === listingId);
  const priceSyntaxValid = /^\d{1,4}(?:\.\d{1,2})?$/.test(offerPrice) && Number(offerPrice) > 0;
  const priceOutsideBand = priceSyntaxValid && reference !== null
    && (Number(offerPrice) < Number(reference.minimum) || Number(offerPrice) > Number(reference.maximum));
  const priceIssue = !priceSyntaxValid
    ? text("Enter a positive price with up to two decimal places.", "أدخل سعرًا موجبًا بمنزلتين عشريتين كحد أقصى.")
    : priceOutsideBand ? text(`Choose a price between ₪${formatIls(reference?.minimum)} and ₪${formatIls(reference?.maximum)}.`, `اختر سعرًا بين ₪${formatIls(reference?.minimum)} و₪${formatIls(reference?.maximum)}.`) : null;
  const paymentTotal = priceSyntaxValid ? calculateTradePaymentTotal(current.amount, offerPrice, true) : null;
  const atmInvalid = current.paymentMethod === "Cardless ATM Withdrawal" && priceSyntaxValid && !parseCardlessCashAmount(paymentTotal);
  const requestClosed = current.state !== "open" || Date.parse(current.expiresAt) <= now;
  const disabledReason = busy ? text("Sending your response…", "جارٍ إرسال ردك…")
    : requestClosed ? text("This request is no longer open. Review its current status before responding.", "هذا الطلب لم يعد مفتوحًا. راجع حالته الحالية قبل الرد.")
    : !reference ? text("Waiting for a fresh price reference. You can respond when it is available.", "بانتظار مرجع سعر حديث. يمكنك الرد عند توفره.")
    : !selectedListing || !ready ? text("Select an eligible listing for the current request to continue.", "اختر عرضًا مؤهلًا للطلب الحالي للمتابعة.")
    : priceIssue ?? (atmInvalid ? text("At this price, the total including the buyer fee must be ₪100–₪10,000 in ₪100 steps. Match the requested price or choose another compatible price.", "بهذا السعر، يجب أن يكون الإجمالي شاملًا رسوم المشتري بين ₪100 و₪10,000 وبمضاعفات ₪100. طابق السعر المطلوب أو اختر سعرًا آخر مناسبًا.")
      : cooldownSeconds > 0 ? text(`You can send another response in ${cooldownSeconds} seconds.`, `يمكنك إرسال رد آخر بعد ${cooldownSeconds} ثانية.`) : null);
  const createListingHref = `/usdt-exchange?demand=${encodeURIComponent(current.id)}#create-listing`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity() || disabledReason) return;
    onSubmit(event);
  }

  return <section className={requestPanel} dir={ar ? "rtl" : "ltr"}>
    <h2 className="text-xl font-semibold">{updating ? text("Update your response", "حدّث ردك") : text("Respond to this request", "الرد على هذا الطلب")}</h2>
    <p className="mt-2 text-sm leading-6 text-gray-300">
      {text("Offer the full requested amount:", "قدّم كامل الكمية المطلوبة:")} <bdi dir="ltr" className="font-semibold tabular-nums text-emerald-300">{formatUsdt(current.amount)} USDT</bdi>.
      {" "}{text("The buyer reviews your price before opening the Trade Room.", "يراجع المشتري سعرك قبل فتح غرفة الصفقة.")}
    </p>
    <p className="mt-2 text-xs leading-5 text-gray-400 [overflow-wrap:anywhere]">{paymentLabel(current.paymentMethod, ar)} · <bdi>{current.network}</bdi>{current.city ? <> · {current.city}</> : null}</p>

    {listings.length === 0 ? <div className="mt-5 space-y-4 rounded-xl border border-blue-400/25 bg-blue-400/[0.06] p-4">
      <h3 className="font-semibold text-blue-200">{text("No eligible listing yet", "لا يوجد عرض مؤهل بعد")}</h3>
      <p className="text-sm leading-6 text-gray-300">{text(
        "Use an approved listing with enough unreserved USDT and trade limits that cover the full amount. Its network and payment method must match; an in-person trade also needs the same city. Your account must be eligible and have capacity for another trade.",
        "استخدم عرضًا معتمدًا بكمية USDT غير محجوزة كافية وحدود تداول تشمل كامل المبلغ. يجب تطابق الشبكة ووسيلة الدفع، والمدينة أيضًا عند اللقاء الشخصي. يجب أن يكون حسابك مؤهلًا ولديك سعة لصفقة أخرى.",
      )}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Link href={createListingHref} className={requestPrimary}>{text("Create a listing for this request", "إنشاء عرض لهذا الطلب")}</Link>
        <Link href="/usdt-exchange#my-listings-section" className={requestSecondary}>{text("Manage listings", "إدارة العروض")}</Link>
      </div>
      <p className="text-xs leading-5 text-gray-400">{text("New listings require owner approval. Return here after approval to send your response.", "تحتاج العروض الجديدة إلى موافقة المالك. عد إلى هنا بعد الموافقة لإرسال ردك.")}</p>
    </div> : <form aria-label={text("Seller response", "رد البائع")} aria-busy={busy} onSubmit={submit} className="mt-5 space-y-5">
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div>
          <label htmlFor={`${id}-listing`} className="text-sm font-medium">{text("Your listing", "عرضك")}</label>
          <select id={`${id}-listing`} required value={listingId} onChange={event => onListingChange(event.target.value)} className={requestMoneyField} aria-describedby={`${id}-stock`}>
            <option value="">{text("Select a listing", "اختر عرضًا")}</option>
            {listings.map(listing => <option key={listing.id} value={listing.id}>{formatUsdt(listing.amount)} USDT · ₪{formatIls(listing.price)} {text("per USDT", "لكل USDT")}</option>)}
          </select>
          <p id={`${id}-stock`} className="mt-2 text-xs leading-5 text-gray-400">{text("The amount shown is available stock after active reservations.", "الكمية المعروضة هي الرصيد المتاح بعد خصم الحجوزات النشطة.")}</p>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={`${id}-price`} className="text-sm font-medium">{text("Your response price (ILS)", "سعر ردك (شيكل)")}</label>
            <button type="button" onClick={() => { onPriceChange(current.price); resetPriceInput(); }} className={`${requestSecondary} min-h-11 px-3 py-2 text-xs`}>
              {text("Match requested price", "مطابقة السعر المطلوب")} <bdi dir="ltr" className="tabular-nums text-emerald-300">₪{formatIls(current.price)}</bdi>
            </button>
          </div>
          <GroupedDecimalInput key={`${current.id}:${current.revision}:${listingId}:${priceInputRevision}`} id={`${id}-price`} value={offerPrice} onValueChange={onPriceChange} maxFractionDigits={2} maxIntegerDigits={4}
            required autoComplete="off" className={requestMoneyField}
            aria-invalid={Boolean(offerPrice && priceIssue)} aria-describedby={`${id}-price-help ${id}-reason`} />
          <p id={`${id}-price-help`} className="mt-2 text-xs leading-5 text-gray-400">
            {reference ? <>{text("Allowed price:", "السعر المسموح:")} <bdi dir="ltr" className="font-medium tabular-nums text-emerald-300">₪{formatIls(reference.minimum)} – ₪{formatIls(reference.maximum)}</bdi></>
              : text("A fresh reference is required before sending.", "يلزم مرجع سعر حديث قبل الإرسال.")}
          </p>
        </div>
      </fieldset>
      {priceSyntaxValid ? <FeeBreakdown amount={current.amount} price={offerPrice} ar={ar} seller title={text("Buyer payment preview", "معاينة دفعة المشتري")} /> : null}
      <div className="space-y-3">
        <p id={`${id}-reason`} className={"text-sm leading-6 " + (disabledReason ? "text-amber-200" : "text-gray-400")}>
          <RequestMoneyText>{disabledReason ?? text("Ready to send. Your response replaces any earlier open response from you.", "جاهز للإرسال. سيحل ردك محل أي رد مفتوح سابق منك.")}</RequestMoneyText>
        </p>
        <button type="submit" disabled={Boolean(disabledReason)} className={`${requestPrimary} w-full sm:w-auto`}>
          {updating ? text("Update response", "تحديث الرد") : text("Send response", "إرسال الرد")}
        </button>
      </div>
    </form>}
    <p className="mt-5 text-xs leading-5 text-gray-400">{text(
      "Normal seller fee obligations apply: collect the buyer’s 1% share and pay Alpha 2% in USDT after completion (1% from each side).",
      "تطبق التزامات رسوم البائع المعتادة: حصّل حصة المشتري 1% وادفع لألفا 2% بعملة USDT بعد الإكمال (1% من كل طرف).",
    )}</p>
  </section>;
}
