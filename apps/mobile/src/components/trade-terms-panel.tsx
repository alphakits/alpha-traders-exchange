import { MoneyInput } from "./money-input";
import { BrandedText as Text } from "./branded-text";
import { useRef, useState } from "react";
import { View, Switch } from "react-native";
import type { MobileTradeDetail } from "@alpha-traders/contracts";
import { calculateTradeTermsQuote, tradeCounterPriceIssue, isNegotiatingQuantityFixed, getTradeAmountAdjustmentCount, MAX_TRADE_AMOUNT_ADJUSTMENTS } from "@alpha-traders/contracts";
import { GoldButton } from "./gold-button";

function TradeTermsComparison({ trade, terms, isAr }: {
  trade: MobileTradeDetail;
  terms: { usdtAmount: string; fiatAmount: string; pricePerUsdt: string };
  isAr: boolean;
}) {
  const rows = [
    { label: isAr ? "السعر لكل USDT" : "Price per USDT", value: `${trade.pricePerUsdt ?? "—"} → ${terms.pricePerUsdt} ${trade.currency} / USDT` },
    { label: isAr ? "كمية USDT" : "USDT amount", value: `${trade.usdtAmount} → ${terms.usdtAmount} USDT` },
    { label: isAr ? "إجمالي الدفع" : "Total payment", value: `${trade.currency} ${trade.fiatAmount} → ${trade.currency} ${terms.fiatAmount}` },
  ];
  return <View style={{ gap: 8 }}>
    <Text style={{ color: "#D1D5DB", fontSize: 12 }}>{isAr ? "الشروط الحالية ← الشروط المقترحة" : "Current → Proposed"}</Text>
    {rows.map(row => <View key={row.label} style={{ gap: 2 }}>
      <Text style={{ color: "#D1D5DB", fontSize: 12 }}>{row.label}</Text>
      <Text monetary style={{ writingDirection: "ltr", fontWeight: "700" }}>{row.value}</Text>
    </View>)}
  </View>;
}

export function TradeTermsPanel({ trade, isAr, disabled, onAction }: {
  trade: MobileTradeDetail; isAr: boolean; disabled: boolean;
  onAction: (action: string, value: string, safety: boolean) => Promise<void>;
}) {
  const [value, setValue] = useState("");
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
  const quote = counterIssue ? null : calculateTradeTermsQuote(trade, calculationAction, editingValue);
  const includesBuyerFee = trade.feePolicyVersion === "buyer_seller_1pct_v1";
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
    if (["counter_offer", "propose_amount", "propose_ils_amount"].includes(action) && (limitReached || !quote)) return;
    inFlight.current = true;
    setBusy(true);
    try { await onAction(action, editingValue, safety); } finally { inFlight.current = false; setBusy(false); }
  }
  return <View style={{ padding: 16, gap: 12, borderWidth: 1, borderColor: "#C9A227", borderRadius: 14 }}>
    {seller ? <Text style={{ color: "#D1D5DB" }}>{limitReached ? (isAr ? "تم استخدام التعديلين (2/2). لا يمكن تقديم تعديلات أخرى." : "Adjustment limit reached (2/2). No further proposals are available.") : (isAr ? `التعديلات المستخدمة: ${adjustmentCount} من 2` : `${adjustmentCount} / 2 adjustments used`)}</Text> : null}
    <Text style={{ color: "#FDE68A", fontWeight: "700" }}>{pending ? (isAr ? "اقتراح البائع بانتظار موافقة المشتري" : "Seller proposal — awaiting buyer confirmation") : counter ? (isAr ? "عرض مقابل" : "Counter-offer") : (isAr ? "تعديل المبلغ" : "Adjust Amount")}</Text>
    {pending ? <>
      {paymentLocked || counterProposalLocked ? <Text style={{ color: "#D1D5DB" }}>{paymentLocked
        ? (isAr ? "المبلغ مقفل بعد إرسال الدفعة أو مشاركة رمز السحب أو تأكيد النقد أو بدء إرسال USDT." : "The amount is locked after payment is sent, a withdrawal code is shared, cash is confirmed, or USDT release starts.")
        : (isAr ? "العرض المقابل متاح فقط قبل قبول الصفقة." : "Counter-offers are only available before the trade is accepted.")}</Text> : null}
      <TradeTermsComparison trade={trade} terms={proposal} isAr={isAr} />
      {cardless && proposal.kind === "counter_offer" ? <Text style={{ color: "#FDE68A" }}>{Number(proposal.fiatAmount) === Number(trade.fiatAmount)
        ? (isAr ? "مبلغ السحب ثابت. تتغير كمية USDT حسب السعر الجديد، وتحتاج إلى موافقة المشتري." : "The ATM cash amount stays the same. The USDT amount changes at the new rate and requires buyer approval.")
        : (isAr ? "يتغير مبلغ السحب بهذا الاقتراح. بعد الموافقة، يلزم رمز سحب جديد يطابق الإجمالي المقترح." : "This proposal changes the ATM cash amount. After approval, a new withdrawal code must match the proposed total.")}</Text> : null}
      {includesBuyerFee ? <Text style={{ color: "#FDE68A" }}>{isAr ? "الإجمالي يشمل عمولة المشتري 1%. لا تُضف العمولة مرة أخرى." : "Total includes the buyer’s 1% fee. Do not add it again."}</Text> : null}
      <Text style={{ color: "white" }}>{isAr ? "راجع الشروط الدقيقة قبل الموافقة." : "Review the exact terms before accepting."}</Text>
      {seller ? <GoldButton disabled={actionDisabled} loading={busy} onPress={() => void submit("withdraw_terms")}>{isAr ? "سحب الاقتراح" : "Withdraw proposal"}</GoldButton> : <>
        <GoldButton disabled={actionDisabled || paymentLocked || counterProposalLocked} loading={busy} onPress={() => void submit(proposal.kind === "counter_offer" ? "accept_counter_offer" : "accept_amount")}>{isAr ? "موافقة على الشروط" : "Accept these terms"}</GoldButton>
        <GoldButton disabled={actionDisabled} variant="outline" onPress={() => void submit("decline_terms")}>{isAr ? "رفض الاقتراح" : "Decline proposal"}</GoldButton>
      </>}
    </> : <>
      {!quantityFixed && <Text style={{ color: "#D1D5DB" }}>{isAr ? "يمكن تعديل المبلغ قبل إرسال الدفعة أو مشاركة رمز السحب أو تأكيد النقد. موافقة المشتري مطلوبة." : "Adjust the amount before payment is sent, a withdrawal code is shared, or cash is confirmed. Buyer approval is required."}</Text>}
      {canCounter ? <View style={{ gap: 8 }}>
        <GoldButton disabled={actionDisabled || limitReached} variant="gold" style={{ minHeight: 48, borderRadius: 12 }} onPress={() => { setEditorKind("counter"); setValue(""); }}>{isAr ? "تقديم عرض مقابل" : "Make a counter-offer"}</GoldButton>
      </View> : null}
      {!counter && !cardless && trade.currency === "ILS" ? <View style={{ gap: 8 }}>
        <GoldButton disabled={actionDisabled || limitReached} variant={unit === "USDT" ? "gold" : "outline"} onPress={() => { setAmountUnit("USDT"); setValue(""); }}>USDT</GoldButton>
        <GoldButton disabled={actionDisabled || limitReached} variant={unit === "ILS" ? "gold" : "outline"} onPress={() => { setAmountUnit("ILS"); setValue(""); }}>{isAr ? "إجمالي الدفع بالشيكل" : "Total ILS payment"}</GoldButton>
      </View> : null}
      <Text style={{ color: "white" }}>{counter ? (isAr ? "السعر بالشيكل لكل USDT" : "Price in ILS per USDT") : cardless ? (isAr ? "مبلغ السحب الجديد بالشيكل" : "New withdrawal amount (ILS)") : unit === "ILS" ? (isAr ? "إجمالي الدفع بالشيكل شامل عمولة المشتري إن وجدت" : "Total ILS payment including buyer fee if applicable") : (isAr ? "كمية USDT الصحيحة" : "Correct USDT amount")}</Text>
      <MoneyInput accessibilityLabel={counter ? "Counter price ILS" : cardless ? "New withdrawal amount (ILS)" : unit === "ILS" ? "Total ILS payment" : "Correct USDT amount"} keyboardType="decimal-pad" value={editingValue} onChangeText={next => { if (!canCounter) setEditorKind("amount"); setValue(next); }} editable={!actionDisabled && !limitReached} placeholder={counter ? trade.pricePerUsdt : unit === "ILS" ? trade.fiatAmount : trade.usdtAmount} placeholderTextColor="#999" style={{ color: "white", borderColor: "#777", borderWidth: 1, borderRadius: 8, padding: 12, textAlign: "left" }} />
      {counter && counterIssue ? <Text style={{ color: "#FDE68A" }}>{counterIssue}</Text> : null}
      {counter && cardless && value && !counterIssue && !quote ? <Text style={{ color: "#FDE68A" }}>{isAr ? "يجب أن تحتوي الصفقة على مبلغ سحب صالح من 100 إلى 10,000 شيكل بمضاعفات 100. حدّث الصفقة وتحقق من مبلغ السحب." : "The trade needs a valid ATM cash amount from ₪100 to ₪10,000 in ₪100 steps. Refresh the trade and check the withdrawal amount."}</Text> : null}
      {!counter && cardless ? <Text style={{ color: "white" }}>{isAr ? "من 100 إلى 10,000 شيكل بمضاعفات 100. تُحسب كمية USDT مع احتساب عمولة المشتري إن وجدت. بعد الموافقة يجب إرسال رمز يطابق الإجمالي الجديد." : "100–10,000 ILS in steps of 100. USDT is calculated with the buyer fee included when applicable. After approval, send a code matching the new total."}</Text> : null}
      {quote ? <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
        {counter ? <TradeTermsComparison trade={trade} terms={quote} isAr={isAr} /> : <>
          <Text monetary style={{ writingDirection: "ltr" }}>{trade.usdtAmount} → {quote.usdtAmount} USDT</Text>
          <Text monetary style={{ writingDirection: "ltr" }}>{trade.currency} {quote.fiatAmount}</Text>
        </>}
        {counter && cardless ? <Text style={{ color: "#FDE68A" }}>{isAr ? "مبلغ السحب ثابت. تُحسب كمية USDT بالسعر المقترح، ويجب أن يوافق المشتري قبل المتابعة." : "The ATM cash amount stays the same. USDT is recalculated at the proposed rate, and the buyer must approve before continuing."}</Text> : null}
        {includesBuyerFee ? <Text style={{ color: "#FDE68A" }}>{isAr ? "الإجمالي يشمل عمولة المشتري 1%. لا تُضف العمولة مرة أخرى." : "Total includes the buyer’s 1% fee. Do not add it again."}</Text> : null}
        <Text style={{ color: "#D1D5DB" }}>{isAr ? `العمولة والخصم من العرض على ${quote.usdtAmount} USDT عند الإكمال.` : `Commission and listing deduction use ${quote.usdtAmount} USDT on completion.`}</Text>
      </View> : null}
      <Text style={{ color: "white" }}>{isAr ? "انتظر موافقة المشتري قبل تحويل المال أو USDT." : "Wait for buyer confirmation before transferring money or USDT."}</Text>
      {counter && face ? <View><Text style={{ color: "white" }}>{isAr ? "أوافق على اللقاء في مكان عام آمن والتحقق من النقد قبل إرسال USDT." : "I agree to meet in a safe public place and verify cash before sending USDT."}</Text><Switch accessibilityLabel="Accept meeting safety guidelines" disabled={actionDisabled} value={safety} onValueChange={setSafety} /></View> : null}
      <GoldButton disabled={actionDisabled || paymentLocked || limitReached || !quote || (counter && face && !safety)} loading={busy} onPress={() => void submit(calculationAction)}>{counter ? (isAr ? "إرسال عرض مقابل" : "Send counter-offer") : (isAr ? "إرسال التصحيح للموافقة" : "Propose corrected amount")}</GoldButton>
    </>}
  </View>;
}
