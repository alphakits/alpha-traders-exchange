import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderAuthArea } from "@/components/layout/header-auth-area";

const mocks = vi.hoisted(() => ({
  user: { id: "buyer-a", fullName: "Buyer A", role: "buyer", roles: ["buyer"], sellerStatus: "buyer", sellerApprovalVerified: false } as {
    id: string; fullName: string; role: string; roles: string[]; sellerStatus: string; sellerApprovalVerified: boolean;
  } | null,
  fetch: vi.fn(), clearLocale: vi.fn(),
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({
  useCanonicalSession: () => ({ user: mocks.user }),
  useOptionalCanonicalSession: () => ({ user: mocks.user }),
}));
vi.mock("@/i18n/locale-preference", () => ({ clearClientLocaleChoice: mocks.clearLocale }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => <span>Notifications</span> }));
vi.mock("@/components/layout/create-listing-quick-link", () => ({ CreateListingQuickLink: () => <span>Create listing</span> }));
vi.mock("@/components/layout/mobile-navigation-menu", () => ({ MobileNavigationMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/layout/locale-switcher", () => ({ LocaleSwitcher: () => <span>Language</span> }));
const originalLocation = window.location;
const replace = vi.fn();
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(finish => { resolve = finish; });
  return { promise, resolve };
}
const labels = { signIn: "Sign in", profile: "Profile", signOut: "Sign out", notifications: "Notifications", createListing: "Create listing", adminDashboard: "Admin", openMenu: "Menu" };
function header() {
  return <HeaderAuthArea locale="en" navItems={[]} labels={labels} initialSessionUser={null} />;
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.fetch.mockReset(); mocks.clearLocale.mockReset(); replace.mockReset();
  mocks.user = { id: "buyer-a", fullName: "Buyer A", role: "buyer", roles: ["buyer"], sellerStatus: "buyer", sellerApprovalVerified: false };
  vi.stubGlobal("fetch", mocks.fetch);
  Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, replace } });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("account-scoped header logout", () => {
  it.each([0, 1])("cancels header logout control %s when the canonical account changes", async index => {
    const view = render(header()); const pending = deferred();
    const events = vi.spyOn(window, "dispatchEvent"); mocks.fetch.mockReturnValue(pending.promise);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Sign out" })[index]); });
    const signal = mocks.fetch.mock.calls[0][1].signal;
    mocks.user = { ...mocks.user!, id: "buyer-b", fullName: "Buyer B" }; view.rerender(header());
    expect(signal.aborted).toBe(true);
    expect(screen.getAllByRole("button", { name: "Sign out" }).every(button => !button.hasAttribute("disabled"))).toBe(true);
    await act(async () => { pending.resolve({ ok: true }); });
    expect(mocks.clearLocale).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    expect(events.mock.calls.filter(([event]) => ["alpha-auth-changed", "alpha-auth-signed-out"].includes(event.type))).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a pending logout during an ordinary refresh of the same account", async () => {
    const view = render(header()); const pending = deferred(); mocks.fetch.mockReturnValue(pending.promise);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Sign out" })[0]); });
    const signal = mocks.fetch.mock.calls[0][1].signal;
    mocks.user = { ...mocks.user!, fullName: "Updated Buyer A" }; view.rerender(header());
    expect(signal.aborted).toBe(false); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Signing out..." }).hasAttribute("disabled")).toBe(true);
    await act(async () => { pending.resolve({ ok: true }); });
    expect(replace).toHaveBeenCalledExactlyOnceWith("/en"); expect(mocks.clearLocale).toHaveBeenCalledTimes(1);
  });

  it("cancels both pending header controls on unmount without stale sign-out events", async () => {
    const view = render(header()); const pending = [deferred(), deferred()]; const events = vi.spyOn(window, "dispatchEvent");
    mocks.fetch.mockReturnValueOnce(pending[0].promise).mockReturnValueOnce(pending[1].promise);
    const buttons = screen.getAllByRole("button", { name: "Sign out" });
    await act(async () => { fireEvent.click(buttons[0]); fireEvent.click(buttons[1]); });
    view.unmount(); expect(mocks.fetch.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
    await act(async () => { pending.forEach(request => request.resolve({ ok: true })); });
    expect(replace).not.toHaveBeenCalled(); expect(mocks.clearLocale).not.toHaveBeenCalled();
    expect(events.mock.calls.filter(([event]) => ["alpha-auth-changed", "alpha-auth-signed-out"].includes(event.type))).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels pending header logout when the canonical session becomes anonymous", async () => {
    const view = render(header()); const pending = deferred(); mocks.fetch.mockReturnValue(pending.promise);
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Sign out" })[0]); });
    const signal = mocks.fetch.mock.calls[0][1].signal; mocks.user = null; view.rerender(header());
    expect(signal.aborted).toBe(true); expect(screen.queryAllByRole("button")).toHaveLength(0);
    await act(async () => { pending.resolve({ ok: true }); });
    expect(replace).not.toHaveBeenCalled(); expect(mocks.clearLocale).not.toHaveBeenCalled();
  });
});
