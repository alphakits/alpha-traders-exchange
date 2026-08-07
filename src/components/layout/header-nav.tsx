"use client";

import { Link, usePathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export type HeaderNavItem = { href: string; label: string; cta?: boolean };

/**
 * Premium desktop navigation with active-route highlighting. Uses next-intl's
 * locale-agnostic pathname so the active state is correct in every locale
 * without a flash of unstyled/incorrect state.
 */
export function HeaderNav({ items, locale }: { items: HeaderNavItem[]; locale: AppLocale }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
      {items.map((item) => {
        const active = isActive(item.href);
        if (item.cta) {
          return (
            <Link
              key={item.href}
              href={item.href}
              locale={locale}
              aria-current={active ? "page" : undefined}
              className="group relative ml-1 overflow-hidden rounded-full border border-[#6CAEFF]/45 bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_26px_rgba(36,121,255,0.34)] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(36,121,255,0.5)]"
            >
              {item.label}
              <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition duration-700 group-hover:left-[120%] group-hover:opacity-100" />
            </Link>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            locale={locale}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative rounded-full px-3.5 py-2 text-sm transition-colors duration-200",
              active ? "text-white" : "text-[#AEB4C0] hover:bg-white/[0.04] hover:text-white",
            )}
          >
            {item.label}
            <span
              className={cn(
                "pointer-events-none absolute inset-x-3 -bottom-[1px] h-px origin-center bg-[#C9A227]/80 transition-transform duration-200",
                active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
