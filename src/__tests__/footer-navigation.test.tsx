import { renderToStaticMarkup } from "react-dom/server";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ locale, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { locale: string }) => (
    <a {...props} href={`/${locale}${href}`} data-client-navigation="true" />
  ),
}));
vi.mock("@/components/layout/footer-market-overview", () => ({ FooterMarketOverview: () => null }));
vi.mock("@/components/layout/footer-newsletter-signup", () => ({ FooterNewsletterSignup: () => null }));

import { SiteFooter } from "@/components/layout/site-footer";

describe("footer section navigation", () => {
  it.each(["en", "ar"] as const)("preserves protected sections through native redirects in %s", async (locale) => {
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(await SiteFooter({ locale }));
    const links = [...container.querySelectorAll("a")];
    const protectedSections = links.filter(link => /^\/(en|ar)\/(academy|lessons|usdt-exchange)[?#]/.test(link.getAttribute("href") ?? "") && link.hash);
    // Each of the nine section links appears in the mobile and desktop footer.
    expect(protectedSections).toHaveLength(18);
    for (const link of protectedSections) {
      expect(link.pathname.startsWith(`/${locale}/`)).toBe(true);
      expect(link.dataset.clientNavigation).toBeUndefined();
    }
    expect(protectedSections.some(link => link.getAttribute("href") === `/${locale}/usdt-exchange?mode=buy#marketplace-sellers`)).toBe(true);
    expect(protectedSections.some(link => link.getAttribute("href") === `/${locale}/lessons#risk-management`)).toBe(true);
    expect(links.find(link => link.getAttribute("href") === `/${locale}/help-center#faq`)?.dataset.clientNavigation).toBe("true");
  });
});
