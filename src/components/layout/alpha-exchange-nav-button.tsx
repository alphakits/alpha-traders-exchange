"use client";

import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

type AlphaExchangeNavButtonProps = {
  locale: AppLocale;
  label: string;
  mobile?: boolean;
};

export function AlphaExchangeNavButton({ locale, label, mobile = false }: AlphaExchangeNavButtonProps) {
  const pathname = usePathname();
  const isActive = pathname === "/usdt-exchange" || pathname.startsWith("/usdt-exchange/");

  if (mobile) {
    return (
      <Link
        href="/usdt-exchange"
        locale={locale}
        className={cn(
          "group relative block overflow-hidden rounded-lg border border-[#6CAEFF]/45 px-3 py-2 text-sm font-semibold text-white transition duration-300",
          "bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 shadow-[0_10px_24px_rgba(36,121,255,0.32)] backdrop-blur-xl",
          "hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(36,121,255,0.42)]",
          isActive ? "ring-1 ring-[#9DCCFF] shadow-[0_0_0_1px_rgba(157,204,255,0.45),0_16px_34px_rgba(36,121,255,0.5)]" : "",
        )}
      >
        <span className="relative z-10">{label}</span>
        <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition duration-700 group-hover:left-[120%] group-hover:opacity-100" />
      </Link>
    );
  }

  return (
    <Link href="/usdt-exchange" locale={locale} className="hidden sm:inline-flex">
      <span
        className={cn(
          "group relative inline-flex h-9 items-center justify-center overflow-hidden rounded-full border px-4 text-sm font-semibold text-white transition-all duration-300",
          "border-[#6CAEFF]/45 bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 shadow-[0_10px_26px_rgba(36,121,255,0.34)] backdrop-blur-xl",
          "hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(36,121,255,0.5)]",
          isActive
            ? "ring-1 ring-[#9DCCFF] shadow-[0_0_0_1px_rgba(157,204,255,0.45),0_16px_34px_rgba(36,121,255,0.52)]"
            : "",
        )}
      >
        <span className="relative z-10">{label}</span>
        <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition duration-700 group-hover:left-[120%] group-hover:opacity-100" />
      </span>
    </Link>
  );
}
