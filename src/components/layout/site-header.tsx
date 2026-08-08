import Image from "next/image";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { AUTH_COOKIE_NAME, getCurrentSessionUser } from "@/lib/auth";
import { getFirstActiveTradeForUser, getTradeReminderForUser } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { LogoutButton } from "@/components/auth/logout-button";
import { CreateListingQuickLink } from "@/components/layout/create-listing-quick-link";
import { MobileNavigationMenu } from "@/components/layout/mobile-navigation-menu";
import { HeaderNav } from "@/components/layout/header-nav";
import { LocaleSwitcher } from "./locale-switcher";

export async function SiteHeader({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "nav" });
  const brand = (await getTranslations({ locale }))("brand");
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
  const sessionUser = sessionToken ? await getCurrentSessionUser() : null;
  const activeTrade = sessionUser ? await getFirstActiveTradeForUser(sessionUser.id, sessionUser.role) : null;
  const tradeReminder = sessionUser ? await getTradeReminderForUser(sessionUser.id, sessionUser.role) : null;
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
    <header className="sticky top-0 z-40 border-b border-white/10 bg-gradient-to-b from-[#070707]/95 to-[#050505]/85 shadow-[0_14px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="section-container relative flex h-14 items-center justify-between gap-3">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#C9A227]/45 to-transparent" />
        <Link href="/" locale={locale} className="inline-flex min-w-0 items-center gap-2 text-lg font-semibold tracking-wide text-white sm:gap-3">
          <Image
            src="/images/brand/alpha-traders-logo.webp"
            alt="Alpha Traders logo"
            width={38}
            height={38}
            priority
            style={{ width: 38, height: 38 }}
            className="rounded-full border border-[#C9A227]/45 bg-black/35 p-0.5 object-cover shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
          />
          <span className="gold-gradient hidden bg-clip-text pb-px text-[1.02rem] leading-[1.15] text-transparent min-[360px]:inline-block">
            {brand}
          </span>
        </Link>
        <HeaderNav items={nav} locale={locale} />
        <div className="flex items-center gap-2">
          <LocaleSwitcher />
          {sessionUser ? (
            <div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 text-xs text-[#D1D5DB] sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
              <span className="max-w-[140px] truncate">{sessionUser.fullName}</span>
            </div>
          ) : null}
          <Link href={dashboardHref} locale={locale} className={cn(buttonVariants({ size: "sm" }), "inline-flex sm:hidden")}>
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
          <MobileNavigationMenu label={locale === "ar" ? "فتح القائمة" : "Open menu"}>
            <nav className="space-y-1">
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    locale={locale}
                    className={
                      item.cta
                        ? "group relative flex min-h-11 items-center overflow-hidden rounded-full border border-[#6CAEFF]/45 bg-gradient-to-r from-[#1B60ED]/85 via-[#2A7BFF]/80 to-[#3A9DFF]/75 px-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(36,121,255,0.32)] backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(36,121,255,0.42)]"
                        : "flex min-h-11 items-center rounded-xl px-3 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white"
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
                  <Link href={dashboardHref} locale={locale} className="flex min-h-11 items-center rounded-xl px-3 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white">
                    {dashboardLabel}
                  </Link>
                  {canAccessSellerWorkspace ? (
                    <CreateListingQuickLink
                      className="block rounded-xl px-3 py-2 text-sm font-medium text-[#F4D87A] transition hover:bg-[#C9A227]/10"
                      label={locale === "ar" ? "إنشاء عرض" : "Create Listing"}
                    />
                  ) : null}
                  {sessionUser ? (
                    <Link href="/notifications" locale={locale} className="flex min-h-11 items-center rounded-xl px-3 text-sm text-[#D1D5DB] transition hover:bg-white/5 hover:text-white">
                      {t("notifications")}
                    </Link>
                  ) : null}
                  {canAccessAdminDashboard ? (
                    <div className="space-y-1">
                      <Link
                        href="/admin/alpha-exchange"
                        locale={locale}
                        className="flex min-h-11 items-center rounded-xl border border-[#C9A227]/40 bg-[#C9A227]/10 px-3 py-2 text-sm font-medium text-[#F4D87A] transition hover:border-[#C9A227]/60 hover:bg-[#C9A227]/15"
                      >
                        🛠 {locale === "ar" ? "لوحة الإدارة" : "Admin Dashboard"}
                      </Link>
                      <Link
                        href="/admin/discord"
                        locale={locale}
                        className="flex min-h-11 items-center rounded-xl border border-[#C9A227]/25 bg-black/25 px-3 py-2 text-sm font-medium text-[#E5D49A] transition hover:border-[#C9A227]/50 hover:bg-[#C9A227]/10"
                      >
                        ◉ {locale === "ar" ? "إدارة ديسكورد" : "Discord Management"}
                      </Link>
                    </div>
                  ) : null}
                  {sessionUser ? (
                    <LogoutButton
                      locale={locale}
                      variant="ghost"
                      className="mt-1 w-full justify-start rounded-xl px-3 text-start text-sm text-[#D1D5DB] hover:bg-white/5 hover:text-white"
                      idleLabel={t("signOut")}
                    />
                  ) : null}
                </div>
            </nav>
          </MobileNavigationMenu>
          <Link href={dashboardHref} locale={locale} className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}>
            {dashboardLabel}
          </Link>
        </div>
      </div>
      {sessionUser && (tradeReminder || activeTrade) ? (
      <div className="section-container pb-2">
        <div className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs ${tradeReminder ? "border border-amber-400/35 bg-amber-500/10 text-amber-100" : "border border-emerald-400/35 bg-emerald-500/10 text-emerald-100"}`}>
          <p className="truncate">
            {tradeReminder ? (
              <>
                🔔 {tradeReminder.title} — {tradeReminder.message}
              </>
            ) : (
              <>
                🟢 {locale === "ar" ? "صفقة نشطة" : "Active Trade"} — {locale === "ar" ? "تابع الصفقة مع" : "Continue trade with"}{" "}
                <span className="font-semibold text-white">{activeTradeCounterparty}</span>
              </>
            )}
          </p>
          <Link href={tradeReminder?.actionHref ?? `/trade-room/${activeTrade!.id}`} locale={locale} className="shrink-0 rounded-full border border-current/40 bg-white/10 px-3 py-1 text-[11px] font-semibold transition hover:bg-white/15">
            {tradeReminder?.actionLabel ?? (locale === "ar" ? "استئناف الصفقة" : "Resume Trade")}
          </Link>
        </div>
      </div>
      ) : null}
    </header>
  );
}
