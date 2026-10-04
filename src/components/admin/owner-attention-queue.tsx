"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { currencyText } from "@/components/ui/currency-text";
import { ownerAttentionQueue, type OwnerAttentionItem } from "@/lib/owner-attention-queue";
import type { CommissionRecord, TradeDisputeCase } from "@/types/alpha-exchange";
import type { MarketplaceOperationalSnapshot } from "@/lib/marketplace-operational-health";

export function OwnerAttentionQueue({ isAr, operations, disputes = [], commissions = [], onOpen }: { isAr: boolean; operations: MarketplaceOperationalSnapshot | null; disputes: TradeDisputeCase[]; commissions: CommissionRecord[]; onOpen: (item: OwnerAttentionItem) => void }) {
  const queue = ownerAttentionQueue(operations, disputes, commissions);
  const incidentLabels = {
    overdue_usdt_release: isAr ? "إصدار USDT متأخر" : "Overdue USDT release",
    stale_price_offer: isAr ? "عرض سعر ينتظر الرد" : "Price offer waiting for response",
    stalled_trade: isAr ? "صفقة تحتاج إلى متابعة" : "Trade needs follow-up",
    orphaned_listing_lock: isAr ? "قفل عرض يحتاج إلى مراجعة" : "Listing lock needs review",
    unlinked_active_trade: isAr ? "ارتباط صفقة يحتاج إلى مراجعة" : "Trade linkage needs review",
  };
  return <section className="rounded-2xl border border-[#C9A227]/30 bg-[#0B0B0B]/95 p-4 sm:p-5" aria-label={isAr ? "قائمة متابعة المالك" : "Owner attention queue"}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{isAr ? "أولويات المتابعة" : "Follow-up priorities"} <span className="text-[#D4AF37]">({queue.length})</span></h2><p className="mt-1 text-sm text-[#9CA3AF]">{isAr ? "صفقات متأخرة، حالات دعم، ودفعات تحتاج إلى مطابقة؛ افتح السجل لاتخاذ الإجراء المتاح." : "Delayed trades, support cases and payments awaiting a match. Open the record to use its available actions."}</p></div><Link href={`/${isAr ? "ar" : "en"}/settings?tab=security`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#C9A227]/30 px-3 text-sm text-[#D4AF37]"><ShieldCheck className="h-4 w-4" />{isAr ? "أمان حساب المالك" : "Owner account security"}</Link></div>
    {!operations ? <p role="status" className="mt-3 rounded-lg border border-amber-300/20 p-3 text-sm text-amber-200">{isAr ? "حالة مراقبة الصفقات غير متاحة في هذا التحديث. أعد تحديث اللوحة." : "Trade monitoring is unavailable in this snapshot. Refresh the dashboard."}</p> : <p className="mt-3 text-xs text-[#9CA3AF]">{isAr ? "تحديث مراقبة الصفقات" : "Trade monitoring snapshot"}: <time dateTime={operations.generatedAt}>{Number.isFinite(Date.parse(operations.generatedAt)) ? new Date(operations.generatedAt).toLocaleString(isAr ? "ar" : "en-US") : "—"}</time></p>}
    <div className="mt-3 space-y-2">{queue.slice(0, 8).map(item => {
      const title = item.kind === "incident" ? incidentLabels[item.incident.kind] : item.kind === "dispute" ? (isAr ? "حالة دعم مفتوحة" : "Open support case") : item.commission.paymentVerificationStatus === "failed" ? (isAr ? "دفعة عمولة تحتاج إلى مراجعة" : "Commission payment needs review") : (isAr ? "دفعة عمولة قيد التحقق" : "Commission payment verifying");
      const reference = item.kind === "incident" ? item.incident.requestId ?? item.incident.listingId : item.kind === "dispute" ? (item.dispute.displayNumber ? `#${item.dispute.displayNumber}` : item.dispute.id) : (item.commission.displayNumber ? `#${item.commission.displayNumber}` : item.commission.id);
      return <article key={`${item.kind}:${item.id}`} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="text-sm font-medium">{currencyText(title)}</h3><p className="mt-1 truncate text-xs text-[#9CA3AF]"><bdi dir="ltr">{reference}</bdi>{item.kind === "incident" ? ` · ${Math.max(0, Math.floor(item.incident.ageMinutes))} ${isAr ? "دقيقة" : "min"}` : ""}</p></div><Button type="button" variant="secondary" size="sm" onClick={() => onOpen(item)}>{isAr ? "فتح السجل" : "Open record"}</Button></article>;
    })}</div>
    {!queue.length && operations ? <p className="mt-3 text-sm text-[#9CA3AF]">{isAr ? "لا توجد إجراءات متابعة في هذا التحديث." : "No follow-up items in this snapshot."}</p> : null}
    {queue.length > 8 ? <p className="mt-3 text-xs text-[#9CA3AF]">{isAr ? "تظهر أول 8 أولويات. جميع السجلات متاحة في أقسام الصفقات والعمولات." : "Showing the first 8 priorities. All records remain available in Trades and Commissions."}</p> : null}
  </section>;
}
