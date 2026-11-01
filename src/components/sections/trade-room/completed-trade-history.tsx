import { currencyText } from "@/components/ui/currency-text";
import { receiptDate, receiptEventLabel } from "@alpha-traders/contracts";
import type { PurchaseRequest, TradeChatMessage } from "@/types/alpha-exchange";
import { TradeEvidenceViewer } from "./trade-evidence-viewer";
import { localizeTradeRoomSystemMessage } from "@/lib/trade-room-system-message-localization";

/** Only accepts the existing authenticated, server-sanitized Trade Room DTO. */
export function CompletedTradeHistory({ request, messages, locale }: { request: PurchaseRequest; messages: TradeChatMessage[]; locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  return <section id="completed-trade-history" aria-label={isAr ? "سجل الصفقة المحفوظ" : "Saved trade history"} className="space-y-4">
    <details open className="rounded-2xl border border-white/10 bg-[#0B0B0B] p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">{isAr ? "سجل الصفقة الكامل" : "Full trade timeline"}</summary>
      <ol className="space-y-3">{[...(request.timeline ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(entry => <li key={entry.id} className="border-s-2 border-[#C9A227]/50 ps-3 text-sm">
        <p>{currencyText(receiptEventLabel(entry.type, locale))}</p><time className="text-xs text-[#9CA3AF]" dateTime={entry.createdAt}>{receiptDate(entry.createdAt, locale)}</time>
      </li>)}</ol>
    </details>
    <details className="rounded-2xl border border-white/10 bg-[#0B0B0B] p-4">
      <summary className="min-h-11 cursor-pointer font-semibold">{isAr ? "المحادثة المحفوظة" : "Saved conversation"}</summary>
      <div className="max-h-96 space-y-3 overflow-y-auto overscroll-contain" tabIndex={0} role="region" aria-label={isAr ? "المحادثة للقراءة فقط" : "Read-only conversation"}>
        {messages.map(message => <article key={message.id} className="rounded-xl bg-white/5 p-3 text-sm">
          <p className="text-xs font-semibold text-[#C9A227]">{message.kind === "system" ? (isAr ? "النظام" : "System") : message.senderUserId === request.buyerId ? (isAr ? "المشتري" : "Buyer") : message.senderUserId === request.sellerId ? (isAr ? "البائع" : "Seller") : (isAr ? "إدارة المنصة" : "Platform management")}</p>
          <p dir="auto" className="whitespace-pre-wrap break-words">{currencyText(message.credentialKind ? (isAr ? "تمت مشاركة بيانات سحب محمية خلال الصفقة." : "Protected withdrawal details were shared during the trade.") : message.kind === "system" ? localizeTradeRoomSystemMessage(message.message, locale).text : message.message)}</p>
          {message.imageUrl && !message.credentialKind ? <a href={message.imageUrl} target="_blank" rel="noopener noreferrer" className="my-2 block min-h-11 break-words text-[#E8C766] underline">{message.imageName || (isAr ? "فتح المرفق" : "Open attachment")}</a> : null}
          <time dateTime={message.createdAt} className="text-xs text-[#9CA3AF]">{receiptDate(message.createdAt, locale)}</time>
        </article>)}
      </div>
    </details>
    {request.buyerEvidence || request.sellerEvidence ? <div className="rounded-2xl border border-white/10 bg-[#0B0B0B] p-4">
      <h2 className="mb-3 font-semibold">{isAr ? "إثباتات الصفقة" : "Trade evidence"}</h2>
      {request.buyerEvidence ? <TradeEvidenceViewer requestId={request.id} evidence={request.buyerEvidence} isAr={isAr} /> : null}
      {request.sellerEvidence ? <TradeEvidenceViewer requestId={request.id} evidence={request.sellerEvidence} isAr={isAr} /> : null}
    </div> : null}
  </section>;
}
