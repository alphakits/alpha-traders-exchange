"use client";

import { ChartNoAxesCombined, Handshake, Newspaper, Settings } from "lucide-react";
import type { ComponentType } from "react";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

type MobileDestination = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  isActive: (pathname: string, section: string | null) => boolean;
};

function normalizePathname(pathname: string, locale: AppLocale) {
  const withoutLocale = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), "");
  return withoutLocale || "/";
}

export function MobileBottomNavigation({ locale }: { locale: AppLocale }) {
  const { user } = useCanonicalSession();
  const rawPathname = usePathname();
  const pathname = normalizePathname(rawPathname, locale);
  const section = null;
  const isAr = locale === "ar";

  if (!user) return null;

  // The active Trade Room has its own bottom-anchored message and action UI.
  // Keeping this bar out of that focused screen prevents either control from
  // covering the other on short phones and landscape displays.
  if (pathname.startsWith("/trade-room/")) return null;

  const destinations: MobileDestination[] = [
    { href: "/", label: isAr ? "السوق" : "Market", icon: ChartNoAxesCombined, isActive: (current) => current === "/" || current === "/market" },
    { href: "/trade", label: isAr ? "التداول" : "Trade", icon: Handshake, isActive: (current) => ["/trade", "/usdt-exchange", "/trade-room", "/exchange", "/dashboard/seller"].some((path) => current === path || current.startsWith(`${path}/`)) },
    { href: "/news", label: isAr ? "الأخبار" : "News", icon: Newspaper, isActive: (current) => current.startsWith("/news") },
    { href: "/settings", label: isAr ? "الإعدادات" : "Settings", icon: Settings, isActive: (current) => current.startsWith("/settings") },
  ];

  return (
    <>
      <div aria-hidden="true" className="h-[calc(4rem+env(safe-area-inset-bottom))] lg:hidden" />
      <nav
        aria-label={isAr ? "التنقل الرئيسي للهاتف" : "Mobile primary navigation"}
        dir={isAr ? "rtl" : "ltr"}
        className="fixed inset-x-0 bottom-0 z-[45] border-t border-white/10 bg-[#070707]/95 shadow-[0_-12px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl [padding-bottom:env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="mx-auto grid h-16 w-full max-w-lg grid-cols-4 px-1">
          {destinations.map((destination) => {
            const active = destination.isActive(pathname, section);
            const Icon = destination.icon;
            return (
              <Link
                key={destination.href}
                href={destination.href}
                locale={locale}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group inline-flex min-h-14 min-w-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl px-0.5 text-[#8F96A3] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#C9A227]/80",
                  active ? "text-[#F4D87A]" : "hover:bg-white/[0.04] hover:text-white active:bg-white/[0.07]",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-7 w-10 items-center justify-center rounded-full transition-colors duration-150",
                    active ? "bg-[#C9A227]/16" : "bg-transparent group-hover:bg-white/[0.05]",
                  )}
                >
                  <Icon className="h-[1.15rem] w-[1.15rem]" aria-hidden={true} />
                </span>
                <span className="max-w-full whitespace-nowrap text-[10px] font-semibold leading-none min-[390px]:text-[11px]">
                  {destination.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
