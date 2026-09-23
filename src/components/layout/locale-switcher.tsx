"use client";

import { Globe } from "lucide-react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { LOCALE_CHOICE_COOKIE, LOCALE_CHOICE_MAX_AGE } from "@/i18n/locale-preference";

export function LocaleSwitcher() {
  const locale = useLocale() as AppLocale;
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale() {
    const nextLocale = locale === "ar" ? "en" : "ar";
    try {
      document.cookie = `${LOCALE_CHOICE_COOKIE}=${nextLocale}; Path=/; Max-Age=${LOCALE_CHOICE_MAX_AGE}; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    } catch {
      // Switching still works when the browser disallows preference storage.
    }
    const query = new URLSearchParams(window.location.search);
    const redirectTo = query.get("redirectTo");
    if (redirectTo && /^\/(ar|en)(?=\/|[?#]|$)/.test(redirectTo)) {
      query.set("redirectTo", redirectTo.replace(/^\/(ar|en)(?=\/|[?#]|$)/, `/${nextLocale}`));
    }
    const search = query.toString();
    router.replace(`${pathname}${search ? `?${search}` : ""}${window.location.hash}`, { locale: nextLocale });
  }

  return (
    <button
      type="button"
      onClick={switchLocale}
      aria-label={locale === "ar" ? "التبديل إلى الإنجليزية" : "Switch to Arabic"}
      className="inline-flex h-10 items-center gap-1 rounded-full border border-white/20 px-2 text-xs text-[#9CA3AF] hover:border-[#C9A227] hover:text-[#C9A227] sm:h-11 sm:gap-2 sm:px-3 sm:text-sm"
    >
      <Globe className="h-3.5 w-3.5" />
      {locale === "ar" ? "EN" : "AR"}
    </button>
  );
}
