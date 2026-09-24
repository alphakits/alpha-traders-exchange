"use client";

import { currencyText } from "@/components/ui/currency-text";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { useRef, useState, type ReactNode } from "react";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TradeTermsPanel({ request, actorId, isAr, disabled, amountEditor, onUpdated, onBusyChange }: {
  request: PurchaseRequest; actorId: string; isAr: boolean; disabled?: boolean;
  amountEditor?: ReactNode;
  onUpdated: (request: PurchaseRequest) => void; onBusyChange?: (busy: boolean) => boolean | void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError, errorFeedbackKey] = useActionFeedbackState("");
  const [safety, setSafety] = useState(false);
  const [editing, setEditing] = useState(false);
  const inFlight = useRef(false);
  const seller = request.sellerId === actorId;
  const counter = request.status === "pending" && request.priceMode === "buyer_offer";
  const canCorrect = ["accepted", "payment_sent", "funds_received"].includes(request.status);
  const proposal = request.termsProposal;
  const pending = proposal?.status === "pending";
  const face = request.paymentMethod === "Face-to-Face (Meet in Person)";
  if (!["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(request.status)) return null;
  if (![request.sellerId, request.buyerId].includes(actorId)) return null;
  if (!pending && ["usdt_release_pending", "usdt_sent"].includes(request.status)) return null;

  async function submit(action: string) {
    if (disabled || inFlight.current) return;
    if (onBusyChange?.(true) === false) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/alpha-exchange/purchase-requests/${request.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ action, value, proposalId: proposal?.id, expectedUpdatedAt: request.updatedAt, safetyAcknowledged: safety }),
      });
      const body = await response.json() as { request?: PurchaseRequest; error?: string };
      if (!response.ok || !body.request) throw new Error(body.error || "Could not confirm the change. Refresh and try again.");
      onUpdated(body.request); setValue(""); setEditing(false);
    } catch (caught) {
      setError(isAr ? "تعذر تأكيد التغيير. تحقق من المبلغ وحدود العرض وحدّث الصفقة. للسحب دون بطاقة يجب مطابقة مبلغ رمز المشتري." : caught instanceof Error ? caught.message : "Could not confirm the change.");
    } finally { inFlight.current = false; setBusy(false); onBusyChange?.(false); }
  }

  return <section data-testid="trade-amount-action" className="space-y-3 rounded-xl border border-[#C9A227]/40 bg-[#C9A227]/10 p-3" aria-label={isAr ? "تعديل شروط الصفقة" : "Trade terms"}>
    {pending ? <p className="font-semibold text-[#FDE68A]">{isAr ? "اقتراح البائع بانتظار موافقة المشتري" : "Seller proposal — awaiting buyer confirmation"}</p> : <>
      <Button type="button" variant="secondary" className="min-h-11 w-full" aria-expanded={editing} aria-controls="trade-amount-editor"
        disabled={disabled || busy || !seller || (!canCorrect && !counter)} onClick={() => setEditing((current) => !current)}>
        {counter && seller ? (isAr ? "تقديم عرض مقابل" : "Make a counter-offer") : (isAr ? "تعديل المبلغ" : "Adjust Amount")}
      </Button>
      {!canCorrect && !counter && request.status !== "pending" ? <p className="text-xs text-[#D1D5DB]">{currencyText(isAr ? "بدأ إرسال USDT، لذلك أصبح المبلغ مقفلاً." : "USDT release has started, so the amount is locked.")}</p>
        : !seller ? <p className="text-xs text-[#D1D5DB]">{isAr ? "يقدّم البائع تصحيح المبلغ، وتظهر لك الشروط هنا للموافقة قبل تطبيقها. اطلب التعديل في دردشة الصفقة." : "The seller proposes an amount correction; you review and approve it here before it applies. Request a change in the trade chat."}</p>
        : !canCorrect && !counter ? <p className="text-xs text-[#D1D5DB]">{isAr ? "اقبل الطلب أولاً، ثم يمكنك اقتراح تصحيح المبلغ للمشتري." : "Accept the request first, then propose an amount correction for the buyer."}</p> : null}
    </>}
    {pending ? <>
      <p dir="ltr" className="break-words">{currencyText(`${proposal.usdtAmount} USDT · ${request.currency} ${proposal.fiatAmount} · ${proposal.pricePerUsdt} ${request.currency} / USDT`)}</p>
      <p className="text-sm">{isAr ? "راجع الكمية والسعر والإجمالي بدقة. لا تتغير الشروط إلا بعد موافقة المشتري." : "Review the exact amount, price and total. Terms change only after the buyer accepts."}</p>
      <div className="flex flex-wrap gap-2">
        {seller ? <Button disabled={disabled || busy} variant="secondary" onClick={() => void submit("withdraw_terms")}>{isAr ? "سحب الاقتراح" : "Withdraw proposal"}</Button> : <>
          <Button disabled={disabled || busy} onClick={() => void submit(proposal.kind === "counter_offer" ? "accept_counter_offer" : "accept_amount")}>{isAr ? "موافقة على الشروط" : "Accept these terms"}</Button>
          <Button disabled={disabled || busy} variant="secondary" onClick={() => void submit("decline_terms")}>{isAr ? "رفض الاقتراح" : "Decline proposal"}</Button>
        </>}
      </div>
    </> : editing && seller && (counter || canCorrect) ? <div id="trade-amount-editor" className="space-y-3">
      {!counter && amountEditor ? amountEditor : <>
      <label className="block text-sm">{currencyText(counter ? (isAr ? "السعر المقابل بالشيكل لكل USDT" : "Counter price in ILS per USDT") : (isAr ? "كمية USDT الصحيحة" : "Correct USDT amount"))}
        <Input dir="ltr" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled || busy} placeholder={counter ? request.pricePerUsdt : request.usdtAmount} className="currency-money mt-2 text-left" />
      </label>
      <p className="text-sm">{currencyText(isAr ? "سيصل الاقتراح للمشتري للموافقة. لا ترسل المال أو USDT أثناء انتظار الرد." : "The buyer will receive this proposal. Wait for their response before sending money or USDT.")}</p>
      {counter && face && !request.sellerSafetyAcknowledged ? <label className="flex gap-2 text-sm"><input type="checkbox" checked={safety} onChange={(event) => setSafety(event.target.checked)} />{currencyText(isAr ? "أوافق على اللقاء في مكان عام آمن والتحقق من النقد قبل إرسال USDT." : "I agree to meet in a safe public place and verify cash before sending USDT.")}</label> : null}
      <Button disabled={disabled || busy || !value.trim() || (counter && face && !request.sellerSafetyAcknowledged && !safety)} onClick={() => void submit(counter ? "counter_offer" : "propose_amount")}>{busy ? (isAr ? "جارٍ الإرسال…" : "Sending…") : counter ? (isAr ? "إرسال عرض مقابل" : "Send counter-offer") : (isAr ? "إرسال التصحيح للموافقة" : "Propose corrected amount")}</Button>
      </>}
    </div> : null}
    {error ? <ActionFeedback revealKey={errorFeedbackKey} as="p" role="alert" className="text-sm text-red-300">{currencyText(error)}</ActionFeedback> : null}
  </section>;
}
