import Image from "next/image";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { getTradeHeaderStateForUser } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";
import { HeaderBrandText, SiteHeaderFrame } from "./site-header-frame";
import { HeaderNav } from "@/components/layout/header-nav";
import { HeaderAuthArea } from "@/components/layout/header-auth-area";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";
import { BRAND_DESCRIPTOR, BRAND_DESCRIPTOR_AR, BRAND_NAME, BRAND_PRIMARY_NAME } from "@/lib/brand";
import { toTradeHeaderActivity } from "@/lib/trade-header-activity";
import { TradeHeaderNotice } from "./trade-header-notice";

async function getNonBlockingTradeHeaderState(sessionUser: AlphaExchangeUser | null) {
  if (!sessionUser) {
    return { activeTrade: null, tradeReminder: null };
  }

  try {
    return await getTradeHeaderStateForUser(sessionUser.id, sessionUser.role);
  } catch {
    // Trade reminders are helpful navigation hints, but a temporary database
    // read failure must never take every authenticated page offline.
    console.error("[site-header] Noncritical trade state could not be loaded.");
    return { activeTrade: null, tradeReminder: null };
  }
}

async function TradeHeaderStatus({
  locale,
  sessionUser,
}: {
  locale: AppLocale;
  sessionUser: AlphaExchangeUser | null;
}) {
  if (!sessionUser) return null;
  const { activeTrade } = await getNonBlockingTradeHeaderState(sessionUser);
  const activeTradeCounterparty = activeTrade
    ? (activeTrade.sellerId === sessionUser.id ? activeTrade.buyerName : (locale === "ar" ? "البائع" : "seller"))
    : null;
  return <TradeHeaderNotice locale={locale} actorId={sessionUser.id}
    initialTrade={activeTrade ? toTradeHeaderActivity(activeTrade) : null}
    counterpartyName={activeTradeCounterparty} />;
}

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
  const [t, rootTranslations] = await Promise.all([
    getTranslations({ locale, namespace: "nav" }),
    getTranslations({ locale }),
  ]);
  const brand = rootTranslations("brand");

  const nav = [
    { href: "/", label: t("home") },
    { href: "/academy", label: t("academy") },
    { href: "/community", label: t("community") },
    { href: "/contact", label: t("contact") },
    { href: "/market", label: t("alphaExchange"), cta: true },
    ...(sessionUser && hasRole(sessionUser, "admin")
      ? [{ href: "/admin/discord", label: locale === "ar" ? "إدارة ديسكورد" : "Discord Management" }]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-gradient-to-b from-[#070707]/95 to-[#050505]/85 shadow-[0_14px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <SiteHeaderFrame>
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
          <HeaderBrandText signedIn={Boolean(sessionUser)} label={brand}>
            <span className="gold-gradient whitespace-nowrap bg-clip-text pb-px text-[0.78rem] leading-[1.15] text-transparent min-[390px]:text-[0.86rem] sm:text-[1.02rem]">{BRAND_PRIMARY_NAME}</span>
            <span className="whitespace-nowrap text-[0.42rem] font-semibold uppercase leading-tight tracking-[0.09em] text-[#D4AF37] min-[390px]:text-[0.48rem] sm:text-[0.55rem] sm:tracking-[0.16em]">{locale === "ar" ? BRAND_DESCRIPTOR_AR : BRAND_DESCRIPTOR}</span>
          </HeaderBrandText>
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
      </SiteHeaderFrame>
      <Suspense fallback={null}>
        <TradeHeaderStatus locale={locale} sessionUser={sessionUser} />
      </Suspense>
    </header>
  );
}
