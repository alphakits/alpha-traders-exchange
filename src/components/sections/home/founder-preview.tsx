"use client";

import Image from "next/image";
import { CheckCircle2, Play, UserRound } from "lucide-react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Feature bullets
// ---------------------------------------------------------------------------
const BULLETS = [
  { en: "Professional Education", ar: "تعليم احترافي" },
  { en: "Structured Marketplace", ar: "سوق منظم" },
  { en: "Community First", ar: "المجتمع أولاً" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function FounderPreview() {
  const locale = useLocale();
  const isRtl = locale === "ar";

  return (
    <section
      className="section-container"
      aria-label={isRtl ? "تعرف على مؤسس Alpha Traders" : "Meet the Founder of Alpha Traders"}
    >
      <div
        className={`relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0a] ${
          isRtl ? "md:flex-row-reverse" : ""
        } flex flex-col md:flex-row`}
      >
        {/* Soft radial gold background */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-25 [background:radial-gradient(circle_at_15%_40%,#C9A227,transparent_55%)]"
        />

        {/* ----------------------------------------------------------------
            Left / top — image panel
        ---------------------------------------------------------------- */}
        <div className="relative min-h-[260px] flex-shrink-0 overflow-hidden md:min-h-[420px] md:w-[46%]">
          <Image
            src="/images/hero/hero-trading-office.webp"
            alt={isRtl ? "مكتب Alpha Traders" : "Alpha Traders workspace"}
            fill
            sizes="(min-width: 768px) 46vw, 100vw"
            quality={75}
            className="object-cover object-center transition-transform duration-700 group-hover:scale-[1.03]"
          />
          {/* Dark overlay for readability */}
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10 md:bg-gradient-to-r md:from-transparent md:to-black/60" />

          {/* Play button CTA overlay */}
          <Link
            href="/founder#founder-video"
            aria-label={isRtl ? "شاهد فيديو المؤسس" : "Watch founder video"}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur-sm transition-all duration-300 hover:scale-110 hover:border-[#C9A227]/60 hover:bg-[#C9A227]/20 hover:text-[#C9A227]">
              <Play className="ms-0.5 h-7 w-7 fill-current" aria-hidden="true" />
            </span>
          </Link>
        </div>

        {/* ----------------------------------------------------------------
            Right / bottom — content panel
        ---------------------------------------------------------------- */}
        <div
          className={`relative flex flex-1 flex-col justify-center gap-5 p-7 md:p-10 ${
            isRtl ? "md:text-right" : "md:text-left"
          }`}
        >
          {/* Badge */}
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#C9A227]">
              <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              {isRtl ? "المؤسس" : "Founder"}
            </span>
          </div>

          {/* Headline */}
          <h2 className="text-2xl font-semibold leading-snug text-white md:text-3xl">
            {isRtl
              ? "تعرف على مؤسس Alpha Traders"
              : "Meet the Founder of Alpha Traders"}
          </h2>

          {/* Paragraph */}
          <p className="max-w-lg text-sm leading-7 text-[#9CA3AF]">
            {isRtl
              ? "تم إنشاء Alpha Traders لمساعدة المتداولين على التعلم باحتراف واستخدام سوق منظم يركز على الشفافية والتعليم والنمو على المدى الطويل."
              : "Alpha Traders was created to help traders learn professionally and use a structured marketplace focused on transparency, education, and long-term growth."}
          </p>

          {/* Bullets */}
          <ul
            className={`flex flex-col gap-2.5 ${isRtl ? "items-end" : "items-start"}`}
            aria-label={isRtl ? "مزايا رئيسية" : "Key features"}
          >
            {BULLETS.map((b) => (
              <li
                key={b.en}
                className="flex items-center gap-2.5 text-sm text-white/80"
              >
                <CheckCircle2
                  className="h-4 w-4 flex-shrink-0 text-[#C9A227]"
                  aria-hidden="true"
                />
                {isRtl ? b.ar : b.en}
              </li>
            ))}
          </ul>

          {/* CTA */}
          <div>
            <Link
              href="/founder#founder-video"
              className={cn(buttonVariants({ variant: "secondary" }), "gap-2 border-[#C9A227]/40 bg-[#C9A227]/8 text-[#C9A227] hover:border-[#C9A227]/70 hover:bg-[#C9A227]/15 hover:text-[#C9A227]")}
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              {isRtl ? "شاهد قصتي" : "Watch My Story"}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
