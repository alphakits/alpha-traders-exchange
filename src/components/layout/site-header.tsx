import Image from "next/image";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { getFirstActiveTradeForUser, getTradeReminderForUser } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import { HeaderNav } from "@/components/layout/header-nav";
import { HeaderAuthArea } from "@/components/layout/header-auth-area";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { BRAND_DESCRIPTOR, BRAND_DESCRIPTOR_AR, BRAND_NAME, BRAND_PRIMARY_NAME } from "@/lib/brand";

export async function SiteHeader({
  locale,
  sessionUser,
}: {
  locale: AppLocale;
  /**
   * The locale layout already resolved the authoritative server session for
   * this render. Reusing that snapshot avoids two independent auth reads
   * producing a header/UI mismatch during navigation or session expiry.
   */
  sessionUser: AlphaExchangeUser | null;
}) {
  const t = await getTranslations({ locale, namespace: "nav" });
  const brand = (await getTranslations({ locale }))("brand");
  const activeTrade = sessionUser ? await getFirstActiveTradeForUser(sessionUser.id, sessionUser.role) : null;
  const tradeReminder = sessionUser ? await getTradeReminderForUser(sessionUser.id, sessionUser.role) : null;
  const activeTradeCounterparty = activeTrade
    ? (activeTrade.sellerId === sessionUser?.id ? activeTrade.buyerName : (locale === "ar" ? "البائع" : "seller"))
    : null;

  const nav = [
    { href: "/", label: t("home") },
    { href: "/academy", label: t("academy") },
    { href: "/community", label: t("community") },
    { href: "/contact", label: t("contact") },
    { href: "/usdt-exchange", label: t("alphaExchange"), cta: true },
    ...(sessionUser && hasRole(sessionUser, "admin")
      ? [{ href: "/admin/discord", label: locale === "ar" ? "إدارة ديسكورد" : "Discord Management" }]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-gradient-to-b from-[#070707]/95 to-[#050505]/85 shadow-[0_14px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="section-container relative flex h-16 items-center justify-between gap-1.5 sm:gap-3">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#C9A227]/45 to-transparent" />
        <Link href="/" locale={locale} className="inline-flex shrink-0 items-center gap-1.5 text-lg font-semibold tracking-wide text-white min-[390px]:gap-2 sm:gap-3">
          <Image
            src="/images/brand/alpha-traders-logo.webp"
            alt={locale === "ar" ? `شعار ${BRAND_PRIMARY_NAME}` : `${BRAND_NAME} logo`}
            width={48}
            height={48}
            priority
            className="h-10 w-10 rounded-xl border border-[#C9A227]/45 bg-black/35 object-cover shadow-[0_4px_16px_rgba(0,0,0,0.45)] min-[390px]:h-11 min-[390px]:w-11 sm:h-12 sm:w-12"
          />
          <span className="hidden shrink-0 flex-col min-[360px]:flex" aria-label={brand}>
            <span className="gold-gradient whitespace-nowrap bg-clip-text pb-px text-[0.78rem] leading-[1.15] text-transparent min-[390px]:text-[0.86rem] sm:text-[1.02rem]">{BRAND_PRIMARY_NAME}</span>
            <span className="whitespace-nowrap text-[0.42rem] font-semibold uppercase leading-tight tracking-[0.09em] text-[#D4AF37] min-[390px]:text-[0.48rem] sm:text-[0.55rem] sm:tracking-[0.16em]">{locale === "ar" ? BRAND_DESCRIPTOR_AR : BRAND_DESCRIPTOR}</span>
          </span>
        </Link>
        <HeaderNav items={nav} locale={locale} />
        <HeaderAuthArea
          locale={locale}
          navItems={nav}
          initialSessionUser={sessionUser ? { id: sessionUser.id, fullName: sessionUser.fullName, role: sessionUser.role, roles: sessionUser.roles ?? [sessionUser.role], sellerStatus: sessionUser.sellerStatus } : null}
          labels={{
            signIn: t("signIn"),
            profile: t("profile"),
            signOut: t("signOut"),
            notifications: t("notifications"),
            createListing: locale === "ar" ? "إنشاء عرض" : "Create Listing",
            adminDashboard: locale === "ar" ? "لوحة الإدارة" : "Admin Dashboard",
            openMenu: locale === "ar" ? "فتح القائمة" : "Open menu",
          }}
        />
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
