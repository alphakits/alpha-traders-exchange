import { View } from "react-native";
import { calculateTradeFinancialBreakdown, canonicalizeTradeAmount, tradeTermsQuoteValidationIssue, type MobileTradeDetail, type TradeTermsQuote } from "@alpha-traders/contracts";
import { BrandedText as Text } from "./branded-text";

export type TradeTermsPreview = {
  requestId: string;
  updatedAt: string;
  terms: TradeTermsQuote | null;
};

function financialRows(trade: MobileTradeDetail, terms: TradeTermsQuote, isAr: boolean) {
  const breakdown = calculateTradeFinancialBreakdown({
    ...terms,
    feePolicyVersion: trade.feePolicyVersion,
    commissionCalculationVersion: trade.commissionCalculationVersion,
  });
  // Persisted proposals and agreed totals remain authoritative. Do not invent a
  // fee split for an older payload whose saved total cannot be reconstructed.
  const savedTotal = canonicalizeTradeAmount(terms.fiatAmount);
  const itemized = breakdown && savedTotal !== null && canonicalizeTradeAmount(breakdown.fiatAmount) === savedTotal ? breakdown : null;
  const money = (value?: string | null) => value == null ? "—" : `${trade.currency} ${value}`;
  const usdt = (value?: string | null) => value == null ? "—" : `${value} USDT`;
  return [
    { id: "price", label: isAr ? "السعر لكل USDT" : "Price per USDT", value: `${money(terms.pricePerUsdt)} / USDT` },
    { id: "quantity", label: isAr ? "كمية USDT" : "USDT amount", value: usdt(terms.usdtAmount) },
    { id: "subtotal", label: isAr ? "قيمة USDT قبل العمولة" : "USDT value before fee", value: money(itemized?.subtotal) },
    { id: "buyer-fiat-fee", label: isAr ? "عمولة المشتري ضمن الدفع" : "Buyer fee included in payment", value: money(itemized?.buyerFiatFee) },
    { id: "total", label: isAr ? "إجمالي الدفع" : "Total payment", value: money(terms.fiatAmount) },
    ...(trade.side === "seller" ? [
      { id: "seller-fee", label: isAr ? "عمولتك كبائع" : "Your seller fee", value: usdt(breakdown?.sellerFeeUsdt) },
      { id: "buyer-usdt-fee", label: isAr ? "حصة المشتري المحصّلة للبائع" : "Buyer share collected by seller", value: usdt(breakdown?.buyerFeeUsdt) },
      { id: "commission", label: isAr ? "الإجمالي المستحق لألفا بعد الإكمال" : "Total due to Alpha after completion", value: usdt(breakdown?.totalCommissionUsdt) },
    ] : []),
  ];
}

export function TradeTermsComparison({ trade, terms, isAr }: {
  trade: MobileTradeDetail;
  terms: TradeTermsQuote;
  isAr: boolean;
}) {
  const current = financialRows(trade, trade, isAr);
  const proposed = financialRows(trade, terms, isAr);
  return <View style={{ gap: 8 }}>
    <Text style={{ color: "#D1D5DB", fontSize: 12 }}>{isAr ? "الشروط الحالية ← الشروط المقترحة" : "Current → Proposed"}</Text>
    {current.map((row, index) => <View key={row.id} style={{ gap: 2 }}>
      <Text style={{ color: "#D1D5DB", fontSize: 12, textAlign: isAr ? "right" : "left" }}>{row.label}</Text>
      <Text monetary style={{ writingDirection: "ltr", fontWeight: row.id === "total" ? "800" : "700" }}>
        {row.value} → {proposed[index]?.value ?? "—"}
      </Text>
    </View>)}
  </View>;
}

/** Shows a draft or saved proposal prominently without changing agreed terms. */
export function TradeFinancialSummary({ trade, isAr, preview }: {
  trade: MobileTradeDetail;
  isAr: boolean;
  preview?: TradeTermsPreview | null;
}) {
  const proposal = trade.termsProposal?.status === "pending" ? trade.termsProposal : null;
  const draft = preview?.requestId === trade.id && preview.updatedAt === trade.updatedAt
    && trade.side === "seller" && ["pending", "accepted"].includes(trade.status)
    && trade.actions.canAdjustAmounts === true ? preview : null;
  const mode = proposal ? "proposal" : draft ? "draft" : "current";
  const terms = proposal ?? (draft ? draft.terms : trade);
  const issue = mode !== "current" && terms ? tradeTermsQuoteValidationIssue(trade, terms, isAr ? "ar" : "en") : null;
  const heading = mode === "proposal"
    ? (isAr ? "الإجمالي المقترح — بانتظار موافقة المشتري" : "Proposed total — awaiting buyer approval")
    : mode === "draft"
      ? (isAr ? "إجمالي المسودة — لم يُرسل بعد" : "Draft total — not sent yet")
      : trade.status === "pending"
        ? (isAr ? "إجمالي الطلب الحالي — بانتظار القبول" : "Current request total — awaiting acceptance")
        : (isAr ? "إجمالي الدفع المتفق عليه" : "Agreed payment total");
  return <View accessibilityLiveRegion="polite" style={{ gap: 10 }}>
    <Text accessibilityRole="header" style={{ color: "#FDE68A", fontWeight: "800", textAlign: isAr ? "right" : "left" }}>{heading}</Text>
    {mode !== "current" ? <Text style={{ color: "#FDE68A", textAlign: isAr ? "right" : "left" }}>{isAr
      ? "لا تدفع أو ترسل USDT قبل موافقة المشتري على الشروط."
      : "Do not pay or send USDT until the buyer accepts these terms."}</Text> : trade.status === "pending" ? <Text style={{ color: "#FDE68A", textAlign: isAr ? "right" : "left" }}>{isAr
        ? "انتظر قبول الشروط قبل الدفع. أي عمولة للمشتري مشمولة في الإجمالي المعروض."
        : "Wait for the terms to be accepted before payment. Any buyer fee is included in the displayed total."}</Text> : null}
    {terms ? financialRows(trade, terms, isAr).map(row => <View key={row.id} style={{ gap: 3 }}>
      <Text style={{ color: "#D1D5DB", fontSize: 12, textAlign: isAr ? "right" : "left" }}>{row.label}</Text>
      <Text monetary selectable style={{ writingDirection: "ltr", fontWeight: row.id === "total" ? "800" : "700", fontSize: row.id === "total" ? 20 : 16 }}>{row.value}</Text>
    </View>) : <Text style={{ color: "#D1D5DB", textAlign: isAr ? "right" : "left" }}>{isAr
      ? "أدخل سعرًا صالحًا لعرض الإجمالي والعمولات."
      : "Enter a valid price to preview the total and fees."}</Text>}
    {issue ? <Text style={{ color: "#FDE68A", textAlign: isAr ? "right" : "left" }}>{issue}</Text> : null}
  </View>;
}
