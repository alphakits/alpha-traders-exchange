import type { AnchorHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientSessionUser } from "@/lib/client-session-user";

const session = vi.hoisted(() => ({ user: null as ClientSessionUser | null, pathname: "/" }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useCanonicalSession: () => session }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, locale, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { locale: string }) => <a href={`/${locale}${href}`} {...props} />,
  usePathname: () => session.pathname,
}));
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/auth/logout-button", () => ({ LogoutButton: () => <button>Sign out</button> }));
vi.mock("@/components/layout/create-listing-quick-link", () => ({ CreateListingQuickLink: () => <button>Create listing</button> }));
vi.mock("@/components/layout/locale-switcher", () => ({ LocaleSwitcher: () => <button>Language</button> }));

import { HeaderAuthArea } from "@/components/layout/header-auth-area";

const labels = { signIn: "Sign in", profile: "Profile", signOut: "Sign out", notifications: "Notifications", createListing: "Create listing", adminDashboard: "Admin", openMenu: "Open menu" };
const navItems = [{ href: "/", label: "Home" }, { href: "/usdt-exchange", label: "Alpha Exchange", cta: true }, { href: "/contact", label: "Contact" }];
function user(overrides: Partial<ClientSessionUser> = {}): ClientSessionUser {
  return {
    id: "buyer", fullName: "Buyer", role: "buyer", roles: ["buyer"], sellerStatus: "buyer",
    emailVerified: true, isPhotoVerified: true, adultConfirmed: true,
    ...overrides,
  } as ClientSessionUser;
}
function header(enabled = true, locale: "en" | "ar" = "en") {
  return <HeaderAuthArea locale={locale} navItems={navItems} labels={labels} buyRequestsEnabled={enabled} initialSessionUser={session.user} />;
}
function menu() {
  const trigger = screen.getByLabelText("Open menu");
  trigger.closest("details")!.open = true;
  return within(screen.getByRole("navigation", { name: "Mobile menu" }));
}

afterEach(() => { cleanup(); session.user = null; session.pathname = "/"; });

describe("Buy Requests mobile navigation", () => {
  it("opens the buyer's current requests directly below Alpha Exchange and closes the menu", () => {
    session.user = user();
    render(header());
    const link = menu().getByRole("link", { name: "Buy Requests" });
    expect(link.getAttribute("href")).toBe("/en/usdt-exchange/requests?scope=mine");
    expect(link.previousElementSibling?.textContent).toBe("Alpha Exchange");
    expect(link.nextElementSibling?.textContent).toBe("Contact");
    link.addEventListener("click", event => event.preventDefault());
    fireEvent.click(link);
    expect(link.closest("details")!.open).toBe(false);
  });

  it.each(["approved_seller", "admin", "owner"] as const)("opens current buyer requests for %s", role => {
    session.user = user({ role, roles: [role], sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer" });
    render(header());
    expect(menu().getByRole("link", { name: "Buy Requests" }).getAttribute("href")).toBe("/en/usdt-exchange/requests?scope=available");
  });

  it("uses the current canonical account when switching between buyer and seller", () => {
    session.user = user();
    const view = render(header());
    expect(menu().getByRole("link", { name: "Buy Requests" }).getAttribute("href")).toContain("scope=mine");
    session.user = user({ id: "seller", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" });
    view.rerender(header());
    expect(menu().getByRole("link", { name: "Buy Requests" }).getAttribute("href")).toContain("scope=available");
    session.user = null;
    view.rerender(header());
    expect(menu().queryByRole("link", { name: "Buy Requests" })).toBeNull();
  });

  it.each([
    ["guest", null],
    ["student", { role: "student", roles: ["student"] }],
    ["suspended seller", { role: "approved_seller", roles: ["approved_seller"], sellerStatus: "suspended" }],
    ["unverified email", { emailVerified: false }],
    ["unverified identity", { isPhotoVerified: false }],
    ["unconfirmed adult", { adultConfirmed: false }],
    ["old session without eligibility", { adultConfirmed: undefined }],
  ] satisfies [string, Partial<ClientSessionUser> | null][])("hides an unavailable route for %s", (_label, overrides) => {
    session.user = overrides === null ? null : user(overrides);
    render(header());
    expect(menu().queryByRole("link", { name: "Buy Requests" })).toBeNull();
  });

  it("keeps the buyer destination available when that buyer also has a suspended seller role", () => {
    session.user = user({ roles: ["buyer", "approved_seller"], sellerStatus: "suspended" });
    render(header());
    expect(menu().getByRole("link", { name: "Buy Requests" }).getAttribute("href")).toContain("scope=mine");
  });

  it("does not expose a disabled feature", () => {
    session.user = user();
    render(header(false));
    expect(menu().queryByRole("link", { name: "Buy Requests" })).toBeNull();
  });

  it("keeps Arabic navigation in Arabic and marks the request detail route current", () => {
    session.user = user(); session.pathname = "/usdt-exchange/requests/demand-one";
    render(header(true, "ar"));
    screen.getByLabelText("Open menu").closest("details")!.open = true;
    const link = within(screen.getByRole("navigation", { name: "قائمة الهاتف" })).getByRole("link", { name: "طلبات الشراء" });
    expect(link.getAttribute("href")).toBe("/ar/usdt-exchange/requests?scope=mine");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
