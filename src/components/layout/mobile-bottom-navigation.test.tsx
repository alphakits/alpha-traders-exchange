import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBottomNavigation } from "@/components/layout/mobile-bottom-navigation";

const navigationState = vi.hoisted(() => ({
  pathname: "/dashboard",
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
    navigationState.pathname = "/dashboard";
    navigationState.search = "";
    navigationState.authenticated = true;
    navigationState.role = "buyer";
    navigationState.sellerStatus = "buyer";
    navigationState.sellerApprovalVerified = false;
  });

  it.each(["buyer", "approved_seller", "owner"])("renders the four requested destinations for %s", (role) => {
    navigationState.role = role;
    navigationState.pathname = "/market";
    render(<MobileBottomNavigation locale="en" />);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Market", "Trade", "News", "Settings"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/market", "/trade", "/news", "/settings"]);
    expect(links.every((link) => link.className.includes("min-h-14"))).toBe(true);
    expect(screen.getByRole("link", { name: "Market" }).getAttribute("aria-current")).toBe("page");
  });

  it.each(["/", "/academy", "/ar/community"])("preserves the public site's existing mobile navigation on %s", (pathname) => {
    navigationState.pathname = pathname;
    render(<MobileBottomNavigation locale="en" />);
    expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(["Home", "Market", "Trades", "Notifications", "Account"]);
    expect(screen.queryByRole("link", { name: "News" })).toBeNull();
  });

  it("renders Arabic navigation RTL and recognizes legacy trade URLs", () => {
    navigationState.pathname = "/ar/usdt-exchange";
    render(<MobileBottomNavigation locale="ar" />);
    expect(screen.getByRole("navigation").getAttribute("dir")).toBe("rtl");
    expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual(["السوق", "التداول", "الأخبار", "الإعدادات"]);
    expect(screen.getByRole("link", { name: "التداول" }).getAttribute("aria-current")).toBe("page");
  });

  it("keeps the Trade tab selected when viewing history", () => {
    navigationState.pathname = "/en/trade";
    navigationState.search = "section=trade-history";
    render(<MobileBottomNavigation locale="en" />);
    expect(screen.getByRole("link", { name: "Trade" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Market" }).getAttribute("aria-current")).toBeNull();
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
