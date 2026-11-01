import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerActiveTradeSummary } from "@/lib/owner-active-trades";
const mocks = vi.hoisted(() => ({ path: "/profile", user: { id: "owner", role: "owner" } as { id: string; role: string } | null, fetch: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => mocks.path,
  Link: ({ children, href, locale, prefetch, ...props }: { children: React.ReactNode; href: string; locale: string; prefetch: boolean }) => <a href={`/${locale}${href}`} data-prefetch={prefetch} {...props}>{children}</a>,
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useCanonicalSession: () => ({ user: mocks.user, isRestoring: false }) }));
import { OwnerActiveTradeNotices } from "./owner-active-trade-notices";

const trades: OwnerActiveTradeSummary[] = [1, 2].map(index => ({
  id: `request-${index}`, tradeId: `trade-${index}`, displayNumber: 100 + index,
  status: "payment_sent", usdtAmount: "1000", fiatAmount: "3270", currency: "ILS",
  paymentMethod: "Bank Transfer", updatedAt: "2026-10-05T11:00:00Z",
  buyerName: `Buyer ${index}`, sellerName: `Seller ${index}`,
}));
const response = (list: OwnerActiveTradeSummary[], status = 200, actorId = "owner") => ({ ok: status === 200, status, json: async () => ({ actorId, trades: list }) });
beforeEach(() => {
  vi.useFakeTimers();
  mocks.path = "/profile";
  mocks.user = { id: "owner", role: "owner" };
  mocks.fetch.mockReset().mockResolvedValue(response(trades));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = async (locale: "en" | "ar" = "en") => {
  let result: ReturnType<typeof render>;
  await act(async () => { result = render(<OwnerActiveTradeNotices actorId="owner" initialTrades={trades} locale={locale} />); });
  return result!;
};
const expand = (locale: "en" | "ar" = "en") => fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "الصفقات النشطة (2)" : "Active trades (2)" }));

describe("owner active trade disclosure", () => {
  it("starts as a compact count without exposing the large list, and toggles on demand", async () => {
    await mount();
    const trigger = screen.getByRole("button", { name: "Active trades (2)" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Active trades (2)" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "Active trades (2)" }).id).toBe(trigger.getAttribute("aria-controls"));
    fireEvent.click(trigger);
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("shows two separate green cards with names, IDs, details and exact destinations", async () => {
    await mount();
    expand();
    for (const index of [1, 2]) {
      expect(screen.getByText(`Buyer ${index}`)).toBeTruthy();
      expect(screen.getByText(`Seller ${index}`)).toBeTruthy();
      expect(screen.getByRole("link", { name: `Resume Trade #TR-00010${index}` }).getAttribute("href")).toBe(`/en/trade-room/request-${index}`);
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("keeps the other trade accessible from an Arabic trade room", async () => {
    mocks.path = "/ar/trade-room/request-1";
    await mount("ar");
    expand("ar");
    expect(screen.getByText("مفتوحة الآن")).toBeTruthy();
    expect(screen.getByRole("link", { name: "استئناف الصفقة #TR-000102" }).getAttribute("href")).toBe("/ar/trade-room/request-2");
    expect(screen.getByTestId("owner-active-trades").getAttribute("dir")).toBe("rtl");
  });
  it("adds and removes trades on refresh, including transitioning to no active trades", async () => {
    await mount();
    expand();
    mocks.fetch.mockResolvedValue(response([trades[1]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByText("Buyer 1")).toBeNull();
    expect(screen.getByRole("button", { name: "Active trades (1)" })).toBeTruthy();
    mocks.fetch.mockResolvedValue(response([]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByTestId("owner-active-trades")).toBeNull();
    mocks.fetch.mockResolvedValue(response(trades));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("button", { name: "Active trades (2)" }).getAttribute("aria-expanded")).toBe("false");
    expand();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it.each(["buyer", "approved_seller", "admin"])("never renders or fetches the owner list for %s", async role => {
    mocks.user = { id: "owner", role };
    await mount();
    expect(screen.queryByTestId("owner-active-trades")).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("clears private names on logout and ignores an in-flight response", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValue(new Promise(value => { resolve = value; }));
    await mount();
    await act(async () => { window.dispatchEvent(new Event("alpha-auth-signed-out")); resolve(response(trades)); });
    expect(screen.queryByText("Buyer 1")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])("hides the private list after authorization is lost (%s)", async status => {
    mocks.fetch.mockResolvedValue(response([], status));
    await mount();
    expect(screen.queryByTestId("owner-active-trades")).toBeNull();
  });
  it("keeps the last snapshot during a transient failure, marks it stale and recovers", async () => {
    mocks.fetch.mockResolvedValue(response([], 503));
    await mount();
    expand();
    expect(screen.getByText("Buyer 1")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Retrying");
    mocks.fetch.mockResolvedValue(response([trades[1]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
  it("dismisses with Escape, outside clicks and keyboard focus leaving the panel", async () => {
    await mount();
    const trigger = screen.getByRole("button", { name: "Active trades (2)" });
    expand();
    fireEvent.keyDown(screen.getAllByRole("link")[0], { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expand();
    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expand();
    fireEvent.blur(screen.getAllByRole("link")[1], { relatedTarget: document.body });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
  it("closes immediately when opening a trade and stays closed on route changes", async () => {
    const view = await mount();
    expand();
    fireEvent.click(screen.getAllByRole("link")[0]);
    expect(screen.queryByRole("link")).toBeNull();
    expand();
    mocks.path = "/trade-room/request-1";
    view.rerender(<OwnerActiveTradeNotices actorId="owner" initialTrades={trades} locale="en" />);
    expect(screen.queryByRole("link")).toBeNull();
    mocks.path = "/profile";
    view.rerender(<OwnerActiveTradeNotices actorId="owner" initialTrades={trades} locale="en" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
