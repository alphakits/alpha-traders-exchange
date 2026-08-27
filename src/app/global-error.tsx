"use client";

import "./globals.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, RefreshCcw, Home } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ErrorLocale = "ar" | "en";

const ERROR_COPY = {
  ar: {
    title: "حدث خطأ غير متوقع",
    description: "حدث خطأ أثناء تحميل الصفحة. حاول مرة أخرى، وإذا استمرت المشكلة فحدّث الصفحة أو ارجع إلى الرئيسية.",
    retry: "المحاولة مرة أخرى",
    home: "الرئيسية",
  },
  en: {
    title: "Something went wrong",
    description: "A critical error occurred. Please try again — if the issue persists, refresh the page or return home.",
    retry: "Try Again",
    home: "Home",
  },
} as const;

export function resolveGlobalErrorLocale(pathname: string, documentLanguage = ""): ErrorLocale {
  const localeSegment = pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  if (localeSegment === "ar" || localeSegment === "en") return localeSegment;

  const normalizedDocumentLanguage = documentLanguage.trim().toLowerCase();
  if (normalizedDocumentLanguage === "en" || normalizedDocumentLanguage.startsWith("en-")) return "en";
  if (normalizedDocumentLanguage === "ar" || normalizedDocumentLanguage.startsWith("ar-")) return "ar";

  // Arabic is the application's default locale.
  return "ar";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A root global error boundary has no server-side access to the nested locale
  // segment. Render both languages first, then narrow to the detected locale
  // after hydration. This prevents an English visitor from receiving an
  // Arabic-only error (or vice versa) in the server-rendered fallback.
  const [locale, setLocale] = useState<ErrorLocale | null>(null);
  const activeCopy = locale ? ERROR_COPY[locale] : null;

  useEffect(() => {
    console.error("[global-error]", error.message, error.digest);
    setLocale(resolveGlobalErrorLocale(window.location.pathname, document.documentElement.lang));
  }, [error]);

  return (
    <html lang={locale ?? "mul"} dir={locale === "en" ? "ltr" : locale === "ar" ? "rtl" : "auto"} suppressHydrationWarning>
      <body className="relative bg-[#0B0B0B] text-white antialiased">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-lg">
            <div className="surface-panel-subtle relative overflow-hidden p-8 text-center shadow-2xl backdrop-blur-sm md:p-10">
              {/* Radial glow */}
              <div
                className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#C9A227]/10 blur-3xl"
                aria-hidden="true"
              />

              {/* Icon */}
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10">
                <ShieldAlert className="h-10 w-10 text-[#C9A227]" aria-hidden="true" />
              </div>

              {/* Title */}
              <h1 className="text-2xl font-semibold text-white md:text-3xl">
                {activeCopy ? activeCopy.title : (
                  <span className="grid gap-1">
                    <span lang="ar" dir="rtl">{ERROR_COPY.ar.title}</span>
                    <span lang="en" dir="ltr">{ERROR_COPY.en.title}</span>
                  </span>
                )}
              </h1>

              {/* Description */}
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/50">
                {activeCopy ? activeCopy.description : (
                  <span className="grid gap-2">
                    <span lang="ar" dir="rtl">{ERROR_COPY.ar.description}</span>
                    <span lang="en" dir="ltr">{ERROR_COPY.en.description}</span>
                  </span>
                )}
              </p>

              {/* Divider */}
              <div className="mx-auto my-6 h-px w-24 bg-[#C9A227]/20" aria-hidden="true" />

              {/* Buttons */}
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className={buttonVariants()}
                >
                  <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                  {activeCopy ? activeCopy.retry : (
                    <span>
                      <span lang="ar" dir="rtl">{ERROR_COPY.ar.retry}</span>
                      <span aria-hidden="true"> / </span>
                      <span lang="en" dir="ltr">{ERROR_COPY.en.retry}</span>
                    </span>
                  )}
                </button>
                <Link
                  href={locale ? `/${locale}` : "/"}
                  className={cn(buttonVariants({ variant: "secondary" }))}
                >
                  <Home className="h-4 w-4" aria-hidden="true" />
                  {activeCopy ? activeCopy.home : (
                    <span>
                      <span lang="ar" dir="rtl">{ERROR_COPY.ar.home}</span>
                      <span aria-hidden="true"> / </span>
                      <span lang="en" dir="ltr">{ERROR_COPY.en.home}</span>
                    </span>
                  )}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
