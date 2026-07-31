"use client";

import { motion } from "framer-motion";
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
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-lg"
      >
        <div className="surface-panel-subtle relative overflow-hidden p-8 shadow-2xl backdrop-blur-sm md:p-10">
          {/* Radial glow */}
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#C9A227]/10 blur-3xl"
            aria-hidden="true"
          />

          {/* Icon */}
          <motion.div
            initial={{ scale: 0.65, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.45, ease: "easeOut" }}
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10"
            aria-hidden="true"
          >
            <FileSearch className="h-10 w-10 text-[#C9A227]" />
          </motion.div>

          {/* Badge */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-center text-xs font-bold uppercase tracking-[0.35em] text-[#C9A227]"
          >
            {t.code}
          </motion.p>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="mt-2 text-center text-2xl font-semibold leading-tight text-white md:text-3xl"
          >
            {t.title}
          </motion.h1>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.32 }}
            className="mx-auto mt-3 max-w-sm text-center text-sm leading-relaxed text-white/50"
          >
            {t.desc}
          </motion.p>

          {/* Divider */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.38, duration: 0.4 }}
            className="mx-auto my-6 h-px w-24 bg-[#C9A227]/20"
            aria-hidden="true"
          />

          {/* Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42 }}
            className="flex flex-wrap justify-center gap-2"
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
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
