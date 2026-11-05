import { MoneyInput } from "./money-input";
import { BrandedText as Text } from "./branded-text";
import { useRef, useState } from "react";
import { View, Switch, ScrollView } from "react-native";
import type { MobileTradeDetail } from "@alpha-traders/contracts";
import { calculateTradeTermsQuote, getCardlessCashAmountOptions, tradeTermsQuoteValidationIssue, tradeCounterPriceIssue, isNegotiatingQuantityFixed, getTradeAmountAdjustmentCount, MAX_TRADE_AMOUNT_ADJUSTMENTS } from "@alpha-traders/contracts";
import { GoldButton } from "./gold-button";
import { TradeTermsComparison, type TradeTermsPreview } from "./trade-financial-summary";

export function TradeTermsPanel({ trade, isAr, disabled, onAction, onPreviewChange }: {
  trade: MobileTradeDetail; isAr: boolean; disabled: boolean;
  onAction: (action: string, value: string, safety: boolean, cardlessCashAmount?: string) => Promise<void>;
  onPreviewChange?: (preview: TradeTermsPreview | null) => void;
}) {
  const [value, setValue] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [cashOptionsOpen, setCashOptionsOpen] = useState(false);
  const [safety, setSafety] = useState(false);
  const [editorKind, setEditorKind] = useState<"amount" | "counter">(trade.status === "pending" && trade.priceMode === "buyer_offer" ? "counter" : "amount");
  const [amountUnit, setAmountUnit] = useState<"USDT" | "ILS">("USDT");
  const [busy, setBusy] = useState(false);
  const actionDisabled = disabled || busy;
  const inFlight = useRef(false);
  const seller = trade.side === "seller";
  const canCounter = trade.status === "pending" && trade.priceMode === "buyer_offer";
  const counter = canCounter;
  const quantityFixed = isNegotiatingQuantityFixed(trade);
  const proposal = trade.termsProposal;
  const pending = proposal?.status === "pending";
  // Amount changes have a different cutoff from cancellation. Use the server's
  // irreversible-progress decision; older payloads without it stay locked.
  const paymentLocked = !["pending", "accepted"].includes(trade.status) || trade.actions.canAdjustAmounts !== true;
  const counterProposalLocked = proposal?.kind === "counter_offer" ? !canCounter : pending && quantityFixed;
  const adjustmentCount = getTradeAmountAdjustmentCount(trade);
  const limitReached = adjustmentCount >= MAX_TRADE_AMOUNT_ADJUSTMENTS;
  const face = trade.paymentMethod === "Face-to-Face (Meet in Person)";
  const cardless = trade.paymentMethod === "Cardless ATM Withdrawal";
  const unit = cardless ? "ILS" : amountUnit;
  const calculationAction = counter ? "counter_offer" : unit === "ILS" ? "propose_ils_amount" : "propose_amount";
  // A price typed into the pending-only counter editor is never an amount.
  const editingValue = editorKind === "counter" && !canCounter ? "" : value;
  const counterIssue = counter ? tradeCounterPriceIssue(trade, editingValue, trade.liveListingPrice, isAr ? "ar" : "en") : null;
  const quote = counterIssue ? null : calculateTradeTermsQuote(trade, calculationAction, editingValue,
    counter && cashAmount ? { cardlessCashAmount: cashAmount } : undefined);
  const quoteIssue = quote ? tradeTermsQuoteValidationIssue(trade, quote, isAr ? "ar" : "en") : null;
  const proposalIssue = pending ? tradeTermsQuoteValidationIssue(trade, proposal, isAr ? "ar" : "en") : null;
  const includesBuyerFee = trade.feePolicyVersion === "buyer_seller_1pct_v1";
  const cashOptions = counter && cardless && quote && cashOptionsOpen
    ? getCardlessCashAmountOptions(quote.pricePerUsdt, 0, trade.liveMaximumCounterUsdt ?? "999999999", includesBuyerFee)
    : [];
  function publishPreview(nextValue: string, selectedCash = "") {
    const priceIssue = counter ? tradeCounterPriceIssue(trade, nextValue, trade.liveListingPrice, isAr ? "ar" : "en") : null;
    const terms = priceIssue ? null : calculateTradeTermsQuote(trade, calculationAction, nextValue,
      counter && selectedCash ? { cardlessCashAmount: selectedCash } : undefined);
    onPreviewChange?.({ requestId: trade.id, updatedAt: trade.updatedAt, terms });
  }
  function clearDraft() {
    setValue("");
    setCashAmount("");
    setCashOptionsOpen(false);
    onPreviewChange?.(null);
  }
  if (!["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(trade.status)) return null;
  if (!pending && (!seller || (quantityFixed && !canCounter))) return null;
  if (paymentLocked && !pending) return <View style={{ padding: 16, gap: 12 }}>
    <GoldButton disabled variant="outline">{isAr ? "تعديل المبلغ" : "Adjust Amount"}</GoldButton>
    <Text style={{ color: "#D1D5DB" }}>{isAr
      ? "المبلغ مقفل في هذه المرحلة. لا يمكن للمشتري أو البائع تعديله بعد الدفع أو مشاركة رمز السحب أو تأكيد النقد. تواصل مع المالك إذا احتجت مساعدة."
      : "The amount is locked at this stage. Buyers and sellers cannot adjust it after payment, withdrawal-code sharing, or cash confirmation. Contact the owner if you need help."}</Text>
  </View>;
  async function submit(action: string) {
    if (disabled || inFlight.current || (paymentLocked && !["withdraw_terms", "decline_terms"].includes(action))) return;
    if (["counter_offer", "accept_counter_offer"].includes(action) && !canCounter) return;
    if (["counter_offer", "propose_amount", "propose_ils_amount"].includes(action) && (limitReached || !quote || quoteIssue)) return;
    if (["accept_counter_offer", "accept_amount"].includes(action) && proposalIssue) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (action === "counter_offer" && cashAmount) await onAction(action, editingValue, safety, cashAmount);
      else await onAction(action, editingValue, safety);
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <View style={{ padding: 16, gap: 12, borderWidth: 1, borderColor: "#C9A227", borderRadius: 14 }}>
    {seller ? <Text style={{ color: "#D1D5DB" }}>{limitReached ? (isAr ? "تم استخدام التعديلين (2/2). لا يمكن تقديم تعديلات أخرى." : "Adjustment limit reached (2/2). No further proposals are available.") : (isAr ? `التعديلات المستخدمة: ${adjustmentCount} من 2` : `${adjustmentCount} / 2 adjustments used`)}</Text> : null}
    <Text style={{ color: "#FDE68A", fontWeight: "700" }}>{pending ? (isAr ? "اقتراح البائع بانتظار موافقة المشتري" : "Seller proposal — awaiting buyer confirmation") : counter ? (isAr ? "عرض مقابل" : "Counter-offer") : (isAr ? "تعديل المبلغ" : "Adjust Amount")}</Text>
    {pending ? <>
      {paymentLocked || counterProposalLocked ? <Text style={{ color: "#D1D5DB" }}>{paymentLocked
        ? (isAr ? "المبلغ مقفل بعد إرسال الدفعة أو مشاركة رمز السحب أو تأكيد النقد أو بدء إرسال USDT." : "The amount is locked after payment is sent, a withdrawal code is shared, cash is confirmed, or USDT release starts.")
        : (isAr ? "العرض المقابل متاح فقط قبل قبول الصفقة." : "Counter-offers are only available before the trade is accepted.")}</Text> : null}
      <TradeTermsComparison trade={trade} terms={proposal} isAr={isAr} />
      {cardless && proposal.kind === "counter_offer" ? <>
        <Text style={{ color: "#FDE68A" }}>{Number(proposal.usdtAmount) === Number(trade.usdtAmount)
          ? (isAr ? "كمية USDT ثابتة. يتغير إجمالي الدفع بحسب السعر المقترح." : "The USDT amount stays fixed. The payment total changes at the proposed rate.")
          : (isAr ? "هذا الاقتراح يغيّر كمية USDT. راجع الكمية وإجمالي الدفع قبل الموافقة." : "This proposal changes the USDT amount. Review the quantity and payment total before accepting.")}</Text>
        {Number(proposal.fiatAmount) !== Number(trade.fiatAmount) ? <Text style={{ color: "#FDE68A" }}>{isAr
          ? "بعد الموافقة، يلزم رمز سحب جديد يطابق إجمالي الدفع المقترح. لا تستخدم الرمز القديم."
          : "After approval, a new withdrawal code must match the proposed total. Do not use the old code."}</Text> : null}
      </> : null}
      {proposalIssue ? <Text style={{ color: "#FDE68A" }}>{proposalIssue}</Text> : null}
      {includesBuyerFee ? <Text style={{ color: "#FDE68A" }}>{isAr ? "الإجمالي يشمل عمولة المشتري 1%. لا تُضف العمولة مرة أخرى." : "Total includes the buyer’s 1% fee. Do not add it again."}</Text> : null}
      <Text style={{ color: "white" }}>{isAr ? "راجع الشروط الدقيقة قبل الموافقة." : "Review the exact terms before accepting."}</Text>
      {seller ? <GoldButton disabled={actionDisabled} loading={busy} onPress={() => void submit("withdraw_terms")}>{isAr ? "سحب الاقتراح" : "Withdraw proposal"}</GoldButton> : <>
        <GoldButton disabled={actionDisabled || paymentLocked || counterProposalLocked || Boolean(proposalIssue)} loading={busy} onPress={() => void submit(proposal.kind === "counter_offer" ? "accept_counter_offer" : "accept_amount")}>{isAr ? "موافقة على الشروط" : "Accept these terms"}</GoldButton>
        <GoldButton disabled={actionDisabled} variant="outline" onPress={() => void submit("decline_terms")}>{isAr ? "رفض الاقتراح" : "Decline proposal"}</GoldButton>
      </>}
    </> : <>
      {!quantityFixed && <Text style={{ color: "#D1D5DB" }}>{isAr ? "يمكن تعديل المبلغ قبل إرسال الدفعة أو مشاركة رمز السحب أو تأكيد النقد. موافقة المشتري مطلوبة." : "Adjust the amount before payment is sent, a withdrawal code is shared, or cash is confirmed. Buyer approval is required."}</Text>}
      {canCounter ? <View style={{ gap: 8 }}>
        <GoldButton disabled={actionDisabled || limitReached} variant="gold" style={{ minHeight: 48, borderRadius: 12 }} onPress={() => { setEditorKind("counter"); clearDraft(); publishPreview(""); }}>{isAr ? "تقديم عرض مقابل" : "Make a counter-offer"}</GoldButton>
      </View> : null}
      {!counter && !cardless && trade.currency === "ILS" ? <View style={{ gap: 8 }}>
        <GoldButton disabled={actionDisabled || limitReached} variant={unit === "USDT" ? "gold" : "outline"} onPress={() => { setAmountUnit("USDT"); clearDraft(); }}>USDT</GoldButton>
        <GoldButton disabled={actionDisabled || limitReached} variant={unit === "ILS" ? "gold" : "outline"} onPress={() => { setAmountUnit("ILS"); clearDraft(); }}>{isAr ? "إجمالي الدفع بالشيكل" : "Total ILS payment"}</GoldButton>
      </View> : null}
      <Text style={{ color: "white" }}>{counter ? (isAr ? "السعر بالشيكل لكل USDT" : "Price in ILS per USDT") : cardless ? (isAr ? "مبلغ السحب الجديد بالشيكل" : "New withdrawal amount (ILS)") : unit === "ILS" ? (isAr ? "إجمالي الدفع بالشيكل شامل عمولة المشتري إن وجدت" : "Total ILS payment including buyer fee if applicable") : (isAr ? "كمية USDT الصحيحة" : "Correct USDT amount")}</Text>
      <MoneyInput accessibilityLabel={counter ? "Counter price ILS" : cardless ? "New withdrawal amount (ILS)" : unit === "ILS" ? "Total ILS payment" : "Correct USDT amount"} keyboardType="decimal-pad" value={editingValue} onChangeText={next => {
        if (!canCounter) setEditorKind("amount");
        setValue(next);
        // A new rate always starts from the original USDT quantity. A previous
        // cash selection must never silently become fixed cash at the new rate.
        setCashAmount("");
        setCashOptionsOpen(false);
        publishPreview(next);
      }} editable={!actionDisabled && !limitReached} placeholder={counter ? trade.pricePerUsdt : unit === "ILS" ? trade.fiatAmount : trade.usdtAmount} placeholderTextColor="#999" style={{ color: "white", borderColor: "#777", borderWidth: 1, borderRadius: 8, padding: 12, textAlign: "left" }} />
      {counter && counterIssue ? <Text style={{ color: "#FDE68A" }}>{counterIssue}</Text> : null}
      {quoteIssue ? <Text style={{ color: "#FDE68A" }}>{quoteIssue}</Text> : null}
      {counter && cardless && quote ? <View style={{ gap: 8 }}>
        <GoldButton disabled={actionDisabled || limitReached} variant="outline" accessibilityState={{ expanded: cashOptionsOpen }} onPress={() => setCashOptionsOpen(open => !open)}>{isAr ? "اختياري: اختيار مبلغ سحب آخر" : "Optional: choose an ATM cash total"}</GoldButton>
        {cashOptionsOpen ? <>
          <Text style={{ color: "#D1D5DB" }}>{isAr
            ? "اختيار مبلغ سحب يغيّر كمية USDT عند هذا السعر. راجع الكمية الجديدة؛ موافقة المشتري مطلوبة."
            : "Choosing a cash total changes the USDT amount at this rate. Review the new quantity; buyer approval is required."}</Text>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 220 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={isAr ? "مبلغ السحب الاختياري" : "Optional ATM cash total"} style={{ gap: 8 }}>
              {cashOptions.map(({ ilsAmount: amount }) => <GoldButton key={amount} disabled={actionDisabled || limitReached} variant={cashAmount === amount ? "gold" : "outline"} accessibilityRole="radio" accessibilityState={{ checked: cashAmount === amount }} accessibilityLabel={`${isAr ? "اختيار مبلغ سحب" : "Select ATM cash total"} ILS ${amount}.00`} onPress={() => { setCashAmount(amount); setCashOptionsOpen(false); publishPreview(editingValue, amount); }}>ILS {amount}.00</GoldButton>)}
              {cashOptions.length === 0 ? <Text style={{ color: "#FDE68A" }}>{isAr ? "لا يوجد مبلغ سحب مدعوم ضمن الكمية المتاحة في هذا العرض." : "No supported cash amount fits the listing’s available USDT."}</Text> : null}
            </View>
          </ScrollView>
        </> : null}
        {cashAmount ? <GoldButton disabled={actionDisabled || limitReached} variant="outline" onPress={() => { setCashAmount(""); setCashOptionsOpen(false); publishPreview(editingValue); }}>{isAr ? "إبقاء كمية USDT الأصلية ثابتة" : "Keep the original USDT amount fixed"}</GoldButton> : null}
      </View> : null}
      {!counter && cardless ? <Text style={{ color: "white" }}>{isAr ? "من 100 إلى 10,000 شيكل بمضاعفات 100. تُحسب كمية USDT مع احتساب عمولة المشتري إن وجدت. بعد الموافقة يجب إرسال رمز يطابق الإجمالي الجديد." : "100–10,000 ILS in steps of 100. USDT is calculated with the buyer fee included when applicable. After approval, send a code matching the new total."}</Text> : null}
      {quote ? <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
        <TradeTermsComparison trade={trade} terms={quote} isAr={isAr} />
        {counter ? <Text style={{ color: "#FDE68A" }}>{cashAmount
          ? (isAr ? "اخترت مبلغ السحب صراحةً؛ تتغير كمية USDT الموضحة أعلاه. لا تُطبّق الشروط إلا بعد موافقة المشتري." : "You explicitly selected the cash total; the USDT amount changes as shown above. The buyer must approve these terms.")
          : (isAr ? "كمية USDT الأصلية ثابتة. يتغير إجمالي الدفع مع السعر، وتُحسب عمولة المشتري مرة واحدة." : "The original USDT amount stays fixed. The payment total changes with the rate, with the buyer fee included once.")}</Text> : null}
        {counter && cardless && Number(quote.fiatAmount) !== Number(trade.fiatAmount) ? <Text style={{ color: "#FDE68A" }}>{isAr ? "بعد الموافقة، أرسل رمز سحب جديدًا يطابق الإجمالي الجديد." : "After approval, send a new withdrawal code matching the new total."}</Text> : null}
        {includesBuyerFee ? <Text style={{ color: "#FDE68A" }}>{isAr ? "الإجمالي يشمل عمولة المشتري 1%. لا تُضف العمولة مرة أخرى." : "Total includes the buyer’s 1% fee. Do not add it again."}</Text> : null}
        <Text style={{ color: "#D1D5DB" }}>{isAr ? `العمولة والخصم من العرض على ${quote.usdtAmount} USDT عند الإكمال.` : `Commission and listing deduction use ${quote.usdtAmount} USDT on completion.`}</Text>
      </View> : null}
      <Text style={{ color: "white" }}>{isAr ? "انتظر موافقة المشتري قبل تحويل المال أو USDT." : "Wait for buyer confirmation before transferring money or USDT."}</Text>
      {counter && face ? <View><Text style={{ color: "white" }}>{isAr ? "أوافق على اللقاء في مكان عام آمن والتحقق من النقد قبل إرسال USDT." : "I agree to meet in a safe public place and verify cash before sending USDT."}</Text><Switch accessibilityLabel="Accept meeting safety guidelines" disabled={actionDisabled} value={safety} onValueChange={setSafety} /></View> : null}
      <GoldButton disabled={actionDisabled || paymentLocked || limitReached || !quote || Boolean(quoteIssue) || (counter && face && !safety)} loading={busy} onPress={() => void submit(calculationAction)}>{counter ? (isAr ? "إرسال عرض مقابل" : "Send counter-offer") : (isAr ? "إرسال التصحيح للموافقة" : "Propose corrected amount")}</GoldButton>
      {editingValue ? <GoldButton disabled={actionDisabled} variant="ghost" onPress={clearDraft}>{isAr ? "مسح المسودة" : "Clear draft"}</GoldButton> : null}
    </>}
  </View>;
}
