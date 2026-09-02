"use client";

import { Globe, GraduationCap, ShieldCheck, Users, Zap } from "lucide-react";
import { useLocale } from "next-intl";

type TrustItem = {
  icon: React.ReactNode;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
};

const ITEMS: TrustItem[] = [
  {
    icon: <ShieldCheck className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Approved Sellers",
    titleAr: "بائعون معتمدون",
    subtitleEn: "Manually Reviewed Access",
    subtitleAr: "صلاحية خضعت لمراجعة يدوية",
  },
  {
    icon: <GraduationCap className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Professional Trading Education",
    titleAr: "تعليم تداول احترافي",
    subtitleEn: "Structured Learning",
    subtitleAr: "تعلم منظم",
  },
  {
    icon: <Zap className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Structured Trade Flow",
    titleAr: "مسار صفقات منظم",
    subtitleEn: "Records, Evidence & Disputes",
    subtitleAr: "سجلات وأدلة ونزاعات",
  },
  {
    icon: <Users className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Trader Community",
    titleAr: "مجتمع المتداولين",
    subtitleEn: "Built for Serious Traders",
    subtitleAr: "مبني للمتداولين الجادين",
  },
  {
    icon: <Globe className="h-5 w-5" aria-hidden="true" />,
    titleEn: "Global Access",
    titleAr: "وصول عالمي",
    subtitleEn: "English & Arabic",
    subtitleAr: "عربي وإنجليزي",
  },
];

export function TrustBar() {
  const locale = useLocale();
  const isRtl = locale === "ar";

  return (
    <section
      className="section-container"
      aria-label={isRtl ? "مزايا Alpha Traders" : "Alpha Traders trust indicators"}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {ITEMS.map((item) => (
          <div
            key={item.titleEn}
            className={`group relative flex flex-col items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-center backdrop-blur-sm transition-[transform,box-shadow,border-color,background-color] duration-300 hover:-translate-y-1 hover:border-[#C9A227]/35 hover:bg-white/[0.055] hover:shadow-[0_6px_28px_rgba(201,162,39,0.14)] focus-within:outline-none focus-within:ring-2 focus-within:ring-[#C9A227]/50 ${
              isRtl ? "text-right items-end" : "text-left items-start"
            } sm:items-center sm:text-center`}
          >
            {/* gold icon wrapper */}
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[#C9A227]/20 bg-[#C9A227]/10 text-[#C9A227] transition-colors duration-200 group-hover:border-[#C9A227]/45 group-hover:bg-[#C9A227]/18">
              {item.icon}
            </span>

            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-snug text-white/90">
                {isRtl ? item.titleAr : item.titleEn}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#9CA3AF]">
                {isRtl ? item.subtitleAr : item.subtitleEn}
              </p>
            </div>

            {/* subtle ambient glow on hover */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(ellipse_at_top,rgba(201,162,39,0.07),transparent_70%)]"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
