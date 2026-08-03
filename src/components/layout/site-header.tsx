import { Menu } from "lucide-react";
import Image from "next/image";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { AUTH_COOKIE_NAME, getCurrentSessionUser } from "@/lib/auth";
import { getFirstActiveTradeForUser } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { LogoutButton } from "@/components/auth/logout-button";
import { CreateListingQuickLink } from "@/components/layout/create-listing-quick-link";
import { LocaleSwitcher } from "./locale-switcher";

export async function SiteHeader({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "nav" });
  const brand = (await getTranslations({ locale }))("brand");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
  const sessionUser = sessionToken ? await getCurrentSessionUser() : null;
  const activeTrade = sessionUser ? await getFirstActiveTradeForUser(sessionUser.id, sessionUser.role) : null;
  const activeTradeCounterparty = activeTrade
    ? (activeTrade.sellerId === sessionUser?.id ? activeTrade.buyerName : (locale === "ar" ? "البائع" : "seller"))
    : null;
  const dashboardHref = sessionUser ? "/profile" : "/login";
  const dashboardLabel = sessionUser ? t("profile") : t("signIn");
  const canAccessSellerWorkspace = Boolean(
    sessionUser && (hasRole(sessionUser, "approved_seller") || hasRole(sessionUser, "admin") || hasRole(sessionUser, "owner")),
  );
  const canAccessAdminDashboard = Boolean(sessionUser && hasRole(sessionUser, "admin"));

  const nav = [
    { href: "/", label: t("home") },
    { href: "/academy", label: t("academy") },
    { href: "/community", label: t("community") },
    { href: "/contact", label: t("contact") },
    { href: "/usdt-exchange", label: t("alphaExchange"), cta: true },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050505]/90 shadow-[0_14px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="section-container relative flex h-16 items-center justify-between">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#C9A227]/45 to-transparent" />
        <Link href="/" locale={locale} className="inline-flex items-center gap-3 text-lg font-semibold tracking-wide text-white">
          <Image
            src="/images/brand/alpha-traders-logo.webp"
            alt="Alpha Traders logo"
            width={42}
            height={42}
            priority
            style={{ width: 42, height: 42 }}
            className="rounded-full border border-[#C9A227]/45 bg-black/35 p-0.5 object-cover shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
          />
          <span className="gold-gradient inline-block bg-clip-text pb-px text-[1.02rem] leading-[1.15] text-transparent">
            {brand}
          </span>
        </Link>
        <nav className="hidden items-center gap-2 lg:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              locale={locale}
              className={
                item.cta
                  ? "group relative overflow-hidden rounded-full border border-[#6CAEFF]/45 bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_26px_rgba(36,121,255,0.34)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(36,121,255,0.5)]"
                  : "group relative rounded-full px-4 py-2 text-sm text-[#AEB4C0] transition hover:bg-white/[0.04] hover:text-white"
              }
            >
              {item.label}
              {item.cta ? (
                <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition duration-700 group-hover:left-[120%] group-hover:opacity-100" />
              ) : (
                <span className="pointer-events-none absolute inset-x-4 -bottom-[1px] h-px origin-center scale-x-0 bg-[#C9A227]/80 transition duration-300 group-hover:scale-x-100" />
              )}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          {sessionUser ? (
            <div className="hidden items-center rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 text-xs text-[#D1D5DB] sm:inline-flex">
              <span className="max-w-[140px] truncate">{sessionUser.fullName}</span>
            </div>
          ) : null}
          <Link href={dashboardHref} locale={locale} className={cn(buttonVariants({ size: "sm" }), "inline-flex")}>
            {dashboardLabel}
          </Link>
          {canAccessSellerWorkspace ? (
            <CreateListingQuickLink
              className="hidden items-center gap-1.5 rounded-full border border-[#C9A227]/50 bg-gradient-to-r from-[#C9A227]/20 to-[#D4AF37]/10 px-3 py-1.5 text-xs font-semibold text-[#F4D87A] shadow-[0_4px_16px_rgba(201,162,39,0.25)] transition hover:border-[#C9A227]/70 hover:shadow-[0_6px_20px_rgba(201,162,39,0.35)] md:inline-flex"
              label={locale === "ar" ? "إنشاء عرض" : "Create Listing"}
            />
          ) : null}
          {sessionUser ? <NotificationBell locale={locale} /> : null}
          {sessionUser ? (
            <LogoutButton
              locale={locale}
              size="sm"
              variant="secondary"
              className="hidden text-[#D1D5DB] hover:bg-white/10 hover:text-white sm:inline-flex"
              idleLabel={t("signOut")}
            />
          ) : null}
          <details className="group relative lg:hidden">
            <summary className="inline-flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border border-white/20 text-[#9CA3AF] hover:border-[#C9A227] hover:text-[#C9A227]">
              <Menu className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </summary>
            <div className="absolute end-0 top-12 w-60 rounded-2xl border border-white/15 bg-[#0b0b0b]/95 p-3 shadow-2xl backdrop-blur-xl">
              <nav className="space-y-1">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    locale={locale}
                    className={
                      item.cta
                        ? "group relative block overflow-hidden rounded-full border border-[#6CAEFF]/45 bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 px-3 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(36,121,255,0.32)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(36,121,255,0.42)]"
                        : "block rounded-xl px-3 py-2 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white"
                    }
                  >
                    {item.label}
                    {item.cta ? (
                      <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition duration-700 group-hover:left-[120%] group-hover:opacity-100" />
                    ) : null}
                  </Link>
                ))}
                <div className="border-t border-white/10 pt-2">
                  {sessionUser ? (
                    <div className="rounded-lg px-3 py-2 text-xs text-[#9CA3AF]">
                      {sessionUser.fullName}
                    </div>
                  ) : null}
                  <Link href={dashboardHref} locale={locale} className="block rounded-xl px-3 py-2 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white">
                    {dashboardLabel}
                  </Link>
                  {canAccessSellerWorkspace ? (
                    <CreateListingQuickLink
                      className="block rounded-xl px-3 py-2 text-sm font-medium text-[#F4D87A] transition hover:bg-[#C9A227]/10"
                      label={locale === "ar" ? "إنشاء عرض" : "Create Listing"}
                    />
                  ) : null}
                  {sessionUser ? (
                    <Link href="/notifications" locale={locale} className="block rounded-xl px-3 py-2 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white">
                      {t("notifications")}
                    </Link>
                  ) : null}
                  {canAccessAdminDashboard ? (
                    <Link
                      href="/admin/alpha-exchange"
                      locale={locale}
                      className="block rounded-xl border border-[#C9A227]/40 bg-[#C9A227]/10 px-3 py-2 text-sm font-medium text-[#F4D87A] transition hover:border-[#C9A227]/60 hover:bg-[#C9A227]/15"
                    >
                      🛠 {locale === "ar" ? "لوحة الإدارة" : "Admin Dashboard"}
                    </Link>
                  ) : null}
                  {sessionUser ? (
                    <LogoutButton
                      locale={locale}
                      variant="ghost"
                      className="mt-1 block w-full justify-start rounded-xl px-3 py-2 text-start text-sm text-[#D1D5DB] hover:bg-white/5 hover:text-white"
                      idleLabel={t("signOut")}
                    />
                  ) : null}
                </div>
              </nav>
            </div>
          </details>
        </div>
      </div>
      {sessionUser && activeTrade ? (
      <div className="section-container pb-2">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-400/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          <p className="truncate">
            🟢 {locale === "ar" ? "صفقة نشطة" : "Active Trade"} — {locale === "ar" ? "تابع الصفقة مع" : "Continue trade with"}{" "}
            <span className="font-semibold text-white">{activeTradeCounterparty}</span>
          </p>
          <Link href={`/trade-room/${activeTrade.id}`} locale={locale} className="shrink-0 rounded-full border border-emerald-300/40 bg-emerald-500/20 px-3 py-1 text-[11px] font-semibold text-emerald-100 transition hover:border-emerald-200 hover:bg-emerald-500/30">
            {locale === "ar" ? "استئناف الصفقة" : "Resume Trade"}
          </Link>
        </div>
      </div>
      ) : null}
    </header>
  );
}
