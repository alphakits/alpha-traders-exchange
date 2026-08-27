"use client";

import { Globe } from "lucide-react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

export function LocaleSwitcher() {
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: locale === "ar" ? "en" : "ar" })}
      aria-label={locale === "ar" ? "التبديل إلى الإنجليزية" : "Switch to Arabic"}
      className="inline-flex h-10 items-center gap-1 rounded-full border border-white/20 px-2 text-xs text-[#9CA3AF] hover:border-[#C9A227] hover:text-[#C9A227] sm:h-11 sm:gap-2 sm:px-3 sm:text-sm"
    >
      <Globe className="h-3.5 w-3.5" />
      {locale === "ar" ? "EN" : "AR"}
    </button>
  );
}
