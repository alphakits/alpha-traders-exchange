import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterfaceSessionUser } from "@alpha-traders/contracts";

const session = vi.hoisted(() => ({ user: null as InterfaceSessionUser | null }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => session }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ locale, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { locale: string }) => (
    <a {...props} href={`/${locale}${href}`} data-client-navigation="true" />
  ),
}));
vi.mock("@/components/layout/footer-market-overview", () => ({ FooterMarketOverview: () => null }));
vi.mock("@/components/layout/footer-newsletter-signup", () => ({ FooterNewsletterSignup: () => null }));

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteFooterContent } from "@/components/layout/site-footer-content";

afterEach(() => { cleanup(); session.user = null; });

describe("role-appropriate footer", () => {
  for (const locale of ["en", "ar"] as const) {
    it.each(["buyer", "approved_seller"])(`preserves allowed protected sections in ${locale} for %s`, async (role) => {
      session.user = { role, roles: [role], sellerStatus: role };
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(await SiteFooter({ locale }));
      const links = [...container.querySelectorAll("a")];
      const protectedSections = links.filter(link => /^\/(en|ar)\/(academy|lessons|usdt-exchange)[?#]/.test(link.getAttribute("href") ?? "") && link.hash);
      expect(protectedSections).toHaveLength(role === "approved_seller" ? 18 : 16);
      for (const link of protectedSections) {
        expect(link.pathname.startsWith(`/${locale}/`)).toBe(true);
        expect(link.dataset.clientNavigation).toBeUndefined();
      }
      expect(protectedSections.some(link => link.getAttribute("href") === `/${locale}/usdt-exchange?mode=buy#marketplace-sellers`)).toBe(true);
      expect(protectedSections.some(link => link.getAttribute("href") === `/${locale}/lessons#risk-management`)).toBe(true);
      expect(links.find(link => link.getAttribute("href") === `/${locale}/help-center#faq`)?.dataset.clientNavigation).toBe("true");
      expect(container.querySelector(`a[href='/${locale}/login']`)).toBeNull();
      expect(container.querySelector(`a[href='/${locale}/register']`)).toBeNull();
      expect(Boolean(container.querySelector(`a[href='/${locale}/dashboard/seller/compliance-payment']`))).toBe(role === "approved_seller");
    });

    it(`shows only public links and account entry for anonymous visitors in ${locale}`, async () => {
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(await SiteFooter({ locale }));
      expect(container.querySelectorAll(`a[href='/${locale}/login']`)).toHaveLength(2);
      expect(container.querySelectorAll(`a[href='/${locale}/register']`)).toHaveLength(2);
      expect(container.querySelectorAll("a[href*='/dashboard'],a[href*='/profile'],a[href*='/settings'],a[href*='/trade-room'],a[href*='/notifications']")).toHaveLength(0);
      expect(container.querySelector(`a[href='/${locale}/privacy-policy']`)).not.toBeNull();
      expect(container.querySelector(`a[href='/${locale}/account-deletion']`)).not.toBeNull();
    });

    it.each(["guest", "student", "owner", "admin"])(`keeps ${locale} %s account links appropriate`, async (role) => {
      session.user = { role, roles: [role], sellerStatus: "buyer" };
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(await SiteFooter({ locale }));
      expect(container.querySelectorAll(`a[href='/${locale}/login'],a[href='/${locale}/register']`)).toHaveLength(0);
      expect(container.querySelector(`a[href='/${locale}/profile']`)).not.toBeNull();
      expect(container.querySelector(`a[href='/${locale}/dashboard/seller']`)).toBeNull();
      expect(Boolean(container.querySelector(`a[href='/${locale}/admin/alpha-exchange']`))).toBe(role === "owner" || role === "admin");
      expect(container.querySelector(`a[href='/${locale}/dashboard']`)).toBeNull();
    });
  }

  it("updates immediately after login, seller approval, suspension, role revocation and logout", () => {
    const { container, rerender } = render(<SiteFooterContent locale="en" />);
    const has = (href: string) => Boolean(container.querySelector(`a[href='/en${href}']`));
    expect(has("/login")).toBe(true);
    session.user = { role: "buyer", roles: ["buyer"], sellerStatus: "buyer" };
    rerender(<SiteFooterContent locale="en" />);
    expect(has("/login")).toBe(false);
    expect(has("/dashboard")).toBe(true);
    expect(has("/dashboard/seller")).toBe(false);
    session.user = { role: "approved_seller", roles: ["approved_seller", "buyer"], sellerStatus: "approved_seller" };
    rerender(<SiteFooterContent locale="en" />);
    expect(has("/dashboard/seller")).toBe(true);
    expect(has("/usdt-exchange?mode=sell#create-listing")).toBe(true);
    session.user.sellerStatus = "suspended";
    rerender(<SiteFooterContent locale="en" />);
    expect(has("/dashboard/seller/compliance-payment")).toBe(true);
    expect(has("/usdt-exchange?mode=sell#create-listing")).toBe(false);
    session.user = { role: "owner", roles: ["owner"] };
    rerender(<SiteFooterContent locale="en" />);
    expect(has("/admin/alpha-exchange")).toBe(true);
    session.user = { role: "student", roles: ["student"] };
    rerender(<SiteFooterContent locale="en" />);
    expect(has("/admin/alpha-exchange")).toBe(false);
    expect(has("/trades")).toBe(false);
    session.user = null;
    rerender(<SiteFooterContent locale="en" />);
    expect(has("/profile")).toBe(false);
    expect(has("/login")).toBe(true);
  });
});
