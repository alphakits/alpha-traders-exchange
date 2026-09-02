"use client";

import { AlertTriangle, RefreshCcw, Home } from "lucide-react";
import { usePathname } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

const T = {
  en: { tryAgain: "Try Again", home: "Home", desc: "This may be temporary — please try again or return home." },
  ar: { tryAgain: "حاول مجدداً", home: "الرئيسية", desc: "قد يكون ذلك مؤقتاً — يرجى المحاولة مجدداً أو العودة للرئيسية." },
} as const;

type Locale = keyof typeof T;

function useLocale(): Locale {
  const pathname = usePathname();
  return pathname?.split("/")[1] === "ar" ? "ar" : "en";
}

interface ErrorContentProps {
  reset: () => void;
  /** Localised title — pass two versions or a single pre-resolved string */
  titleEn?: string;
  titleAr?: string;
}

export function ErrorContent({
  reset,
  titleEn = "Something went wrong",
  titleAr = "حدث خطأ ما",
}: ErrorContentProps) {
  const locale = useLocale();
  const t = T[locale];
  const isRtl = locale === "ar";
  const title = locale === "ar" ? titleAr : titleEn;

  return (
    <section
      className="section-container page-shell flex min-h-[60vh] items-center justify-center"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="alpha-reveal-rise w-full max-w-lg">
        <div className="surface-panel-subtle relative overflow-hidden p-8 text-center shadow-2xl backdrop-blur-sm md:p-10">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#C9A227]/8 blur-3xl"
            aria-hidden="true"
          />

          <div
            className="alpha-reveal-pop alpha-delay-1 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10"
            aria-hidden="true"
          >
            <AlertTriangle className="h-10 w-10 text-[#C9A227]" />
          </div>

          <h1
            className="alpha-reveal-rise alpha-delay-2 text-2xl font-semibold text-white md:text-3xl"
          >
            {title}
          </h1>

          <p
            className="alpha-reveal-fade alpha-delay-3 mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/50"
          >
            {t.desc}
          </p>

          <div
            className="alpha-reveal-scale-x alpha-delay-3 mx-auto my-6 h-px w-24 bg-[#C9A227]/20"
            aria-hidden="true"
          />

          <div
            className="alpha-reveal-rise alpha-delay-4 flex flex-wrap justify-center gap-2"
          >
            <button type="button" onClick={reset} className={buttonVariants()}>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              {t.tryAgain}
            </button>
            <Link href="/" className={buttonVariants({ variant: "secondary" })}>
              <Home className="h-4 w-4" aria-hidden="true" />
              {t.home}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
