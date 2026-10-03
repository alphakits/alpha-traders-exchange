import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import english from "../../messages/en.json";
import arabic from "../../messages/ar.json";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

const session = vi.hoisted(() => ({ user: null as AlphaExchangeUser | null }));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: "en" | "ar"; namespace?: string }) => {
    const messages = locale === "ar" ? arabic.nav : english.nav;
    return (key: string) => namespace === "nav" ? messages[key as keyof typeof messages] : "Alpha Traders";
  },
}));
vi.mock("next/image", () => ({
  default: ({ priority, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority;
    // The test renders a native image instead of invoking Next's optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt ?? ""} />;
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ locale, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { locale?: string }) => {
    void locale;
    return <a {...props} />;
  },
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/alpha-exchange-store", () => ({ getTradeHeaderStateForUser: vi.fn().mockResolvedValue({ activeTrade: null, tradeReminder: null }) }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useCanonicalSession: () => session }));
vi.mock("@/components/layout/trade-header-notice", () => ({ TradeHeaderNotice: () => null }));
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => <button type="button" onClick={vi.fn()}>Notifications</button> }));
vi.mock("@/components/layout/locale-switcher", () => ({ LocaleSwitcher: () => <button type="button" onClick={vi.fn()}>Language</button> }));

import { SiteHeader } from "@/components/layout/site-header";

afterEach(() => { cleanup(); session.user = null; });

const ROLES = ["guest", "buyer", "approved_seller", "admin", "owner"] as const;

describe("Responsive site header", () => {
  for (const locale of ["en", "ar"] as const) {
    it.each(ROLES)(`keeps ${locale} %s navigation separate from non-shrinking account controls`, async (role) => {
      session.user = role === "guest" ? null : {
        id: "header-fixture",
        fullName: "A deliberately long private account name for the responsive header",
        role,
        roles: role === "owner" ? ["owner", "admin", "approved_seller"] : [role],
        sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
      } as AlphaExchangeUser;
      const { container } = render(await SiteHeader({ locale, sessionUser: session.user }));
      const header = container.querySelector("header")!;
      const row = header.querySelector(":scope > .section-container")!;
      const desktopNav = header.querySelector("nav[aria-label]")!;
      const accountControls = header.querySelector("[data-header-account-controls]")!;

      // A fixed-height, non-wrapping row or flex-shrinking account group hid
      // Profile/Sign out even though root overflow-x:clip hid the scrollbar.
      expect(row.classList.contains("flex-wrap")).toBe(true);
      expect(row.classList.contains("h-16")).toBe(false);
      expect(row.contains(desktopNav)).toBe(false);
      expect(desktopNav.parentElement).toBe(header);
      expect(desktopNav.classList.contains("flex-wrap")).toBe(true);
      expect(accountControls.parentElement).toBe(row);
      expect(accountControls.classList.contains("shrink-0")).toBe(true);
      expect(accountControls.classList.contains("ms-auto")).toBe(true);
      const menuPanel = accountControls.querySelector("details > div")!;
      expect(menuPanel.classList.contains("whitespace-normal")).toBe(true);

      const navMessages = locale === "ar" ? arabic.nav : english.nav;
      expect(screen.getAllByRole("link", { name: role === "guest" ? navMessages.signIn : navMessages.profile })).not.toHaveLength(0);
      const signOutButtons = [...header.querySelectorAll("button")].filter((button) => button.textContent === navMessages.signOut);
      expect(signOutButtons).toHaveLength(role === "guest" ? 0 : 2);
      const sellerButtons = [...header.querySelectorAll("button")].filter((button) => button.textContent?.includes(locale === "ar" ? "إنشاء عرض" : "Create Listing"));
      expect(sellerButtons).toHaveLength(["approved_seller", "admin", "owner"].includes(role) ? 2 : 0);
    });
  }
});
