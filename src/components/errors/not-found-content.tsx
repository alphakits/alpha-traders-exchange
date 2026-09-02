"use client";

import { FileSearch, Home, BookOpen, BarChart2 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

type Locale = "ar" | "en";

const T = {
  en: {
    code: "404",
    title: "Page Not Found",
    desc: "The page you're looking for doesn't exist or may have been moved.",
    home: "Home",
    academy: "Academy",
    exchange: "Alpha Exchange",
  },
  ar: {
    code: "404",
    title: "الصفحة غير موجودة",
    desc: "الصفحة التي تبحث عنها غير موجودة أو ربما تم نقلها.",
    home: "الرئيسية",
    academy: "الأكاديمية",
    exchange: "ألفا إكستشينج",
  },
} satisfies Record<Locale, Record<string, string>>;

export function NotFoundContent({ locale }: { locale: Locale }) {
  const t = T[locale] ?? T.en;
  const isRtl = locale === "ar";

  return (
    <section
      className="section-container page-shell flex min-h-[65vh] items-center justify-center"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="alpha-reveal-rise w-full max-w-lg">
        <div className="surface-panel-subtle relative overflow-hidden p-8 shadow-2xl backdrop-blur-sm md:p-10">
          {/* Radial glow */}
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#C9A227]/10 blur-3xl"
            aria-hidden="true"
          />

          {/* Icon */}
          <div
            className="alpha-reveal-pop alpha-delay-1 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10"
            aria-hidden="true"
          >
            <FileSearch className="h-10 w-10 text-[#C9A227]" />
          </div>

          {/* Badge */}
          <p
            className="alpha-reveal-fade alpha-delay-2 text-center text-xs font-bold uppercase tracking-[0.35em] text-[#C9A227]"
          >
            {t.code}
          </p>

          {/* Title */}
          <h1
            className="alpha-reveal-rise alpha-delay-2 mt-2 text-center text-2xl font-semibold leading-tight text-white md:text-3xl"
          >
            {t.title}
          </h1>

          {/* Description */}
          <p
            className="alpha-reveal-fade alpha-delay-3 mx-auto mt-3 max-w-sm text-center text-sm leading-relaxed text-white/50"
          >
            {t.desc}
          </p>

          {/* Divider */}
          <div
            className="alpha-reveal-scale-x alpha-delay-3 mx-auto my-6 h-px w-24 bg-[#C9A227]/20"
            aria-hidden="true"
          />

          {/* Buttons */}
          <div
            className="alpha-reveal-rise alpha-delay-4 flex flex-wrap justify-center gap-2"
          >
            <Link href="/" className={buttonVariants()}>
              <Home className="h-4 w-4" aria-hidden="true" />
              {t.home}
            </Link>
            <Link href="/academy" className={buttonVariants({ variant: "secondary" })}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              {t.academy}
            </Link>
            <Link href="/usdt-exchange" className={buttonVariants({ variant: "secondary" })}>
              <BarChart2 className="h-4 w-4" aria-hidden="true" />
              {t.exchange}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
