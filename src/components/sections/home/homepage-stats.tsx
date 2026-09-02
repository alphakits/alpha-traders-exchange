"use client";

import { GraduationCap, Globe, ShieldCheck, Sparkles } from "lucide-react";
import { useLocale } from "next-intl";

// ---------------------------------------------------------------------------
// Stat card data
// ---------------------------------------------------------------------------
type StatItem = {
  icon: React.ReactNode;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  /** Numeric portion rendered immediately for reliable first paint and indexing */
  numericValue: number;
  /** Static suffix appended after the number, e.g. "+" or "%" */
  suffix?: string;
  /** Static prefix shown before the number, e.g. nothing here */
  prefix?: string;
  /** Override the entire display value with a static string */
  staticDisplay?: string;
};

const STATS: StatItem[] = [
  {
    icon: <GraduationCap className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Trading Lessons",
    titleAr: "دروس تداول",
    subtitleEn: "Professional educational content",
    subtitleAr: "محتوى تعليمي احترافي",
    numericValue: 20,
    suffix: "+",
  },
  {
    icon: <ShieldCheck className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Marketplace",
    titleAr: "السوق",
    subtitleEn: "Always available",
    subtitleAr: "متاح دائماً",
    numericValue: 0,
    staticDisplay: "24/7",
  },
  {
    icon: <Globe className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Languages",
    titleAr: "اللغات",
    subtitleEn: "English • Arabic",
    subtitleAr: "الإنجليزية • العربية",
    numericValue: 2,
  },
  {
    icon: <Sparkles className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Premium Experience",
    titleAr: "تجربة متميزة",
    subtitleEn: "Designed for serious traders",
    subtitleAr: "مصمم للمتداولين الجادين",
    numericValue: 100,
    suffix: "%",
  },
];

// ---------------------------------------------------------------------------
// Individual stat card
// ---------------------------------------------------------------------------
function StatCard({ stat, isRtl }: { stat: StatItem; isRtl: boolean }) {
  const displayValue = stat.staticDisplay
    ? stat.staticDisplay
    : `${stat.prefix ?? ""}${stat.numericValue}${stat.suffix ?? ""}`;

  return (
    <div
      className={`group relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-6 backdrop-blur-sm transition-[transform,box-shadow,border-color,background-color] duration-300 hover:-translate-y-1 hover:border-[#C9A227]/35 hover:bg-white/[0.055] hover:shadow-[0_8px_32px_rgba(201,162,39,0.14)] ${
        isRtl ? "items-end text-right" : "items-start text-left"
      }`}
    >
      {/* Gold icon circle */}
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[#C9A227]/20 bg-[#C9A227]/10 text-[#C9A227] transition-colors duration-200 group-hover:border-[#C9A227]/45 group-hover:bg-[#C9A227]/18">
        {stat.icon}
      </span>

      {/* Value */}
      <p
        className="text-3xl font-bold tabular-nums tracking-tight text-white"
        aria-live="polite"
        aria-atomic="true"
      >
        {displayValue}
      </p>

      {/* Labels */}
      <div className="min-w-0">
        <p className="text-[13px] font-semibold leading-snug text-white/90">
          {isRtl ? stat.titleAr : stat.titleEn}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-[#9CA3AF]">
          {isRtl ? stat.subtitleAr : stat.subtitleEn}
        </p>
      </div>

      {/* Ambient glow on hover */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(ellipse_at_top,rgba(201,162,39,0.07),transparent_70%)]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------
export function HomepageStats() {
  const locale = useLocale();
  const isRtl = locale === "ar";

  return (
    <section
      className="section-container"
      aria-label={isRtl ? "إحصاءات Alpha Traders" : "Alpha Traders statistics"}
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((stat) => (
          <StatCard key={stat.titleEn} stat={stat} isRtl={isRtl} />
        ))}
      </div>
    </section>
  );
}
