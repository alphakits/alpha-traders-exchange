"use client";

import { currencyText } from "@/components/ui/currency-text";
import { receiptNotice, tradeReceiptDisplayRows, type TradeCompletionReceipt } from "@alpha-traders/contracts";

export function TradeReceiptPanel({ receipt, requestId, locale }: { receipt: TradeCompletionReceipt; requestId: string; locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const href = `/api/alpha-exchange/purchase-requests/${encodeURIComponent(requestId)}/receipt?format=html&locale=${locale}`;
  return <section id="trade-receipt" aria-labelledby="trade-receipt-title" dir={isAr ? "rtl" : "ltr"} className="scroll-mt-28 rounded-2xl border border-[#C9A227]/30 bg-[#0B0B0B] p-4 sm:p-5">
    <h2 id="trade-receipt-title" className="text-lg font-semibold text-white">{isAr ? "إيصال الصفقة" : "Trade receipt"}</h2>
    <p className="mt-2 text-sm text-[#9CA3AF]">{isAr ? "سجل خاص بالمشتري والبائع وإدارة المنصة المخولة." : "Private to the buyer, seller and authorized platform management."}</p>
    <dl className="mt-4 grid gap-x-6 sm:grid-cols-2">{tradeReceiptDisplayRows(receipt, locale).map(([label, value, isMoney]) => <div key={label} className="min-w-0 border-b border-white/10 py-3">
      <dt className="text-xs text-[#9CA3AF]">{currencyText(label)}</dt><dd dir="auto" className={`mt-1 break-words text-sm font-medium ${isMoney ? "currency-money" : "text-white"}`}>{isMoney ? currencyText(value) : currencyText(value, { groupNumbers: false })}</dd>
    </div>)}</dl>
    <p className="mt-4 text-xs leading-relaxed text-[#9CA3AF]">{currencyText(receiptNotice(receipt, locale))}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-[#C9A227]/40 px-4 py-2 text-sm text-[#E8C766]">{isAr ? "فتح / طباعة الإيصال" : "Open / print receipt"}</a>
      <a href={`${href}&download=1`} download className="inline-flex min-h-11 items-center rounded-xl border border-white/20 px-4 py-2 text-sm text-white">{isAr ? "تنزيل الإيصال" : "Download receipt"}</a>
    </div>
  </section>;
}
