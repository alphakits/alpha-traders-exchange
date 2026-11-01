import { currencyText } from "@/components/ui/currency-text";

/** Displays the existing quote; never calculates or modifies fee/trade terms. */
export function TradePaymentSummary({ isAr, amount, subtotal, buyerFee, total, paymentMethod, network, formatFiat }: {
  isAr: boolean;
  amount: number;
  subtotal: number;
  buyerFee: number;
  total: number;
  paymentMethod?: string;
  network?: string;
  formatFiat: (value: number) => string;
}) {
  const rows = [
    [isAr ? "كمية USDT التي تستلمها" : "USDT you receive", Number.isFinite(amount) && amount > 0 ? `${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDT` : "—"],
    [isAr ? "قيمة الصفقة" : "Trade value", formatFiat(subtotal)],
    [isAr ? "عمولتك كمشتري (1%)" : "Your buyer fee (1%)", formatFiat(buyerFee)],
    [isAr ? "إجمالي الدفع للبائع" : "Total to pay the seller", formatFiat(total)],
  ];
  return <section aria-label={isAr ? "ملخص طلب الشراء" : "Purchase summary"} className="mt-3 rounded-xl border border-white/15 bg-black/25 p-3 sm:p-4">
    <h3 className="mb-3 text-sm font-semibold text-white">{isAr ? "ملخص طلبك" : "Your request summary"}</h3>
    <dl className="space-y-2.5 text-sm">
      {rows.map(([label, value], index) => <div key={label} className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${index === 2 ? "commission-notice rounded-lg bg-amber-300/10 p-2 text-amber-200" : ""} ${index === 3 ? "border-t border-white/15 pt-3 font-semibold" : ""}`}>
        <dt>{currencyText(label)}</dt><dd className="text-emerald-300"><bdi dir="ltr">{currencyText(value)}</bdi></dd>
      </div>)}
      {paymentMethod ? <div className="flex flex-wrap justify-between gap-2 border-t border-white/10 pt-2"><dt>{isAr ? "طريقة الدفع" : "Payment method"}</dt><dd>{paymentMethod}</dd></div> : null}
      {network ? <div className="flex flex-wrap justify-between gap-2"><dt>{isAr ? "شبكة الاستلام" : "Receiving network"}</dt><dd><bdi dir="ltr">{network}</bdi></dd></div> : null}
    </dl>
  </section>;
}
