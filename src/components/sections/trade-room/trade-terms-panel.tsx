"use client";

import { hasIrreversibleRequestProgress } from "@/lib/trade-cancellation";
import { currencyText } from "@/components/ui/currency-text";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { useRef, useState } from "react";
import { calculateCardlessUsdtAmount, calculateTradePaymentTotal, calculateUsdtForPaymentTotal, canonicalizeTradeAmount } from "@alpha-traders/contracts";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientRequestTimeoutError, runClientRequest } from "@/lib/client-request-deadline";

export function TradeTermsPanel({ request, actorId, isAr, disabled, onUpdated, onBusyChange }: {
  request: PurchaseRequest; actorId: string; isAr: boolean; disabled?: boolean;
  onUpdated: (request: PurchaseRequest) => void; onBusyChange?: (busy: boolean) => boolean | void;
}) {
  const [value, setValue] = useState("");
  const [amountUnit, setAmountUnit] = useState<"USDT" | "ILS">("USDT");
  const [busy, setBusy] = useState(false);
  const [error, setError, errorFeedbackKey] = useActionFeedbackState("");
  const [safety, setSafety] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorKind, setEditorKind] = useState<"amount" | "counter">("amount");
  const inFlight = useRef(false);
  const seller = request.sellerId === actorId;
  const canCounter = request.status === "pending" && request.priceMode === "buyer_offer";
  const counter = canCounter && editorKind === "counter";
  const paymentLocked = hasIrreversibleRequestProgress(request);
  const canCorrect = ["pending", "accepted"].includes(request.status) && !paymentLocked;
  const proposal = request.termsProposal;
  const pending = proposal?.status === "pending";
  const face = request.paymentMethod === "Face-to-Face (Meet in Person)";
  const cardless = request.paymentMethod === "Cardless ATM Withdrawal";
  const unit = cardless && !counter ? "ILS" : amountUnit;
  const price = request.pricePerUsdt || request.listingPriceAtRequest || "";
  const includesBuyerFee = request.feePolicyVersion === "buyer_seller_1pct_v1";
  const normalizedValue = canonicalizeTradeAmount(value);
  const correctedAmount = counter || !normalizedValue ? null : cardless
    ? calculateCardlessUsdtAmount(normalizedValue, price, includesBuyerFee)
    : unit === "ILS" ? calculateUsdtForPaymentTotal(normalizedValue, price, includesBuyerFee) : normalizedValue;
  const correctedTotal = correctedAmount ? calculateTradePaymentTotal(correctedAmount, price, includesBuyerFee) : null;
  if (!["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(request.status)) return null;
  if (![request.sellerId, request.buyerId].includes(actorId)) return null;
  if (!pending && !seller) return null;

  async function submit(action: string) {
    if (disabled || inFlight.current) return;
    if (onBusyChange?.(true) === false) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const { response, body } = await runClientRequest(new AbortController(), 15_000, async (signal) => {
        const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, signal,
          body: JSON.stringify({ action, value, proposalId: proposal?.id, expectedUpdatedAt: request.updatedAt, safetyAcknowledged: safety }),
        });
        const body = await response.json() as { request?: PurchaseRequest; error?: string };
        return { response, body };
      });
      if (!response.ok || !body.request) throw new Error(body.error || "Could not confirm the change. Refresh and try again.");
      onUpdated(body.request); setValue(""); setEditing(false);
    } catch (caught) {
      setError(isAr ? "تعذر تأكيد التغيير. تحقق من المبلغ وحدود العرض وحدّث الصفقة. للسحب دون بطاقة يجب مطابقة مبلغ رمز المشتري."
        : caught instanceof ClientRequestTimeoutError ? "The change could not be confirmed. Check the latest trade status before trying again."
        : caught instanceof Error ? caught.message : "Could not confirm the change.");
    } finally { inFlight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  return <section data-testid="trade-amount-action" className="space-y-3 rounded-xl border border-[#C9A227]/50 bg-[#C9A227]/10 p-3 sm:p-4" aria-label={isAr ? "تعديل شروط الصفقة" : "Trade terms"}>
    {pending ? <p className="font-semibold text-[#FDE68A]">{isAr ? "اقتراح البائع بانتظار موافقة المشتري" : "Seller proposal — awaiting buyer confirmation"}</p> : <>
      <Button type="button" variant="secondary" className="min-h-11 w-full" aria-expanded={editing && !counter} aria-controls="trade-amount-editor"
        disabled={disabled || busy || !seller || !canCorrect} onClick={() => { setEditorKind("amount"); setValue(""); setEditing(!editing || counter); }}>
        {isAr ? "تعديل المبلغ" : "Adjust Amount"}
      </Button>
      {canCounter ? <Button type="button" variant="secondary" className="min-h-11 w-full" aria-expanded={editing && counter} aria-controls="trade-amount-editor" disabled={disabled || busy || paymentLocked} onClick={() => { setEditorKind("counter"); setValue(""); setEditing(!editing || !counter); }}>{isAr ? "تقديم عرض مقابل" : "Make a counter-offer"}</Button> : null}
      {paymentLocked ? <p className="text-xs text-[#D1D5DB]">{currencyText(isAr ? "بدأ الدفع أو تمت مشاركة رمز السحب، لذلك أصبح المبلغ مقفلاً." : "Payment has started or a withdrawal code was shared. The amount is locked.")}</p>
        : !seller ? <p className="text-xs text-[#D1D5DB]">{isAr ? "اطلب التعديل في الدردشة، ثم راجع اقتراح البائع ووافق عليه هنا." : "Request changes in chat. Review and accept the seller’s proposal here."}</p>
        : !canCorrect && !counter ? <p className="text-xs text-[#D1D5DB]">{isAr ? "اقبل الطلب قبل تعديل المبلغ." : "Accept the request before adjusting the amount."}</p>
        : !counter ? <p className="text-xs text-[#D1D5DB]">{isAr ? "عدّل المبلغ قبل الدفع. يؤكد المشتري التعديل، وتُحسب العمولة والخصم من العرض على المبلغ الجديد عند الإكمال." : "Change the amount before payment. The buyer confirms; commission and listing deduction use the new amount on completion."}</p> : null}
    </>}
    {pending ? <>
      <p dir="ltr" className="break-words">{currencyText(`${proposal.usdtAmount} USDT · ${request.currency} ${proposal.fiatAmount} · ${proposal.pricePerUsdt} ${request.currency} / USDT`)}</p>
      <p className="text-sm">{isAr ? "راجع الكمية والسعر والإجمالي قبل الموافقة." : "Check the amount, price, and total before accepting."}</p>
      <div className="flex flex-wrap gap-2">
        {seller ? <Button disabled={disabled || busy} variant="secondary" onClick={() => void submit("withdraw_terms")}>{isAr ? "سحب الاقتراح" : "Withdraw proposal"}</Button> : <>
          <Button disabled={disabled || busy || paymentLocked} onClick={() => void submit(proposal.kind === "counter_offer" ? "accept_counter_offer" : "accept_amount")}>{isAr ? "موافقة على الشروط" : "Accept these terms"}</Button>
          <Button disabled={disabled || busy} variant="secondary" onClick={() => void submit("decline_terms")}>{isAr ? "رفض الاقتراح" : "Decline proposal"}</Button>
        </>}
      </div>
    </> : editing && seller && (counter || canCorrect) ? <div id="trade-amount-editor" className="space-y-3">
      {!counter && !cardless && request.currency === "ILS" ? <label className="block text-sm">{isAr ? "التعديل حسب" : "Adjust by"}<select aria-label={isAr ? "وحدة التعديل" : "Adjustment unit"} value={amountUnit} onChange={event => { setAmountUnit(event.target.value as "USDT" | "ILS"); setValue(""); }} disabled={disabled || busy} className="ms-2 rounded-lg bg-black p-2"><option value="USDT">USDT</option><option value="ILS">{isAr ? "إجمالي الدفع بالشيكل" : "Total ILS payment"}</option></select></label> : null}
      <label className="commission-notice block text-sm">{currencyText(counter ? (isAr ? "السعر المقابل بالشيكل لكل USDT" : "Counter price in ILS per USDT") : cardless ? (isAr ? "مبلغ السحب الجديد بالشيكل" : "New withdrawal amount (ILS)") : unit === "ILS" ? (isAr ? "إجمالي الدفع الصحيح بالشيكل (يشمل حصة المشتري إن وجدت)" : "Correct total ILS payment (including buyer fee if applicable)") : (isAr ? "كمية USDT الصحيحة" : "Correct USDT amount"))}
        <Input dir="ltr" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled || busy} placeholder={counter ? request.pricePerUsdt : unit === "ILS" ? request.fiatAmount : request.usdtAmount} className="currency-money mt-2 text-left" />
      </label>
      {!counter && cardless ? <p className="text-sm">{isAr ? "من 100 إلى 10,000 شيكل بمضاعفات 100. تُحسب كمية USDT بالسعر المتفق عليه. بعد موافقة المشتري، يرسل رمزًا مطابقًا للمبلغ الجديد." : "100–10,000 ILS in steps of 100. USDT is calculated at the agreed price. After accepting, the buyer sends a code matching the new total."}</p> : null}
      {!counter && correctedAmount && correctedTotal ? <div data-testid="trade-adjustment-preview" className="space-y-1 rounded-lg border border-emerald-500/30 bg-black/30 p-3 text-sm" aria-live="polite">
        <p className="currency-money font-semibold" dir="ltr">{currencyText(`${request.usdtAmount} → ${correctedAmount} USDT · ${request.currency} ${correctedTotal}`)}</p>
        <p>{currencyText(isAr ? `عند الإكمال: يُخصم ${correctedAmount} USDT من العرض وتُحسب العمولة على ${correctedAmount} USDT.` : `On completion: deduct ${correctedAmount} USDT from the listing and calculate commission on ${correctedAmount} USDT.`)}</p>
      </div> : null}
      <p className="text-sm">{currencyText(isAr ? "انتظر موافقة المشتري قبل إرسال المال أو USDT." : "Wait for buyer approval before sending money or USDT.")}</p>
      {counter && face && !request.sellerSafetyAcknowledged ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={safety} onChange={(event) => setSafety(event.target.checked)} />{currencyText(isAr ? "أوافق على اللقاء في مكان عام آمن والتحقق من النقد قبل إرسال USDT." : "I agree to meet in a safe public place and verify cash before sending USDT.")}</label> : null}
      <Button disabled={disabled || busy || !value.trim() || (!counter && (!correctedAmount || !correctedTotal)) || (counter && face && !request.sellerSafetyAcknowledged && !safety)} onClick={() => void submit(counter ? "counter_offer" : unit === "ILS" ? "propose_ils_amount" : "propose_amount")}>{busy ? (isAr ? "جارٍ الإرسال…" : "Sending…") : counter ? (isAr ? "إرسال عرض مقابل" : "Send counter-offer") : (isAr ? "إرسال التصحيح للموافقة" : "Propose corrected amount")}</Button>
    </div> : null}
    {error ? <ActionFeedback revealKey={errorFeedbackKey} as="p" role="alert" className="text-sm text-red-300">{currencyText(error)}</ActionFeedback> : null}
  </section>;
}
