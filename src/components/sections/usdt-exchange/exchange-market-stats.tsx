"use client";

import { CircleDot, Clock3, LayoutGrid, Users } from "lucide-react";
import { useLocale } from "next-intl";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type ExchangeMarketStatsProps = {
  /** Total unique approved sellers with active listings */
  activeSellers?: number;
  /** Sellers currently showing online status */
  onlineNow?: number;
  /** Human-readable average response time, e.g. "4 min" */
  averageResponse?: string;
  /** Total open (active) listings */
  openListings?: number;
};

// ---------------------------------------------------------------------------
// Individual stat card
// ---------------------------------------------------------------------------
type StatDef = {
  icon: React.ReactNode;
  titleEn: string;
  titleAr: string;
  value: string;
  subtitleEn: string;
  subtitleAr: string;
};

function StatCard({ stat, isRtl }: { stat: StatDef; isRtl: boolean }) {
  return (
    <div
      className={`group relative flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-[#C9A227]/35 hover:bg-white/[0.055] hover:shadow-[0_8px_32px_rgba(201,162,39,0.13)] ${
        isRtl ? "items-end text-right" : "items-start text-left"
      }`}
      aria-label={`${isRtl ? stat.titleAr : stat.titleEn}: ${stat.value}`}
    >
      {/* Gold icon circle */}
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[#C9A227]/20 bg-[#C9A227]/10 text-[#C9A227] transition-colors duration-200 group-hover:border-[#C9A227]/45 group-hover:bg-[#C9A227]/18">
        {stat.icon}
      </span>

      {/* Value */}
      <p className="text-2xl font-bold tabular-nums tracking-tight text-white">
        {stat.value}
      </p>

      {/* Title + subtitle */}
      <div className="min-w-0">
        <p className="text-[13px] font-semibold leading-snug text-white/90">
          {isRtl ? stat.titleAr : stat.titleEn}
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#9CA3AF]">
          {isRtl ? stat.subtitleAr : stat.subtitleEn}
        </p>
      </div>

      {/* Ambient hover glow */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(ellipse_at_top,rgba(201,162,39,0.07),transparent_70%)]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------
export function ExchangeMarketStats({
  activeSellers,
  onlineNow,
  averageResponse,
  openListings,
}: ExchangeMarketStatsProps) {
  const locale = useLocale();
  const isRtl = locale === "ar";

  const stats: StatDef[] = [
    {
      icon: <Users className="h-5 w-5" aria-hidden="true" />,
      titleEn: "Active Sellers",
      titleAr: "البائعون النشطون",
      value: activeSellers !== undefined ? activeSellers.toString() : "—",
      subtitleEn: "Approved marketplace participants",
      subtitleAr: "مشاركون معتمدون في السوق",
    },
    {
      icon: <CircleDot className="h-5 w-5" aria-hidden="true" />,
      titleEn: "Online Now",
      titleAr: "متاحون الآن",
      value: onlineNow !== undefined ? onlineNow.toString() : "—",
      subtitleEn: "Currently available",
      subtitleAr: "متاحون للتداول الآن",
    },
    {
      icon: <Clock3 className="h-5 w-5" aria-hidden="true" />,
      titleEn: "Avg. Response",
      titleAr: "متوسط وقت الاستجابة",
      value: averageResponse ?? "—",
      subtitleEn: "Typical seller response time",
      subtitleAr: "وقت استجابة البائع المعتاد",
    },
    {
      icon: <LayoutGrid className="h-5 w-5" aria-hidden="true" />,
      titleEn: "Open Listings",
      titleAr: "العروض المفتوحة",
      value: openListings !== undefined ? openListings.toString() : "—",
      subtitleEn: "Available USDT offers",
      subtitleAr: "عروض USDT المتاحة",
    },
  ];

  return (
    <section
      aria-label={isRtl ? "إحصاءات Alpha Exchange" : "Alpha Exchange market statistics"}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatCard key={stat.titleEn} stat={stat} isRtl={isRtl} />
        ))}
      </div>
    </section>
  );
}
