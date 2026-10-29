// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { publishDemand, offerDemand } from "@/lib/usdt-demand-store";
import { scheduleMobilePushDelivery } from "@/lib/mobile-push";
import { scheduleBrowserPushDelivery } from "@/lib/browser-push";
import { publishRealtimeEvent } from "@/lib/realtime";
import { demandTestDb, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/mobile-push", () => ({ scheduleMobilePushDelivery: vi.fn() }));
vi.mock("@/lib/browser-push", () => ({ scheduleBrowserPushDelivery: vi.fn() }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock("@/lib/market-service", async () => {
  const fixtures = await import("@/test-utils/usdt-demand-fixtures");
  return { DEFAULT_USD_ILS_RATE: 3.05, getMarketSnapshot: async () => fixtures.demandTestMarket(),
    getUsdtIlsReferenceRate: async () => 3.2 };
});

beforeEach(() => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  globalThis.__alphaExchangeMemorySnapshot = demandTestDb();
  globalThis.__alphaExchangeRepositoryPromise = undefined;
  invalidateAlphaExchangeStoreCache();
  vi.clearAllMocks();
  vi.mocked(scheduleMobilePushDelivery).mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  invalidateAlphaExchangeStoreCache();
});

describe("Buy Request push publication after persistence", () => {
  it("alerts eligible sellers only after the request and notifications exist in storage, without replay alerts", async () => {
    vi.mocked(scheduleMobilePushDelivery).mockImplementation(notification => {
      expect(globalThis.__alphaExchangeMemorySnapshot?.notifications.some(item => item.id === notification.id)).toBe(true);
      expect(globalThis.__alphaExchangeMemorySnapshot?.usdtDemands).toHaveLength(1);
    });
    const body = { terms: demandTestTerms(), operationId: randomUUID() };
    const demand = await publishDemand("buyer", body);
    expect(vi.mocked(scheduleMobilePushDelivery).mock.calls.map(([notice]) => notice.userId).sort())
      .toEqual(["seller", "seller-two"]);
    expect(scheduleBrowserPushDelivery).toHaveBeenCalledTimes(2);
    expect(publishRealtimeEvent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(scheduleMobilePushDelivery).mock.calls[0][0].actionHref).toBe(`/usdt-exchange/requests/${demand.id}`);
    await publishDemand("buyer", body);
    expect(scheduleMobilePushDelivery).toHaveBeenCalledTimes(2);
    expect(publishRealtimeEvent).toHaveBeenCalledTimes(2);
  });

  it("alerts only the buyer when a seller responds, preserving the exact offer destination", async () => {
    const demand = await publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() });
    vi.clearAllMocks();
    const body = { listingId: "listing-seller", revision: demand.revision, price: "3.10", operationId: randomUUID() };
    const offer = await offerDemand("seller", demand.id, body);
    expect(scheduleMobilePushDelivery).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      userId: "buyer", title: "New response to your USDT request",
      actionHref: `/usdt-exchange/requests/${demand.id}?offer=${offer.id}`,
    }));
    expect(scheduleBrowserPushDelivery).toHaveBeenCalledTimes(1);
    expect(publishRealtimeEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "notification.created" }));
    await offerDemand("seller", demand.id, body);
    expect(scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
  });

  it("does not publish archived email-only notices or notifications for unrelated users", async () => {
    const snapshot = globalThis.__alphaExchangeMemorySnapshot!;
    snapshot.users.find(user => user.id === "seller")!.notificationPreferences = { inApp: false, email: true, sms: false };
    await publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() });
    expect(scheduleMobilePushDelivery).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: "seller-two" }));
    expect(publishRealtimeEvent).toHaveBeenCalledTimes(1);
    expect(globalThis.__alphaExchangeMemorySnapshot?.notifications.find(notice => notice.userId === "seller"))
      .toMatchObject({ state: "archived", demandEmail: { state: "pending" } });
  });

  it("sends nothing when a snapshot write fails", async () => {
    const repository = await getAlphaExchangeRepository();
    vi.spyOn(repository, "saveSnapshot").mockRejectedValueOnce(new Error("injected storage failure"));
    await expect(publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() }))
      .rejects.toThrow("injected storage failure");
    expect(scheduleMobilePushDelivery).not.toHaveBeenCalled();
    expect(scheduleBrowserPushDelivery).not.toHaveBeenCalled();
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it("discards speculative alerts if a canonical rebase finds the operation already committed", async () => {
    const repository = await getAlphaExchangeRepository();
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (db, options) => {
      // Another writer committed the same operation before this attempt won
      // the lock. The repository rebases against that existing result.
      const canonical = structuredClone(db);
      await options?.rebaseOnLatest?.(canonical);
      globalThis.__alphaExchangeMemorySnapshot = canonical;
    });
    await publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() });
    expect(globalThis.__alphaExchangeMemorySnapshot?.notifications).toHaveLength(2);
    expect(scheduleMobilePushDelivery).not.toHaveBeenCalled();
    expect(publishRealtimeEvent).not.toHaveBeenCalled();
  });

  it.each([true, false])("publishes only after a successful transaction commit and release (succeeds=%s)", async succeeds => {
    const repository = await getAlphaExchangeRepository();
    const closed = vi.fn(async () => undefined);
    vi.spyOn(repository, "beginTradeLifecycleTransaction").mockResolvedValueOnce({
      snapshot: demandTestDb(),
      commit: async db => {
        expect(scheduleMobilePushDelivery).not.toHaveBeenCalled();
        if (!succeeds) throw new Error("injected commit failure");
        globalThis.__alphaExchangeMemorySnapshot = structuredClone(db);
      },
      close: closed,
    });
    vi.mocked(scheduleMobilePushDelivery).mockImplementation(() => expect(closed).toHaveBeenCalledTimes(1));
    const request = publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() });
    if (succeeds) {
      await request;
      expect(scheduleMobilePushDelivery).toHaveBeenCalledTimes(2);
    } else {
      await expect(request).rejects.toThrow("injected commit failure");
      expect(scheduleMobilePushDelivery).not.toHaveBeenCalled();
    }
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
