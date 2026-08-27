import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileBottomNavigation } from "@/components/layout/mobile-bottom-navigation";

const navigationState = vi.hoisted(() => ({ pathname: "/dashboard", authenticated: true }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => navigationState.pathname,
  Link: ({ children, href, locale, ...props }: { children: ReactNode; href: string; locale?: string }) => (
    <a href={href} data-locale={locale} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/auth/canonical-session-provider", () => ({
  useCanonicalSession: () => ({ user: navigationState.authenticated ? { id: "user-1" } : null }),
}));

describe("MobileBottomNavigation", () => {
  beforeEach(() => {
    navigationState.pathname = "/dashboard";
    navigationState.authenticated = true;
  });

  it("renders five clear English destinations with phone-sized targets", () => {
    render(<MobileBottomNavigation locale="en" />);

    const nav = screen.getByRole("navigation", { name: "Mobile primary navigation" });
    const links = screen.getAllByRole("link");
    expect(nav.getAttribute("dir")).toBe("ltr");
    expect(links.map((link) => link.textContent?.trim())).toEqual(["Home", "Market", "Trades", "Notifications", "Account"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/dashboard", "/usdt-exchange", "/trade-room", "/notifications", "/profile"]);
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
      "الإشعارات",
      "حسابي",
    ]);
    expect(screen.getByRole("link", { name: "السوق" }).getAttribute("aria-current")).toBe("page");
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
