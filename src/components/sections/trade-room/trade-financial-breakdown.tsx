import { calculateTradeFinancialBreakdown, canonicalizeTradeAmount, type TradeTermsQuote } from "@alpha-traders/contracts";
import { ChevronDown } from "lucide-react";
import { currencyText } from "@/components/ui/currency-text";

type FinancialTerms = TradeTermsQuote & {
  feePolicyVersion?: string;
  commissionCalculationVersion?: string;
};

/** Both previews and accepted terms use the same versioned settlement arithmetic. */
export function TradeFinancialBreakdown({ terms, currency, isAr, seller, collapsible = false }: {
  terms: FinancialTerms;
  currency: string;
  isAr: boolean;
  seller: boolean;
  collapsible?: boolean;
}) {
  const breakdown = calculateTradeFinancialBreakdown(terms);
  const savedTotal = canonicalizeTradeAmount(terms.fiatAmount);
  if (!breakdown || !savedTotal || canonicalizeTradeAmount(breakdown.fiatAmount) !== savedTotal) return null;
  const rows = [
    { key: "subtotal", label: isAr ? "قيمة USDT قبل العمولة" : "USDT value before fee", value: `${currency} ${breakdown.subtotal}` },
    { key: "buyer-fee", label: isAr ? "عمولة المشتري ضمن الإجمالي" : "Buyer fee included in total", value: `${currency} ${breakdown.buyerFiatFee}` },
    ...(seller ? [
      { key: "seller-commission", label: isAr ? "عمولة البائع بعملة USDT" : "Seller commission in USDT", value: `${breakdown.sellerFeeUsdt} USDT` },
      { key: "buyer-commission", label: isAr ? "حصة المشتري المحصلة بعملة USDT" : "Buyer commission collected in USDT", value: `${breakdown.buyerFeeUsdt} USDT` },
      { key: "total-commission", label: isAr ? "إجمالي المستحق لألفا بعد الإكمال" : "Total due to Alpha after completion", value: `${breakdown.totalCommissionUsdt} USDT` },
    ] : []),
  ];
  const content = <dl data-testid="trade-financial-breakdown" className="mt-2 space-y-1 border-t border-white/10 pt-2 text-xs text-[#D1D5DB]">
    {rows.map(row => <div key={row.key} data-testid={`trade-${row.key}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt>{currencyText(row.label)}</dt>
      <dd className="font-semibold tabular-nums text-white"><bdi dir="ltr">{currencyText(row.value)}</bdi></dd>
    </div>)}
  </dl>;
  return collapsible ? <details data-testid="trade-header-financial-details" className="group">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-xs font-semibold text-[#D1D5DB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A227]">
      {isAr ? "تفاصيل السعر والعمولة" : "Price and commission details"}
      <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
    </summary>
    {content}
  </details> : content;
}
