import { act, cleanup, render, screen } from "@testing-library/react";
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

describe("owner stacked active trades", () => {
  it("shows two separate green cards with names, IDs, details and exact destinations", async () => {
    await mount();
    expect(screen.getByText("Active trades (2)")).toBeTruthy();
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
    expect(screen.getByText("تشاهد هذه الصفقة")).toBeTruthy();
    expect(screen.getByRole("link", { name: "استئناف الصفقة #TR-000102" }).getAttribute("href")).toBe("/ar/trade-room/request-2");
    expect(screen.getByTestId("owner-active-trades").getAttribute("dir")).toBe("rtl");
  });
  it("adds and removes trades on refresh, including transitioning to no active trades", async () => {
    await mount();
    mocks.fetch.mockResolvedValue(response([trades[1]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByText("Buyer 1")).toBeNull();
    expect(screen.getByText("Active trades (1)")).toBeTruthy();
    mocks.fetch.mockResolvedValue(response([]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByTestId("owner-active-trades")).toBeNull();
    mocks.fetch.mockResolvedValue(response(trades));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
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
    expect(screen.getByText("Buyer 1")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Retrying");
    mocks.fetch.mockResolvedValue(response([trades[1]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
