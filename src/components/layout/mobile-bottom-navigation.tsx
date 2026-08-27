"use client";

import { Bell, Handshake, House, Store, UserRound } from "lucide-react";
import type { ComponentType } from "react";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

type MobileDestination = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  isActive: (pathname: string) => boolean;
};

function normalizePathname(pathname: string, locale: AppLocale) {
  const withoutLocale = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), "");
  return withoutLocale || "/";
}

export function MobileBottomNavigation({ locale }: { locale: AppLocale }) {
  const { user } = useCanonicalSession();
  const rawPathname = usePathname();
  const pathname = normalizePathname(rawPathname, locale);
  const isAr = locale === "ar";

  if (!user) return null;

  // The active Trade Room has its own bottom-anchored message and action UI.
  // Keeping this bar out of that focused screen prevents either control from
  // covering the other on short phones and landscape displays.
  if (pathname.startsWith("/trade-room/")) return null;

  const destinations: MobileDestination[] = [
    {
      href: "/dashboard",
      label: isAr ? "الرئيسية" : "Home",
      icon: House,
      isActive: (current) => current === "/dashboard" || current.startsWith("/dashboard/") || current === "/admin" || current.startsWith("/admin/"),
    },
    {
      href: "/usdt-exchange",
      label: isAr ? "السوق" : "Market",
      icon: Store,
      isActive: (current) => current === "/usdt-exchange" || current.startsWith("/usdt-exchange/") || current.startsWith("/exchange/"),
    },
    {
      href: "/trade-room",
      label: isAr ? "الصفقات" : "Trades",
      icon: Handshake,
      isActive: (current) => current === "/trade-room" || current.startsWith("/trade-room/"),
    },
    {
      href: "/notifications",
      label: isAr ? "الإشعارات" : "Notifications",
      icon: Bell,
      isActive: (current) => current === "/notifications" || current.startsWith("/notifications/"),
    },
    {
      href: "/profile",
      label: isAr ? "حسابي" : "Account",
      icon: UserRound,
      isActive: (current) => ["/profile", "/settings"].some(
        (prefix) => current === prefix || current.startsWith(`${prefix}/`),
      ),
    },
  ];

  return (
    <>
      <div aria-hidden="true" className="h-[calc(4rem+env(safe-area-inset-bottom))] lg:hidden" />
      <nav
        aria-label={isAr ? "التنقل الرئيسي للهاتف" : "Mobile primary navigation"}
        dir={isAr ? "rtl" : "ltr"}
        className="fixed inset-x-0 bottom-0 z-[45] border-t border-white/10 bg-[#070707]/95 shadow-[0_-12px_32px_rgba(0,0,0,0.5)] backdrop-blur-xl [padding-bottom:env(safe-area-inset-bottom)] lg:hidden"
      >
        <div className="mx-auto grid h-16 w-full max-w-lg grid-cols-5 px-1">
          {destinations.map((destination) => {
            const active = destination.isActive(pathname);
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
