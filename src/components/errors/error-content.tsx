"use client";

import { motion } from "framer-motion";
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
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-lg"
      >
        <div className="surface-panel-subtle relative overflow-hidden p-8 text-center shadow-2xl backdrop-blur-sm md:p-10">
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#C9A227]/8 blur-3xl"
            aria-hidden="true"
          />

          <motion.div
            initial={{ scale: 0.65, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.45, ease: "easeOut" }}
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10"
            aria-hidden="true"
          >
            <AlertTriangle className="h-10 w-10 text-[#C9A227]" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-2xl font-semibold text-white md:text-3xl"
          >
            {title}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/50"
          >
            {t.desc}
          </motion.p>

          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.36, duration: 0.4 }}
            className="mx-auto my-6 h-px w-24 bg-[#C9A227]/20"
            aria-hidden="true"
          />

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42 }}
            className="flex flex-wrap justify-center gap-2"
          >
            <button type="button" onClick={reset} className={buttonVariants()}>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              {t.tryAgain}
            </button>
            <Link href="/" className={buttonVariants({ variant: "secondary" })}>
              <Home className="h-4 w-4" aria-hidden="true" />
              {t.home}
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
