// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demandTestDb, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { getNotificationsForUser, invalidateAlphaExchangeStoreCache, markNotificationReadState } from "@/lib/alpha-exchange-store";
import { offerDemand, publishDemand } from "@/lib/usdt-demand-store";
import { getSafeInternalNotificationDestination } from "@/lib/notification-action-destination";
import { demandNotificationDestination } from "@/lib/usdt-demand-notification";
import { localizeNotificationActionLabel } from "@/lib/notification-localization";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/market-service", async () => {
  const fixtures = await import("@/test-utils/usdt-demand-fixtures");
  return { DEFAULT_USD_ILS_RATE: 3.05, getMarketSnapshot: async () => fixtures.demandTestMarket(),
    getUsdtIlsReferenceRate: async () => 3.2 };
});

let seed = demandTestDb();
function install() {
  globalThis.__alphaExchangeMemorySnapshot = structuredClone(seed);
  globalThis.__alphaExchangeRepositoryPromise = undefined;
  invalidateAlphaExchangeStoreCache();
}
beforeEach(() => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  seed = demandTestDb(); install();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateAlphaExchangeStoreCache(); });

describe("Buy Requests persisted in-app notification journey", () => {
  it.each(["en", "ar"] as const)("preserves independent channel preferences and rehydrated request links for %s", async locale => {
    for (const [inApp, email] of [[true, true], [true, false], [false, true], [false, false]]) {
      seed = demandTestDb();
      const seller = seed.users.find(user => user.id === "seller")!;
      seller.notificationPreferences = { inApp, email, sms: false };
      seller.preferredLocale = locale;
      install();
      const request = await publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() });
      invalidateAlphaExchangeStoreCache();
      const stored = await (await getAlphaExchangeRepository()).loadSelectedSnapshot(["notifications", "usdt_demands"]);
      expect(stored.usdtDemands?.[0].id).toBe(request.id);
      const notice = stored.notifications.find(item => item.userId === "seller")!;
      expect(notice.state).toBe(inApp ? "unread" : "archived");
      expect(Boolean(notice.demandEmail)).toBe(email);
      if (email) expect(notice.demandEmail!.state).toBe("pending");
      const feed = await getNotificationsForUser({ userId: "seller", includeActivity: false });
      expect(feed.notifications).toHaveLength(inApp ? 1 : 0);
      expect(feed.unreadCount).toBe(inApp ? 1 : 0);
      if (inApp) expect(getSafeInternalNotificationDestination(feed.notifications[0]))
        .toBe(`/usdt-exchange/requests/${request.id}`);
      if (inApp) {
        expect(feed.notifications[0].actionLabel).toBe("View USDT request");
        expect(localizeNotificationActionLabel(feed.notifications[0].actionLabel, locale, feed.notifications[0]))
          .toBe(locale === "ar" ? "عرض طلب USDT" : "View USDT request");
        await markNotificationReadState({ userId: "seller", notificationId: notice.id, isRead: true });
        invalidateAlphaExchangeStoreCache();
        const reloaded = await getNotificationsForUser({ userId: "seller", includeActivity: false });
        expect(reloaded.notifications[0].state).toBe("read");
        expect(getSafeInternalNotificationDestination(reloaded.notifications[0])).toBe(`/usdt-exchange/requests/${request.id}`);
      }
    }
  });

  it("retains one notice per recipient on publication replay and isolates account feeds", async () => {
    const body = { terms: demandTestTerms(), operationId: randomUUID() };
    const first = await publishDemand("buyer", body);
    const replay = await publishDemand("buyer", body);
    expect(replay.id).toBe(first.id);
    invalidateAlphaExchangeStoreCache();
    const seller = await getNotificationsForUser({ userId: "seller", includeActivity: false });
    const other = await getNotificationsForUser({ userId: "buyer-two", includeActivity: false });
    expect(seller.notifications).toHaveLength(1);
    expect(other.notifications).toHaveLength(0);
    expect(JSON.stringify(seller)).not.toMatch(/Private buyer|Private seller|example\.test|972500000001|100000001|fixture-only|passwordHash/);
    const stored = await (await getAlphaExchangeRepository()).loadSelectedSnapshot(["notifications"]);
    expect(stored.notifications).toHaveLength(2);
  });

  it.each(["en", "ar"] as const)("retains the exact response deep link after persistence, read-state change and replay for %s", async locale => {
    seed.users.find(user => user.id === "buyer")!.preferredLocale = locale;
    install();
    const request = await publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() });
    const body = { listingId: "listing-seller", revision: request.revision, price: "3.10", operationId: randomUUID() };
    const response = await offerDemand("seller", request.id, body);
    expect((await offerDemand("seller", request.id, body)).id).toBe(response.id);
    invalidateAlphaExchangeStoreCache();
    const buyer = await getNotificationsForUser({ userId: "buyer", includeActivity: false });
    expect(buyer.notifications).toHaveLength(1);
    expect(getSafeInternalNotificationDestination(buyer.notifications[0]))
      .toBe(`/usdt-exchange/requests/${request.id}?offer=${response.id}`);
    expect(buyer.notifications[0].messageEn).toContain("₪3.10");
    expect(JSON.stringify(buyer)).not.toMatch(/Private seller|seller@example|972500000001|100000001|fixture-only/);
    await markNotificationReadState({ userId: "buyer", notificationId: buyer.notifications[0].id, isRead: true });
    invalidateAlphaExchangeStoreCache();
    const reloaded = await getNotificationsForUser({ userId: "buyer", includeActivity: false });
    expect(getSafeInternalNotificationDestination(reloaded.notifications[0]))
      .toBe(`/usdt-exchange/requests/${request.id}?offer=${response.id}`);
  });

  it("does not recognize unrelated, mismatched-recipient or unsafe paths as a request notice", () => {
    const demandId = `demand-${randomUUID()}`;
    const canonical = { id: `demand-notice:${demandId}:1:new:seller`, userId: "seller",
      relatedHref: `/usdt-exchange/requests/${demandId}` };
    expect(demandNotificationDestination(canonical)).toBe(canonical.relatedHref);
    expect(demandNotificationDestination({ ...canonical, relatedHref: "/usdt-exchange", actionHref: "/usdt-exchange" }))
      .toBe(canonical.relatedHref);
    expect(demandNotificationDestination({ ...canonical, userId: "someone-else" })).toBeNull();
    expect(demandNotificationDestination({ ...canonical, id: "ordinary-listing-notice" })).toBeNull();
    for (const relatedHref of ["//external.example.test", "/usdt-exchange/requests/../admin", `${canonical.relatedHref}?redirect=//external.example.test`, `/usdt-exchange/requests/demand-${randomUUID()}`]) {
      expect(demandNotificationDestination({ ...canonical, relatedHref })).toBeNull();
    }
  });
});
