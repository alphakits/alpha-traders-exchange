import { useRef, useState } from "react";
import { Text, TextInput, View, Switch } from "react-native";
import type { MobileTradeDetail } from "@alpha-traders/contracts";
import { GoldButton } from "./gold-button";

export function TradeTermsPanel({ trade, isAr, disabled, onAction }: {
  trade: MobileTradeDetail; isAr: boolean; disabled: boolean;
  onAction: (action: string, value: string, safety: boolean) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [safety, setSafety] = useState(false);
  const inFlight = useRef(false);
  const seller = trade.side === "seller";
  const counter = trade.status === "pending" && trade.priceMode === "buyer_offer";
  const proposal = trade.termsProposal;
  const pending = proposal?.status === "pending";
  const face = trade.paymentMethod === "Face-to-Face (Meet in Person)";
  if ((!seller || (!counter && !["accepted", "payment_sent", "funds_received"].includes(trade.status))) && !pending) return null;
  async function submit(action: string) {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    try { await onAction(action, value, safety); } finally { inFlight.current = false; }
  }
  return <View style={{ padding: 16, gap: 12, borderWidth: 1, borderColor: "#C9A227", borderRadius: 14 }}>
    <Text style={{ color: "#FDE68A", fontWeight: "700" }}>{pending ? (isAr ? "اقتراح البائع بانتظار موافقة المشتري" : "Seller proposal — awaiting buyer confirmation") : counter ? (isAr ? "عرض مقابل" : "Counter-offer") : (isAr ? "تعديل كمية USDT" : "Adjust USDT amount")}</Text>
    {pending ? <>
      <Text style={{ color: "white", writingDirection: "ltr" }}>{proposal.usdtAmount} USDT · {trade.currency} {proposal.fiatAmount} · {proposal.pricePerUsdt} / USDT</Text>
      <Text style={{ color: "white" }}>{isAr ? "راجع الشروط الدقيقة قبل الموافقة." : "Review the exact terms before accepting."}</Text>
      {seller ? <GoldButton disabled={disabled} onPress={() => void submit("withdraw_terms")}>{isAr ? "سحب الاقتراح" : "Withdraw proposal"}</GoldButton> : <>
        <GoldButton disabled={disabled} onPress={() => void submit(proposal.kind === "counter_offer" ? "accept_counter_offer" : "accept_amount")}>{isAr ? "موافقة على الشروط" : "Accept these terms"}</GoldButton>
        <GoldButton disabled={disabled} variant="outline" onPress={() => void submit("decline_terms")}>{isAr ? "رفض الاقتراح" : "Decline proposal"}</GoldButton>
      </>}
    </> : <>
      <Text style={{ color: "white" }}>{counter ? (isAr ? "السعر بالشيكل لكل USDT" : "Price in ILS per USDT") : (isAr ? "كمية USDT الصحيحة" : "Correct USDT amount")}</Text>
      <TextInput accessibilityLabel={counter ? "Counter price ILS" : "Correct USDT amount"} keyboardType="decimal-pad" value={value} onChangeText={setValue} editable={!disabled} placeholder={counter ? trade.pricePerUsdt : trade.usdtAmount} placeholderTextColor="#999" style={{ color: "white", borderColor: "#777", borderWidth: 1, borderRadius: 8, padding: 12, textAlign: "left" }} />
      <Text style={{ color: "white" }}>{isAr ? "انتظر موافقة المشتري قبل تحويل المال أو USDT." : "Wait for buyer confirmation before transferring money or USDT."}</Text>
      {counter && face ? <View><Text style={{ color: "white" }}>{isAr ? "أوافق على اللقاء في مكان عام آمن والتحقق من النقد قبل إرسال USDT." : "I agree to meet in a safe public place and verify cash before sending USDT."}</Text><Switch accessibilityLabel="Accept meeting safety guidelines" value={safety} onValueChange={setSafety} /></View> : null}
      <GoldButton disabled={disabled || !value.trim() || (counter && face && !safety)} onPress={() => void submit(counter ? "counter_offer" : "propose_amount")}>{counter ? (isAr ? "إرسال عرض مقابل" : "Send counter-offer") : (isAr ? "إرسال التصحيح للموافقة" : "Propose corrected amount")}</GoldButton>
    </>}
  </View>;
}
