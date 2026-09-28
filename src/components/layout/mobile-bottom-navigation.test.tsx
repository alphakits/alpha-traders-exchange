import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBottomNavigation } from "@/components/layout/mobile-bottom-navigation";

const navigationState = vi.hoisted(() => ({
  pathname: "/",
  search: "",
  authenticated: true,
  role: "buyer",
  sellerStatus: "buyer",
  sellerApprovalVerified: false,
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navigationState.search),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => navigationState.pathname,
  Link: ({ children, href, locale, ...props }: { children: ReactNode; href: string; locale?: string }) => (
    <a href={href} data-locale={locale} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/auth/canonical-session-provider", () => ({
  useCanonicalSession: () => ({
    user: navigationState.authenticated
      ? {
          id: "user-1",
          role: navigationState.role,
          roles: [navigationState.role],
          sellerStatus: navigationState.sellerStatus,
          sellerApprovalVerified: navigationState.sellerApprovalVerified,
        }
      : null,
  }),
}));

describe("MobileBottomNavigation", () => {
  beforeEach(() => {
    navigationState.pathname = "/";
    navigationState.search = "";
    navigationState.authenticated = true;
    navigationState.role = "buyer";
    navigationState.sellerStatus = "buyer";
    navigationState.sellerApprovalVerified = false;
  });

  it("renders five clear English destinations with phone-sized targets", () => {
    render(<MobileBottomNavigation locale="en" />);

    const nav = screen.getByRole("navigation", { name: "Mobile primary navigation" });
    const links = screen.getAllByRole("link");
    expect(nav.getAttribute("dir")).toBe("ltr");
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Home", "Market", "Trades", "News", "Account"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/usdt-exchange",
      "/trades",
      "/news",
      "/profile",
    ]);
    expect(links.every((link) => link.className.includes("min-h-14"))).toBe(true);
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
  });

  it("renders the complete Arabic navigation RTL and marks locale-prefixed routes active", () => {
    navigationState.pathname = "/ar/usdt-exchange";
    render(<MobileBottomNavigation locale="ar" />);

    const nav = screen.getByRole("navigation", { name: "التنقل الرئيسي للهاتف" });
    expect(nav.getAttribute("dir")).toBe("rtl");
    expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "الرئيسية",
      "السوق",
      "الصفقات",
      "الأخبار",
      "حسابي",
    ]);
    expect(screen.getByRole("link", { name: "السوق" }).getAttribute("aria-current")).toBe("page");
  });

  it("sends owners directly to purchase requests and keeps Trades selected", () => {
    navigationState.role = "owner";
    navigationState.pathname = "/en/admin/alpha-exchange";
    navigationState.search = "section=purchase-requests";
    render(<MobileBottomNavigation locale="en" />);

    const trades = screen.getByRole("link", { name: "Trades" });
    expect(trades.getAttribute("href")).toBe("/admin/alpha-exchange?section=purchase-requests");
    expect(trades.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("keeps Home on the public homepage for every signed-in role and selects News only on News", () => {
    navigationState.role = "owner";
    navigationState.pathname = "/ar";
    const { rerender } = render(<MobileBottomNavigation locale="ar" />);
    expect(screen.getByRole("link", { name: "الرئيسية" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "الرئيسية" }).getAttribute("aria-current")).toBe("page");
    navigationState.pathname = "/ar/news";
    rerender(<MobileBottomNavigation locale="ar" />);
    expect(screen.getByRole("link", { name: "الأخبار" }).getAttribute("aria-current")).toBe("page");
    navigationState.pathname = "/ar/notifications";
    rerender(<MobileBottomNavigation locale="ar" />);
    expect(screen.getByRole("link", { name: "الأخبار" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "الرئيسية" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens the buyer requests and history workspace and keeps only Trades selected", () => {
    navigationState.pathname = "/en/trades";
    navigationState.search = "";
    render(<MobileBottomNavigation locale="en" />);

    const trades = screen.getByRole("link", { name: "Trades" });
    expect(trades.getAttribute("href")).toBe("/trades");
    expect(trades.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Market" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens approved and suspended sellers on their trade requests and completed history", () => {
    navigationState.role = "approved_seller";
    navigationState.sellerStatus = "approved_seller";
    navigationState.sellerApprovalVerified = true;
    const { rerender } = render(<MobileBottomNavigation locale="en" />);
    expect(screen.getByRole("link", { name: "Trades" }).getAttribute("href")).toBe("/trades");

    navigationState.role = "buyer";
    navigationState.sellerStatus = "suspended";
    rerender(<MobileBottomNavigation locale="en" />);
    expect(screen.getByRole("link", { name: "Trades" }).getAttribute("href")).toBe("/trades");
  });

  it("stays hidden for signed-out visitors and focused active trade rooms", () => {
    navigationState.authenticated = false;
    const { rerender } = render(<MobileBottomNavigation locale="en" />);
    expect(screen.queryByRole("navigation")).toBeNull();

    navigationState.authenticated = true;
    navigationState.pathname = "/trade-room/trade-123";
    rerender(<MobileBottomNavigation locale="en" />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
