"use client";

import { areTradeAmountsLocked } from "@/lib/trade-amount-lock";
import { currencyText } from "@/components/ui/currency-text";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { useRef, useState } from "react";
import { ChevronDown, PencilLine } from "lucide-react";
import { calculateTradeTermsQuote, getTradeAmountAdjustmentCount, MAX_TRADE_AMOUNT_ADJUSTMENTS } from "@alpha-traders/contracts";
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
  const paymentLocked = areTradeAmountsLocked(request);
  const adjustmentCount = getTradeAmountAdjustmentCount(request);
  const limitReached = adjustmentCount >= MAX_TRADE_AMOUNT_ADJUSTMENTS;
  const canCorrect = !paymentLocked && !limitReached;
  const proposal = request.termsProposal;
  const pending = proposal?.status === "pending";
  const counterProposalLocked = proposal?.kind === "counter_offer" && !canCounter;
  const face = request.paymentMethod === "Face-to-Face (Meet in Person)";
  const cardless = request.paymentMethod === "Cardless ATM Withdrawal";
  const unit = cardless && !counter ? "ILS" : amountUnit;
  const includesBuyerFee = request.feePolicyVersion === "buyer_seller_1pct_v1";
  const calculationAction = counter ? "counter_offer" : unit === "ILS" ? "propose_ils_amount" : "propose_amount";
  const quote = calculateTradeTermsQuote(request, calculationAction, value);
  const correctedAmount = quote?.usdtAmount;
  const correctedTotal = quote?.fiatAmount;
  if (!["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(request.status)) return null;
  if (![request.sellerId, request.buyerId].includes(actorId)) return null;
  if (!pending && !seller) return null;
  const lockedMessage = isAr ? "المبلغ مقفل بعد إرسال الدفعة أو مشاركة رمز السحب أو تأكيد النقد أو بدء إرسال USDT." : "The amount is locked after payment is sent, a withdrawal code is shared, cash is confirmed, or USDT release starts.";
  const counterLockedMessage = isAr ? "العرض المقابل متاح فقط قبل قبول الصفقة." : "Counter-offers are only available before the trade is accepted.";
  if (paymentLocked && !pending) return <div className="space-y-2">
    <Button type="button" variant="secondary" disabled className="min-h-11 w-auto rounded-xl border-slate-600 bg-slate-800 px-4 text-slate-400">{isAr ? "تعديل المبلغ" : "Adjust Amount"}</Button>
    <p data-testid="trade-amount-locked" className="max-w-md text-xs text-[#D1D5DB]">{lockedMessage}</p>
  </div>;

  async function submit(action: string) {
    if (disabled || inFlight.current) return;
    if (paymentLocked && !["withdraw_terms", "decline_terms"].includes(action)) return;
    if (["counter_offer", "accept_counter_offer"].includes(action) && !canCounter) return;
    if (limitReached && ["propose_amount", "propose_ils_amount", "counter_offer"].includes(action)) return;
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

  return <section data-testid="trade-amount-action" className={`space-y-3 ${pending ? "max-w-md rounded-xl border border-sky-300/30 bg-sky-400/10 p-4" : ""}`} aria-label={isAr ? "تعديل شروط الصفقة" : "Trade terms"}>
    {pending ? <p className="font-semibold text-[#FDE68A]">{isAr ? "اقتراح البائع بانتظار موافقة المشتري" : "Seller proposal — awaiting buyer confirmation"}</p> : <>
      <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="secondary" className="min-h-11 w-auto rounded-xl border-sky-200/60 bg-sky-300 px-4 font-semibold text-slate-950 shadow-sm hover:border-sky-100 hover:bg-sky-200 hover:text-slate-950 focus-visible:ring-sky-300 disabled:border-slate-600 disabled:bg-slate-800 disabled:text-slate-400" aria-expanded={editing && editorKind === "amount" && canCorrect} aria-controls="trade-amount-editor"
        disabled={disabled || busy || !seller || !canCorrect} onClick={() => { setEditorKind("amount"); setValue(""); setEditing(!editing || editorKind !== "amount"); }}>
        <span className="flex items-center gap-2"><PencilLine className="h-4 w-4" aria-hidden="true" />{isAr ? "تعديل المبلغ" : "Adjust Amount"}<ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${editing && editorKind === "amount" ? "rotate-180" : ""}`} aria-hidden="true" /></span>
      </Button>
      {canCounter ? <Button type="button" variant="secondary" className="min-h-11 w-auto rounded-xl px-4" aria-expanded={editing && counter && canCorrect} aria-controls="trade-amount-editor" disabled={disabled || busy || !canCorrect} onClick={() => { setEditorKind("counter"); setValue(""); setEditing(!editing || !counter); }}>{isAr ? "تقديم عرض مقابل" : "Make a counter-offer"}</Button> : null}
      </div>
      <p className="max-w-md text-xs text-[#D1D5DB]">{isAr ? "يمكن تعديل المبلغ قبل إرسال الدفعة أو مشاركة رمز السحب أو تأكيد النقد. موافقة المشتري مطلوبة." : "Adjust the amount before payment is sent, a withdrawal code is shared, or cash is confirmed. Buyer approval is required."}</p>
    </>}
    {seller ? <p data-testid="trade-adjustment-count" className="max-w-md text-xs text-[#D1D5DB]">{limitReached
      ? (isAr ? "تم استخدام التعديلين (2/2). لا يمكن تقديم تعديلات أخرى." : "Adjustment limit reached (2/2). No further proposals are available.")
      : (isAr ? `التعديلات المستخدمة: ${adjustmentCount} / 2` : `${adjustmentCount} / 2 adjustments used`)}</p> : null}
    {pending ? <>
      {paymentLocked || counterProposalLocked ? <p role="status" className="text-sm">{paymentLocked ? lockedMessage : counterLockedMessage}</p> : null}
      <p dir="ltr" className="break-words">{currencyText(`${proposal.usdtAmount} USDT · ${request.currency} ${proposal.fiatAmount} · ${proposal.pricePerUsdt} ${request.currency} / USDT`)}</p>
      {includesBuyerFee ? <p className="commission-notice text-sm">{isAr ? "الإجمالي يشمل عمولة المشتري 1%. لا تُضف العمولة مرة أخرى." : "Total includes the buyer’s 1% fee. Do not add it again."}</p> : null}
      <p className="text-sm">{isAr ? "راجع الكمية والسعر والإجمالي قبل الموافقة." : "Check the amount, price, and total before accepting."}</p>
      <div className="flex flex-wrap gap-2">
        {seller ? <Button disabled={disabled || busy} variant="secondary" onClick={() => void submit("withdraw_terms")}>{isAr ? "سحب الاقتراح" : "Withdraw proposal"}</Button> : <>
          <Button disabled={disabled || busy || paymentLocked || counterProposalLocked} onClick={() => void submit(proposal.kind === "counter_offer" ? "accept_counter_offer" : "accept_amount")}>{isAr ? "موافقة على الشروط" : "Accept these terms"}</Button>
          <Button disabled={disabled || busy} variant="secondary" onClick={() => void submit("decline_terms")}>{isAr ? "رفض الاقتراح" : "Decline proposal"}</Button>
        </>}
      </div>
    </> : editing && seller && canCorrect && (editorKind === "amount" || canCounter) ? <div id="trade-amount-editor" className="max-w-md space-y-3 rounded-xl border border-sky-300/30 bg-sky-400/10 p-4">
      {!counter && !cardless && request.currency === "ILS" ? <label className="block text-sm">{isAr ? "التعديل حسب" : "Adjust by"}<select aria-label={isAr ? "وحدة التعديل" : "Adjustment unit"} value={amountUnit} onChange={event => { setAmountUnit(event.target.value as "USDT" | "ILS"); setValue(""); }} disabled={disabled || busy} className="mt-2 block min-h-11 w-full rounded-lg border border-sky-300/20 bg-black p-2"><option value="USDT">USDT</option><option value="ILS">{isAr ? "إجمالي الدفع بالشيكل" : "Total ILS payment"}</option></select></label> : null}
      <label className="commission-notice block text-sm">{currencyText(counter ? (isAr ? "السعر المقابل بالشيكل لكل USDT" : "Counter price in ILS per USDT") : cardless ? (isAr ? "مبلغ السحب الجديد بالشيكل" : "New withdrawal amount (ILS)") : unit === "ILS" ? (isAr ? "إجمالي الدفع الصحيح بالشيكل (يشمل حصة المشتري إن وجدت)" : "Correct total ILS payment (including buyer fee if applicable)") : (isAr ? "كمية USDT الصحيحة" : "Correct USDT amount"))}
        <Input dir="ltr" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled || busy} placeholder={counter ? request.pricePerUsdt : unit === "ILS" ? request.fiatAmount : request.usdtAmount} className="currency-money mt-2 text-left" />
      </label>
      {!counter && cardless ? <p className="text-sm">{isAr ? "من 100 إلى 10,000 شيكل بمضاعفات 100. تُحسب كمية USDT بالسعر المتفق عليه مع احتساب عمولة المشتري إن وجدت. بعد موافقة المشتري، يرسل رمزًا مطابقًا للمبلغ الجديد." : "100–10,000 ILS in steps of 100. USDT is calculated at the agreed price with the buyer fee included when applicable. After accepting, the buyer sends a code matching the new total."}</p> : null}
      {correctedAmount && correctedTotal ? <div data-testid="trade-adjustment-preview" className="space-y-1 rounded-lg border border-emerald-500/30 bg-black/30 p-3 text-sm" aria-live="polite">
        <p className="currency-money font-semibold" dir="ltr">{currencyText(`${request.usdtAmount} → ${correctedAmount} USDT`)}</p>
        <p className="currency-money" dir="ltr">{currencyText(`${request.currency} ${correctedTotal}`)}</p>
        {includesBuyerFee ? <p className="commission-notice">{isAr ? "الإجمالي يشمل عمولة المشتري 1%. لا تُضف العمولة مرة أخرى." : "Total includes the buyer’s 1% fee. Do not add it again."}</p> : null}
        <p className="text-xs text-[#D1D5DB]">{currencyText(isAr ? `العمولة والخصم من العرض على ${correctedAmount} USDT عند الإكمال.` : `Commission and listing deduction use ${correctedAmount} USDT on completion.`)}</p>
      </div> : null}
      <p className="text-sm">{currencyText(isAr ? "انتظر موافقة المشتري قبل إرسال المال أو USDT." : "Wait for buyer approval before sending money or USDT.")}</p>
      <p className="text-xs text-[#D1D5DB]">{isAr ? "يمكن زيادة المبلغ أو تخفيضه ضمن رصيد العرض وحدوده. يُسمح باقتراحين فقط، حتى إذا رُفض الاقتراح أو سُحب." : "Increase or decrease within the listing's available balance and trade limits. Submitted proposals count toward the limit, even if declined or withdrawn."}</p>
      {counter && face && !request.sellerSafetyAcknowledged ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={safety} onChange={(event) => setSafety(event.target.checked)} />{currencyText(isAr ? "أوافق على اللقاء في مكان عام آمن والتحقق من النقد قبل إرسال USDT." : "I agree to meet in a safe public place and verify cash before sending USDT.")}</label> : null}
      <Button disabled={disabled || busy || !value.trim() || (!correctedAmount || !correctedTotal) || (counter && face && !request.sellerSafetyAcknowledged && !safety)} onClick={() => void submit(calculationAction)}>{busy ? (isAr ? "جارٍ الإرسال…" : "Sending…") : counter ? (isAr ? "إرسال عرض مقابل" : "Send counter-offer") : (isAr ? "إرسال التصحيح للموافقة" : "Propose corrected amount")}</Button>
    </div> : null}
    {error ? <ActionFeedback revealKey={errorFeedbackKey} as="p" role="alert" className="text-sm text-red-300">{currencyText(error)}</ActionFeedback> : null}
  </section>;
}
