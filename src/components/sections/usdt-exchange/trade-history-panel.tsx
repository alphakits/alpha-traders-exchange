"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { formatTradeId } from "@/lib/format-id";

export function TradeHistoryPanel({ requests, userId, locale, statusLabel, loading = false }: { requests: PurchaseRequest[]; userId?: string; loading?: boolean; locale: "ar" | "en"; statusLabel: (status: PurchaseRequest["status"], isAr: boolean) => string }) {
  const isAr = locale === "ar";
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(10);
  const completed = (row: PurchaseRequest) => Boolean(row.completedAt) || ["completed", "review_open", "locked"].includes(row.status);
  const cancelled = (row: PurchaseRequest) => ["cancelled", "declined"].includes(row.status);
  const rows = useMemo(() => requests.filter((row) => row.buyerId === userId || row.sellerId === userId).filter((row) => {
    const matches = filter === "all" || (filter === "completed" ? completed(row) : filter === "cancelled" ? cancelled(row) : !completed(row) && !cancelled(row));
    return matches && `${row.displayNumber ?? ""} ${row.usdtAmount} ${statusLabel(row.status, isAr)}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [requests, userId, filter, query, isAr, statusLabel]);
  if (loading && !requests.length) return <div role="status" className="rounded-2xl border border-white/10 p-6 text-sm text-slate-400">{isAr ? "جاري تحميل صفقاتك…" : "Loading your trades…"}</div>;
  if (!userId) return <p className="rounded-2xl border border-white/10 p-5 text-sm"><Link href="/login?redirectTo=%2Ftrade%3Fsection%3Dtrade-history" locale={locale} className="text-[#D4AF37]">{isAr ? "سجّل الدخول لعرض صفقاتك" : "Sign in to view your trades"}</Link></p>;
  return <section id="my-trade-requests-section" className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#0d1118] p-4" tabIndex={-1}>
    <h1 className="text-xl font-semibold">{isAr ? "سجل الصفقات" : "Trade history"}</h1>
    <div className="my-4 flex flex-wrap gap-2">
      <input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(10); }} aria-label={isAr ? "بحث في صفقاتك" : "Search your trades"} placeholder={isAr ? "رقم الصفقة أو المبلغ" : "Trade number or amount"} className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-black/20 px-3 text-sm" />
      <select value={filter} onChange={(event) => { setFilter(event.target.value); setLimit(10); }} aria-label={isAr ? "حالة الصفقة" : "Trade status"} className="h-11 rounded-xl border border-white/15 bg-[#171d28] px-3 text-sm">
        <option value="all">{isAr ? "الكل" : "All trades"}</option><option value="active">{isAr ? "نشطة" : "Active"}</option><option value="completed">{isAr ? "مكتملة" : "Completed"}</option><option value="cancelled">{isAr ? "ملغاة" : "Cancelled"}</option>
      </select>
    </div>
    <div className="divide-y divide-white/10">{rows.slice(0, limit).map((row) => <Link key={row.id} href={`/trade-room/${row.id}`} locale={locale} className="flex min-h-20 items-center justify-between gap-3 rounded-lg px-2 py-3 transition hover:bg-white/5">
      <div><p className="text-sm font-semibold"><bdi>{formatTradeId(row.displayNumber, row.id)}</bdi><span className="ms-2 text-xs font-normal text-slate-400">{row.buyerId === userId ? (isAr ? "شراء" : "Buy") : (isAr ? "بيع" : "Sell")}</span></p><p className="mt-1 text-xs text-slate-400">{new Date(row.createdAt).toLocaleDateString(isAr ? "ar-IL" : "en-GB")} · {statusLabel(row.status, isAr)}</p></div>
      <div className="flex items-center gap-3"><bdi className="text-sm font-semibold">{Number(row.usdtAmount).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT</bdi><ArrowUpRight size={15} className="text-[#D4AF37]" /></div>
    </Link>)}</div>
    {!rows.length ? <p className="py-8 text-center text-sm text-slate-400">{isAr ? "لا توجد صفقات مطابقة." : "No matching trades."}</p> : null}
    {rows.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 10)} className="mt-4 min-h-11 w-full rounded-xl border border-white/15 text-sm">{isAr ? "عرض المزيد" : "Show more"}</button> : null}
  </section>;
}
