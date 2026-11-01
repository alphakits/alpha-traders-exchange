import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SellerActiveTradeSummary } from "@/lib/seller-active-trades";
const mocks = vi.hoisted(() => ({ path: "/profile", user: { id: "seller", role: "approved_seller", sellerStatus: "approved_seller" } as { id: string; role: string; sellerStatus: string } | null, fetch: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => mocks.path,
  Link: ({ children, href, locale, prefetch, ...props }: { children: React.ReactNode; href: string; locale: string; prefetch: boolean }) => <a href={`/${locale}${href}`} data-prefetch={prefetch} {...props}>{children}</a>,
}));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useCanonicalSession: () => ({ user: mocks.user, isRestoring: false }) }));
import { SellerActiveTradeNotices } from "./seller-active-trade-notices";
import { publishTradeHeaderActivity } from "@/lib/trade-header-activity";

const trades: SellerActiveTradeSummary[] = [1, 2].map(index => ({
  id: `request-${index}`, tradeId: `trade-${index}`, displayNumber: 100 + index,
  status: "payment_sent", usdtAmount: "1000", fiatAmount: "3270", currency: "ILS",
  paymentMethod: "Bank Transfer", updatedAt: "2026-10-05T11:00:00Z",
  buyerName: `AT-10000${index}`, sellerName: "AT-200000", perspective: "seller", actionRequired: true,
}));
const response = (list: SellerActiveTradeSummary[], status = 200, actorId = "seller") => ({ ok: status === 200, status, json: async () => ({ actorId, trades: list }) });
beforeEach(() => {
  vi.useFakeTimers();
  mocks.path = "/profile";
  mocks.user = { id: "seller", role: "approved_seller", sellerStatus: "approved_seller" };
  mocks.fetch.mockReset().mockResolvedValue(response(trades));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = async (locale: "en" | "ar" = "en") => {
  let result: ReturnType<typeof render>;
  await act(async () => { result = render(<SellerActiveTradeNotices actorId="seller" initialTrades={trades} locale={locale} />); });
  return result!;
};
const expand = (locale: "en" | "ar" = "en") => fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "الصفقات النشطة (2)" : "Active trades (2)" }));

describe("seller active trade disclosure", () => {
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
      expect(screen.getByText(`AT-10000${index}`)).toBeTruthy();
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
    expect(screen.getByTestId("seller-active-trades").getAttribute("dir")).toBe("rtl");
  });
  it("adds and removes trades on refresh, including transitioning to no active trades", async () => {
    await mount();
    expand();
    mocks.fetch.mockResolvedValue(response([trades[1]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByText("AT-100001")).toBeNull();
    expect(screen.getByRole("button", { name: "Active trades (1)" })).toBeTruthy();
    mocks.fetch.mockResolvedValue(response([]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByTestId("seller-active-trades")).toBeNull();
    mocks.fetch.mockResolvedValue(response(trades));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("button", { name: "Active trades (2)" }).getAttribute("aria-expanded")).toBe("false");
    expand();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it.each(["buyer", "owner", "admin"])("never renders or fetches the seller list for %s", async role => {
    mocks.user = { id: "seller", role, sellerStatus: "buyer" };
    await mount();
    expect(screen.queryByTestId("seller-active-trades")).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("clears private names on logout and ignores an in-flight response", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValue(new Promise(value => { resolve = value; }));
    await mount();
    await act(async () => { window.dispatchEvent(new Event("alpha-auth-signed-out")); resolve(response(trades)); });
    expect(screen.queryByText("AT-100001")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])("hides the private list after authorization is lost (%s)", async status => {
    mocks.fetch.mockResolvedValue(response([], status));
    await mount();
    expect(screen.queryByTestId("seller-active-trades")).toBeNull();
  });
  it("keeps the last snapshot during a transient failure, marks it stale and recovers", async () => {
    mocks.fetch.mockResolvedValue(response([], 503));
    await mount();
    expand();
    expect(screen.getByText("AT-100001")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Retrying");
    mocks.fetch.mockResolvedValue(response([trades[1]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
  it("refreshes the full list after a room action, preserving the other active trades", async () => {
    await mount();
    expand();
    const third = { ...trades[1], id: "request-3", displayNumber: 103, buyerName: "AT-100003" };
    mocks.fetch.mockResolvedValue(response([trades[1], third]));
    await act(async () => {
      publishTradeHeaderActivity("seller", { id: "request-1", buyerId: "buyer-1", sellerId: "seller", status: "completed", paymentMethod: "Bank Transfer", updatedAt: "2026-10-07T00:00:00Z", buyerReviewed: true });
    });
    expect(screen.queryByText("AT-100001")).toBeNull();
    expect(screen.getByRole("link", { name: "Resume Trade #TR-000102" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resume Trade #TR-000103" })).toBeTruthy();
    expect(mocks.fetch.mock.calls.every(([url]) => url === "/api/alpha-exchange/seller/active-trades")).toBe(true);
  });
  it("does not restore a completed trade from an older in-flight snapshot", async () => {
    let resolve!: (value: ReturnType<typeof response>) => void;
    mocks.fetch.mockReturnValueOnce(new Promise(value => { resolve = value; }));
    mocks.fetch.mockResolvedValue(response([trades[1]]));
    await mount();
    await act(async () => {
      publishTradeHeaderActivity("seller", { id: "request-1", buyerId: "buyer-1", sellerId: "seller", status: "completed", paymentMethod: "Bank Transfer", updatedAt: "2026-10-07T00:01:00Z", buyerReviewed: true });
      resolve(response(trades));
    });
    fireEvent.click(screen.getByRole("button", { name: "Active trades (1)" }));
    expect(screen.queryByText("AT-100001")).toBeNull();
    expect(screen.getByRole("link", { name: "Resume Trade #TR-000102" })).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("shows three trades and their separate action cues", async () => {
    mocks.fetch.mockResolvedValue(response([...trades, { ...trades[1], id: "request-3", displayNumber: 103, buyerName: "AT-100003", actionRequired: false }]));
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Active trades (3)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByText("Your action needed")).toHaveLength(2);
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/en/trade-room/request-1", "/en/trade-room/request-2", "/en/trade-room/request-3"]);
  });
  it("discards a response for a different signed-in actor", async () => {
    mocks.fetch.mockResolvedValue(response(trades, 200, "other-seller"));
    await mount();
    expect(screen.queryByTestId("seller-active-trades")).toBeNull();
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
    view.rerender(<SellerActiveTradeNotices actorId="seller" initialTrades={trades} locale="en" />);
    expect(screen.queryByRole("link")).toBeNull();
    mocks.path = "/profile";
    view.rerender(<SellerActiveTradeNotices actorId="seller" initialTrades={trades} locale="en" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
