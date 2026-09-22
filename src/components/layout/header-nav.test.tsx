import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { HeaderNav } from "./header-nav";
import { HeaderBrandText, SiteHeaderFrame } from "./site-header-frame";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => navigation.pathname,
  Link: ({ locale, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { locale?: string }) => <a data-locale={locale} {...props} />,
}));
const publicItems = [
  { href: "/", label: "Home" }, { href: "/academy", label: "Academy" },
  { href: "/community", label: "Community" }, { href: "/contact", label: "Contact" },
  { href: "/market", label: "Alpha Exchange", cta: true },
];

describe("public and Exchange navigation", () => {
  it.each(["/", "/academy", "/community", "/contact", "/admin/discord", "/market-notes"])("preserves the website navigation on %s", (pathname) => {
    navigation.pathname = pathname;
    render(<HeaderNav items={publicItems} locale="en" />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Home", "Academy", "Community", "Contact", "Alpha Exchange"]);
    expect(screen.getByRole("link", { name: "Alpha Exchange" }).getAttribute("href")).toBe("/market");
  });

  it.each(["/market", "/trade", "/trade-room/trade-1", "/exchange/seller/alpha", "/settings", "/profile", "/news", "/dashboard/seller"])("uses the four Exchange destinations on %s", (pathname) => {
    navigation.pathname = pathname;
    render(<HeaderNav items={publicItems} locale="en" />);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["Market", "Trade", "News", "Settings"]);
    expect(screen.getByRole("link", { name: "Market" }).getAttribute("href")).toBe("/market");
  });

  it("switches navigation and header alignment during client navigation", () => {
    const Header = () => <SiteHeaderFrame><HeaderBrandText signedIn label="Brand">Alpha Traders</HeaderBrandText><HeaderNav items={publicItems} locale="ar" /></SiteHeaderFrame>;
    navigation.pathname = "/";
    const { rerender } = render(<Header />);
    expect(screen.getByLabelText("Brand").parentElement?.getAttribute("dir")).toBeNull();
    expect(screen.getByLabelText("Brand").className).not.toContain("hidden");
    navigation.pathname = "/market";
    rerender(<Header />);
    expect(screen.getByLabelText("Brand").parentElement?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("link", { name: "السوق" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    navigation.pathname = "/";
    rerender(<Header />);
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByLabelText("Brand").parentElement?.getAttribute("dir")).toBeNull();
  });
});
