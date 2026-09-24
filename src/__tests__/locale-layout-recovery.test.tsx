import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ getCurrentSessionUser: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-alpha-page-path": "/en" }) }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.getCurrentSessionUser }));
vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "inter" }), IBM_Plex_Sans_Arabic: () => ({ variable: "arabic" }) }));
vi.mock("next-intl/server", () => ({ getMessages: async () => ({}) }));
vi.mock("next-intl", () => ({
  hasLocale: (locales: string[], locale: string) => locales.includes(locale),
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/layout/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/components/layout/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/components/layout/mobile-bottom-navigation", () => ({ MobileBottomNavigation: () => null }));
vi.mock("@/components/layout/html-attributes-setter", () => ({ HtmlAttributesSetter: () => null }));
vi.mock("@/components/pwa/offline-banner", () => ({ OfflineBanner: () => null }));
vi.mock("@/components/pwa/pwa-install-prompt", () => ({ PwaInstallPrompt: () => null }));
vi.mock("@/components/mobile/native-app-bridge", () => ({ NativeAppBridge: () => null }));
vi.mock("@/components/auth/buyer-contact-prompt", () => ({ BuyerContactPrompt: () => null }));

import LocaleLayout from "@/app/[locale]/layout";

describe("locale layout during a session-storage outage", () => {
  beforeEach(() => {
    mocks.getCurrentSessionUser.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["ar", "en"])("renders recovery in %s without exposing protected children or throwing globally", async (locale) => {
    mocks.getCurrentSessionUser.mockRejectedValue(new Error("Durable session storage is unavailable."));
    const page = await LocaleLayout({ params: Promise.resolve({ locale }), children: <p>Private trade contents</p> });
    const html = renderToStaticMarkup(page);
    expect(html).not.toContain("Private trade contents");
    expect(html).toContain(locale === "ar" ? "تعذّر تحميل حسابك مؤقتًا" : "Your account could not be loaded");
  });

  it("continues rendering public children for a verified anonymous session", async () => {
    mocks.getCurrentSessionUser.mockResolvedValue(null);
    const page = await LocaleLayout({ params: Promise.resolve({ locale: "en" }), children: <p>Public home</p> });
    expect(renderToStaticMarkup(page)).toContain("Public home");
  });

  it("preserves framework redirects instead of misclassifying them as an outage", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/en/login;307;" });
    mocks.getCurrentSessionUser.mockRejectedValue(redirect);
    await expect(LocaleLayout({ params: Promise.resolve({ locale: "en" }), children: null })).rejects.toBe(redirect);
  });
});
