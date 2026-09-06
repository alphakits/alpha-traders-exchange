import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("mobile accessibility completion", () => {
  it("honors native reduced-motion settings and keeps enlarged tab labels unclipped", () => {
    const rootLayout = source("apps/mobile/app/_layout.tsx");
    const publicLayout = source("apps/mobile/app/(public)/_layout.tsx");
    const reducedMotion = source("apps/mobile/src/accessibility/use-reduced-motion.ts");
    const tabs = source("apps/mobile/app/(tabs)/_layout.tsx");
    const languageSwitch = source("apps/mobile/src/components/language-switch.tsx");
    const tokens = source("packages/design-tokens/src/index.ts");

    expect(reducedMotion).toContain("AccessibilityInfo.isReduceMotionEnabled()");
    expect(reducedMotion).toContain('"reduceMotionChanged"');
    expect(rootLayout).toContain('animation: isReducedMotionEnabled ? "none" : "fade"');
    expect(publicLayout).toContain('isReducedMotionEnabled ? "none"');
    expect(publicLayout).toContain('isRTL ? "slide_from_left" : "slide_from_right"');
    expect(tabs).toContain("minHeight: 68");
    expect(tabs).not.toContain("height: 68");
    expect(languageSwitch).toContain("minHeight: 44");
    expect(tokens).toContain("small: 14");
    expect(tokens).toContain("caption: 12");
  });

  it("preserves spoken labels and busy state on native loading buttons", () => {
    const button = source("apps/mobile/src/components/gold-button.tsx");

    expect(button).toContain("const spokenLabel = accessibilityLabel");
    expect(button).toContain("accessibilityLabel={spokenLabel}");
    expect(button).toContain("busy: loading");
    expect(button).toContain("disabled: isDisabled");
    expect(button).toContain("<ActivityIndicator accessible={false}");
  });

  it("gives native financial forms explicit labels, roles, and alert semantics", () => {
    const login = source("apps/mobile/app/(public)/login.tsx");
    const tradeForm = source("apps/mobile/src/screens/trade-form-screen.tsx");
    const tradeRoom = source("apps/mobile/src/screens/trade-detail-screen.tsx");

    expect(login).toContain('accessibilityLabel={t("email")}');
    expect(login).toContain('accessibilityLabel={t("password")}');
    expect(tradeForm).toContain('accessibilityRole="radiogroup"');
    expect(tradeForm).toContain('accessibilityLabel={t("tradeAmount")}');
    expect(tradeForm).toContain('accessibilityLabel={`${t("receivingWallet")} · ${listing.network}`}');
    expect(tradeForm).toContain("activeFormScopeRef");
    expect(tradeForm).toContain("setWalletAddress(\"\")");
    expect(tradeRoom).toContain('accessibilityRole="header"');
    expect(tradeRoom).toContain('accessibilityRole="alert"');
    expect(tradeRoom).toContain("activeTradeScopeRef");
    expect(tradeRoom).toContain("setBankDetails(null)");
  });

  it("keeps recovery surfaces scrollable and text-link targets at least 44 points", () => {
    const biometricLock = source("apps/mobile/src/components/biometric-lock-screen.tsx");
    const sessionRecovery = source("apps/mobile/src/components/session-recovery-screen.tsx");
    const login = source("apps/mobile/app/(public)/login.tsx");

    expect(biometricLock).toContain("<ScrollView");
    expect(biometricLock).toContain("flexGrow: 1");
    expect(sessionRecovery).toContain("<ScrollView");
    expect(sessionRecovery).toContain("flexGrow: 1");
    expect(login).toContain("minHeight: 44");
    expect(login.match(/style=\{styles\.textLinkTarget\}/g)).toHaveLength(4);
  });

  it("labels the footer newsletter field and keeps mobile footer targets usable", () => {
    const footer = source("src/components/layout/site-footer.tsx");
    const newsletter = source("src/components/layout/footer-newsletter-signup.tsx");

    expect(footer).toContain('<FooterNewsletterSignup locale={locale} />');
    expect(newsletter).toContain('htmlFor="footer-newsletter-email"');
    expect(newsletter).toContain('id="footer-newsletter-email"');
    expect(newsletter).toContain('name="email"');
    expect(newsletter).toContain('autoComplete="email"');
    expect(footer).toContain('<summary className="flex min-h-11');
    expect(footer).toContain('inline-flex min-h-11 items-center gap-2');
  });

  it("shows a visible keyboard focus boundary around the embedded market chart", () => {
    const chart = source("src/components/market/tradingview-market-charts.tsx");

    expect(chart).toContain('title={title}');
    expect(chart).toContain('focus-visible:ring-2');
    expect(chart).toContain('focus-visible:ring-[#C9A227]');
  });

  it("keeps coarse-pointer checkbox and radio controls at least 24px", () => {
    const css = source("src/app/globals.css");
    const coarsePointerStart = css.indexOf('@media (max-width: 768px) and (pointer: coarse)');
    const reducedMotionStart = css.indexOf('@media (prefers-reduced-motion: reduce)', coarsePointerStart);
    const coarsePointerRules = css.slice(coarsePointerStart, reducedMotionStart);

    expect(coarsePointerStart).toBeGreaterThan(-1);
    expect(reducedMotionStart).toBeGreaterThan(coarsePointerStart);
    expect(coarsePointerRules).toContain('input[type="checkbox"]');
    expect(coarsePointerRules).toContain('input[type="radio"]');
    expect(coarsePointerRules).toContain('min-width: 1.5rem');
    expect(coarsePointerRules).toContain('min-height: 1.5rem');
  });

  it("renders final homepage statistics immediately instead of exposing zero-value placeholders", () => {
    const stats = source("src/components/sections/home/homepage-stats.tsx");

    expect(stats).toContain('numericValue: 20');
    expect(stats).toContain('numericValue: 2');
    expect(stats).toContain('numericValue: 100');
    expect(stats).toContain('{displayValue}');
    expect(stats).not.toContain('useInView');
    expect(stats).not.toContain('setDisplayValue');
  });

  it("keeps the static homepage shell server-rendered to protect the mobile JavaScript budget", () => {
    const home = source("src/components/sections/home/home-page.tsx");

    expect(home).not.toContain('"use client"');
    expect(home).not.toContain("useTranslations(");
    expect(home).not.toContain("useLocale(");
    expect(home).toContain('getTranslations({ locale, namespace: "home" })');
  });

  it("keeps optimized dialogs keyboard-dismissible, screen-reader labeled, and scroll locked", () => {
    const marketplace = source("src/components/sections/usdt-exchange/usdt-exchange-page.tsx");
    const purchaseDialog = source("src/components/sections/usdt-exchange/purchase-listing-dialog.tsx");
    const lesson = source("src/components/lessons/lesson-interface.tsx");
    const admin = source("src/components/admin/alpha-exchange-admin-dashboard.tsx");

    for (const dialogSource of [marketplace, lesson, admin]) {
      expect(dialogSource).toContain('role="dialog"');
      expect(dialogSource).toContain('aria-modal="true"');
      expect(dialogSource).toContain('"Escape"');
      expect(dialogSource).toContain('document.body.style.overflow = "hidden"');
    }

    expect(purchaseDialog).toContain('role="dialog"');
    expect(purchaseDialog).toContain('aria-modal="true"');
    expect(purchaseDialog).toContain('aria-label={priceMode === "buyer_offer"');
    expect(purchaseDialog).toContain('"Make a Price Offer"');
    expect(purchaseDialog).toContain('"تقديم عرض سعر"');
    expect(purchaseDialog).toContain('"Buy USDT"');
    expect(purchaseDialog).toContain('"شراء USDT"');
  });

  it("keeps optional exchange workflows out of the initial route bundle", () => {
    const marketplace = source("src/components/sections/usdt-exchange/usdt-exchange-page.tsx");
    const purchaseDialog = source("src/components/sections/usdt-exchange/purchase-listing-dialog.tsx");
    const buyerWorkspace = source("src/components/sections/usdt-exchange/buyer-workspace-section.tsx");
    const sellerWorkspace = source("src/components/sections/usdt-exchange/seller-workspace-section.tsx");
    const sellerListings = source("src/components/sections/usdt-exchange/seller-listings-workspace-portal.tsx");

    expect(marketplace).toContain('import("@/components/sections/usdt-exchange/purchase-listing-dialog")');
    expect(marketplace).toContain('import("@/components/sections/usdt-exchange/buyer-workspace-section")');
    expect(marketplace).toContain('import("@/components/sections/usdt-exchange/seller-workspace-section")');
    expect(marketplace).toContain('import("@/components/sections/usdt-exchange/seller-listings-workspace-portal")');
    expect(marketplace).not.toContain('id="buy-usdt-form"');
    expect(marketplace).not.toContain("Seller Dashboard Hero");
    expect(marketplace).not.toContain('CardTitle>{isAr ? "سجل صفقاتي" : "My Trade History"}');
    expect(purchaseDialog).toContain('id="buy-usdt-form"');
    expect(buyerWorkspace).toContain('CardTitle>{isAr ? "سجل صفقاتي" : "My Trade History"}');
    expect(sellerWorkspace).toContain("Seller Dashboard Hero");
    expect(sellerListings).toContain('id="my-listings-section"');
  });
});
