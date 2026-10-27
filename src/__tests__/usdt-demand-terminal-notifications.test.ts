// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { deleteNotification, getNotificationsForUser, invalidateAlphaExchangeStoreCache, markNotificationReadState } from "@/lib/alpha-exchange-store";
import { editDemand, offerDemand, publishDemand, runDemandExpiryNotifications, withdrawOffer } from "@/lib/usdt-demand-store";
import { DEMAND_EXPIRY_NOTIFICATION_BATCH } from "@/lib/usdt-demand-engine";
import { scheduleMobilePushDelivery } from "@/lib/mobile-push";
import { scheduleBrowserPushDelivery } from "@/lib/browser-push";
import { publishRealtimeEvent } from "@/lib/realtime";
import { getSafeInternalNotificationDestination } from "@/lib/notification-action-destination";
import { localizeNotificationActionLabel } from "@/lib/notification-localization";
import { demandTestDb, demandTestListing, demandTestTerms, demandTestUser } from "@/test-utils/usdt-demand-fixtures";
import type { UsdtDemand } from "@/types/usdt-demand";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/mobile-push", () => ({ scheduleMobilePushDelivery: vi.fn() }));
vi.mock("@/lib/browser-push", () => ({ scheduleBrowserPushDelivery: vi.fn() }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: vi.fn() }));
vi.mock("@/lib/market-service", async () => {
  const fixtures = await import("@/test-utils/usdt-demand-fixtures");
  return { DEFAULT_USD_ILS_RATE: 3.05, getMarketSnapshot: async () => fixtures.demandTestMarket(),
    getUsdtIlsReferenceRate: async () => 3.2 };
});

const snapshot = () => globalThis.__alphaExchangeMemorySnapshot!;
const storedDemand = () => snapshot().usdtDemands![0];
function makeDue(demand: UsdtDemand) {
  const at = new Date(Date.now() - 13 * 3600_000).toISOString();
  demand.createdAt = at;
  demand.history.filter(item => ["created", "renewed"].includes(item.action)).forEach(item => { item.at = at; });
  // Legacy stored 24h expiry must still follow the existing 12h policy.
  demand.expiresAt = new Date(Date.now() + 11 * 3600_000).toISOString();
}
async function requestWithOffer() {
  const demand = await publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() });
  const offer = await offerDemand("seller", demand.id, {
    listingId: "listing-seller", revision: demand.revision, price: "3.10", operationId: randomUUID(),
  });
  vi.clearAllMocks();
  return { demand, offer };
}
function expectNoPublication() {
  expect(scheduleMobilePushDelivery).not.toHaveBeenCalled();
  expect(scheduleBrowserPushDelivery).not.toHaveBeenCalled();
  expect(publishRealtimeEvent).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  globalThis.__alphaExchangeMemorySnapshot = demandTestDb();
  globalThis.__alphaExchangeRepositoryPromise = undefined;
  invalidateAlphaExchangeStoreCache();
  vi.resetAllMocks();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); invalidateAlphaExchangeStoreCache(); });

describe("Buy Request withdrawal and cancellation push", () => {
  it("alerts only the buyer after a withdrawal is committed and never repeats on replay", async () => {
    const { demand, offer } = await requestWithOffer();
    vi.mocked(scheduleMobilePushDelivery).mockImplementation(notice => {
      expect(storedDemand().offers[0].state).toBe("withdrawn");
      expect(snapshot().notifications.some(item => item.id === notice.id)).toBe(true);
    });
    await withdrawOffer("seller", demand.id, offer.id);
    expect(scheduleMobilePushDelivery).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      userId: "buyer", reason: "buy_request_offer_withdrawn",
      actionHref: `/usdt-exchange/requests/${demand.id}?offer=${offer.id}`,
    }));
    expect(scheduleBrowserPushDelivery).toHaveBeenCalledTimes(1);
    expect(publishRealtimeEvent).toHaveBeenCalledTimes(1);
    await withdrawOffer("seller", demand.id, offer.id);
    expect(scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
    expect(snapshot().notifications.filter(item => item.reason === "buy_request_offer_withdrawn")).toHaveLength(1);
  });

  it("alerts each current respondent once on cancellation, excluding the actor, withdrawn responses and the seller feed", async () => {
    snapshot().users.push(demandTestUser("seller-three", true), demandTestUser("unrelated-seller", true));
    snapshot().marketplaceListings.push(demandTestListing("seller-three"));
    const { demand } = await requestWithOffer();
    for (const seller of ["seller-two", "seller-three"]) {
      const offer = await offerDemand(seller, demand.id, {
        listingId: `listing-${seller}`, revision: demand.revision, price: "3.10", operationId: randomUUID(),
      });
      if (seller === "seller-three") await withdrawOffer(seller, demand.id, offer.id);
    }
    storedDemand().offers.push({ ...storedDemand().offers[0], id: `offer-${randomUUID()}` });
    vi.clearAllMocks();
    vi.mocked(scheduleMobilePushDelivery).mockImplementation(() => expect(storedDemand().state).toBe("cancelled"));
    const cancelled = await editDemand("buyer", demand.id, { action: "cancel", revision: demand.revision });
    expect(vi.mocked(scheduleMobilePushDelivery).mock.calls.map(([notice]) => notice.userId).sort()).toEqual(["seller", "seller-two"]);
    expect(scheduleBrowserPushDelivery).toHaveBeenCalledTimes(2);
    expect(publishRealtimeEvent).toHaveBeenCalledTimes(2);
    await editDemand("buyer", demand.id, { action: "cancel", revision: cancelled.revision });
    await expect(editDemand("buyer", demand.id, { action: "cancel", revision: demand.revision })).rejects.toMatchObject({ code: "REQUEST_CHANGED" });
    expect(scheduleMobilePushDelivery).toHaveBeenCalledTimes(2);
    expect(snapshot().notifications.filter(item => item.reason === "buy_request_cancelled")).toHaveLength(2);
  });

  it.each(["disabled", "recipient-blocked", "actor-blocked", "in-app-off"])("honors withdrawal recipient eligibility: %s", async mode => {
    const { demand, offer } = await requestWithOffer();
    const buyer = snapshot().users.find(user => user.id === "buyer")!;
    const seller = snapshot().users.find(user => user.id === "seller")!;
    if (mode === "disabled") buyer.disabled = true;
    if (mode === "recipient-blocked") buyer.blockedUserIds = [seller.id];
    if (mode === "actor-blocked") seller.blockedUserIds = [buyer.id];
    if (mode === "in-app-off") buyer.notificationPreferences = { inApp: false, email: true, sms: false };
    await withdrawOffer("seller", demand.id, offer.id);
    expectNoPublication();
    const notices = snapshot().notifications.filter(item => item.reason === "buy_request_offer_withdrawn");
    expect(notices).toHaveLength(mode === "in-app-off" ? 1 : 0);
    if (mode === "in-app-off") {
      expect(notices[0].state).toBe("archived");
      expect(notices[0].demandEmail).toBeUndefined();
    }
  });

  it.each(["disabled", "vacation", "blocked", "in-app-off"])("honors cancellation respondent eligibility: %s", async mode => {
    const { demand } = await requestWithOffer();
    const seller = snapshot().users.find(user => user.id === "seller")!;
    if (mode === "disabled") seller.disabled = true;
    if (mode === "vacation") seller.availabilityStatus = "vacation";
    if (mode === "blocked") seller.blockedUserIds = ["buyer"];
    if (mode === "in-app-off") seller.notificationPreferences = { inApp: false, email: true, sms: false };
    await editDemand("buyer", demand.id, { action: "cancel", revision: demand.revision });
    expectNoPublication();
    const notices = snapshot().notifications.filter(item => item.reason === "buy_request_cancelled");
    expect(notices).toHaveLength(mode === "in-app-off" ? 1 : 0);
    if (mode === "in-app-off") expect(notices[0].demandEmail).toBeUndefined();
  });

  it.each(["expired", "stale", "cancelled", "matched"])("does not alert for a non-actionable withdrawal: %s", async mode => {
    const { demand, offer } = await requestWithOffer();
    if (mode === "expired") makeDue(storedDemand());
    if (mode === "stale") storedDemand().revision += 1;
    if (mode === "cancelled" || mode === "matched") storedDemand().state = mode;
    await withdrawOffer("seller", demand.id, offer.id);
    expectNoPublication();
  });

  it("rejects unauthorized withdrawal, accepted withdrawal, stale cancellation and cancellation after a match without alerts", async () => {
    const { demand, offer } = await requestWithOffer();
    await expect(withdrawOffer("seller-two", demand.id, offer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(editDemand("buyer", demand.id, { action: "cancel", revision: demand.revision + 1 })).rejects.toMatchObject({ code: "REQUEST_CHANGED" });
    storedDemand().offers[0].state = "accepted";
    storedDemand().state = "matched";
    await expect(withdrawOffer("seller", demand.id, offer.id)).rejects.toMatchObject({ code: "TRADE_EXISTS" });
    await expect(editDemand("buyer", demand.id, { action: "cancel", revision: demand.revision })).rejects.toMatchObject({ code: "TRADE_EXISTS" });
    expectNoPublication();
  });

  it.each(["cancel", "withdraw"])("publishes nothing and preserves canonical state when %s persistence fails", async mode => {
    const { demand, offer } = await requestWithOffer();
    const before = structuredClone(snapshot());
    vi.spyOn(await getAlphaExchangeRepository(), "saveSnapshot").mockRejectedValueOnce(new Error("injected storage failure"));
    await expect(mode === "cancel" ? editDemand("buyer", demand.id, { action: "cancel", revision: demand.revision })
      : withdrawOffer("seller", demand.id, offer.id)).rejects.toThrow("injected storage failure");
    expectNoPublication();
    expect(snapshot()).toEqual(before);
  });
});

describe("Scheduled buyer expiry notices", () => {
  it("uses the existing 12-hour policy, notifies only the buyer once and leaves all financial/request state unchanged", async () => {
    await requestWithOffer();
    makeDue(storedDemand());
    const before = structuredClone(storedDemand());
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 1 });
    expect(scheduleMobilePushDelivery).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ userId: "buyer", reason: "buy_request_expired" }));
    expect(scheduleBrowserPushDelivery).toHaveBeenCalledTimes(1);
    expect(publishRealtimeEvent).toHaveBeenCalledTimes(1);
    expect(storedDemand()).toEqual({ ...before, expiryNotifiedRevision: before.revision });
    expect(snapshot().purchaseRequests).toEqual([]);
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 0 });
    expect(scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
  });

  it.each(["future", "historical", "cancelled", "matched", "accepted-history", "accepted-offer", "disabled", "missing-buyer", "invalid-expiry"])("skips %s requests", async mode => {
    await requestWithOffer();
    if (mode !== "future") makeDue(storedDemand());
    if (mode === "cancelled" || mode === "matched") storedDemand().state = mode;
    if (mode === "accepted-history") storedDemand().history.push({ action: "matched", actorId: "buyer", at: new Date().toISOString(), revision: 1, offerId: storedDemand().offers[0].id });
    if (mode === "accepted-offer") storedDemand().offers[0].state = "accepted";
    if (mode === "disabled") snapshot().users.find(user => user.id === "buyer")!.disabled = true;
    if (mode === "missing-buyer") snapshot().users = snapshot().users.filter(user => user.id !== "buyer");
    if (mode === "invalid-expiry") storedDemand().expiresAt = "invalid";
    if (mode === "historical") storedDemand().expiresAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 0 });
    expectNoPublication();
  });

  it("does not recreate expiry alerts after an inbox deletion or pruning removes their canonical notification", async () => {
    await requestWithOffer(); makeDue(storedDemand());
    await runDemandExpiryNotifications();
    const notice = snapshot().notifications.find(item => item.reason === "buy_request_expired")!;
    await deleteNotification({ userId: "buyer", notificationId: notice.id });
    expect(snapshot().notifications.some(item => item.id === notice.id)).toBe(false);
    vi.clearAllMocks();
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 0 });
    expectNoPublication();
  });

  it("repairs a missing revision marker for an existing notice so later pruning cannot recreate it", async () => {
    await requestWithOffer(); makeDue(storedDemand());
    await runDemandExpiryNotifications();
    delete storedDemand().expiryNotifiedRevision;
    vi.clearAllMocks();
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 0 });
    expect(storedDemand().expiryNotifiedRevision).toBe(storedDemand().revision);
    snapshot().notifications = snapshot().notifications.filter(item => item.reason !== "buy_request_expired");
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 0 });
    expectNoPublication();
  });

  it("archives an opted-out buyer's notice without a push or an incompatible open-request email", async () => {
    await requestWithOffer();
    makeDue(storedDemand());
    snapshot().users.find(user => user.id === "buyer")!.notificationPreferences = { inApp: false, email: true, sms: false };
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 1 });
    expectNoPublication();
    const notice = snapshot().notifications.find(item => item.reason === "buy_request_expired")!;
    expect(notice.state).toBe("archived");
    expect(notice.demandEmail).toBeUndefined();
  });

  it("drains a bounded backlog without already-notified or disabled recipients starving later requests", async () => {
    await requestWithOffer();
    makeDue(storedDemand());
    const template = structuredClone(storedDemand());
    const disabled = demandTestUser("disabled-buyer"); disabled.disabled = true; snapshot().users.push(disabled);
    snapshot().usdtDemands = [
      ...Array.from({ length: 105 }, () => ({ ...structuredClone(template), id: `demand-${randomUUID()}`, requesterId: disabled.id })),
      ...Array.from({ length: DEMAND_EXPIRY_NOTIFICATION_BATCH + 1 }, () => ({ ...structuredClone(template), id: `demand-${randomUUID()}` })),
    ];
    expect(await runDemandExpiryNotifications()).toEqual({ notified: DEMAND_EXPIRY_NOTIFICATION_BATCH });
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 1 });
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 0 });
    expect(scheduleMobilePushDelivery).toHaveBeenCalledTimes(DEMAND_EXPIRY_NOTIFICATION_BATCH + 1);
    expect(new Set(snapshot().notifications.filter(item => item.reason === "buy_request_expired").map(item => item.id)).size).toBe(DEMAND_EXPIRY_NOTIFICATION_BATCH + 1);
  });

  it("issues a new expiry notice only after a renewed revision reaches its own deadline", async () => {
    const { demand } = await requestWithOffer();
    makeDue(storedDemand());
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 1 });
    await editDemand("buyer", demand.id, { action: "renew", revision: demand.revision, terms: demandTestTerms() });
    vi.clearAllMocks();
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 0 });
    makeDue(storedDemand());
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 1 });
    expect(scheduleMobilePushDelivery).toHaveBeenCalledTimes(1);
    expect(snapshot().notifications.filter(item => item.reason === "buy_request_expired")).toHaveLength(2);
  });

  it("suppresses speculative expiry sends after a canonical rebase finds an existing notice", async () => {
    await requestWithOffer(); makeDue(storedDemand());
    vi.spyOn(await getAlphaExchangeRepository(), "saveSnapshot").mockImplementationOnce(async (db, options) => {
      const canonical = structuredClone(db);
      await options?.rebaseOnLatest?.(canonical);
      globalThis.__alphaExchangeMemorySnapshot = canonical;
    });
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 0 });
    expectNoPublication();
    expect(snapshot().notifications.filter(item => item.reason === "buy_request_expired")).toHaveLength(1);
  });

  it("does not publish expiry notices on storage failure and retries successfully later", async () => {
    await requestWithOffer(); makeDue(storedDemand());
    const before = structuredClone(snapshot());
    vi.spyOn(await getAlphaExchangeRepository(), "saveSnapshot").mockRejectedValueOnce(new Error("injected expiry failure"));
    await expect(runDemandExpiryNotifications()).rejects.toThrow("injected expiry failure");
    expectNoPublication(); expect(snapshot()).toEqual(before);
    expect(await runDemandExpiryNotifications()).toEqual({ notified: 1 });
  });
});

describe("Terminal notice destinations", () => {
  it.each(["en", "ar"] as const)("preserves private recipient-bound request/offer links through read-state persistence for %s", async locale => {
    snapshot().users.forEach(user => { user.preferredLocale = locale; });
    const { demand, offer } = await requestWithOffer();
    await withdrawOffer("seller", demand.id, offer.id);
    await offerDemand("seller-two", demand.id, { listingId: "listing-seller-two", revision: demand.revision, price: "3.10", operationId: randomUUID() });
    await editDemand("buyer", demand.id, { action: "cancel", revision: demand.revision });
    storedDemand().state = "expired"; makeDue(storedDemand());
    await runDemandExpiryNotifications();
    for (const [userId, reason, suffix] of [["buyer", "buy_request_offer_withdrawn", `?offer=${offer.id}`], ["seller-two", "buy_request_cancelled", ""], ["buyer", "buy_request_expired", ""]]) {
      invalidateAlphaExchangeStoreCache();
      const feed = await getNotificationsForUser({ userId, includeActivity: false });
      const notice = feed.notifications.find(item => item.reason === reason)!;
      expect(notice).toBeDefined();
      const destination = `/usdt-exchange/requests/${demand.id}${suffix}`;
      expect(getSafeInternalNotificationDestination(notice)).toBe(destination);
      expect(localizeNotificationActionLabel(notice.actionLabel, locale, notice)).toBe(locale === "ar" ? "عرض طلب USDT" : "View USDT request");
      expect(JSON.stringify(notice)).not.toMatch(/Private seller|example\.test|972500000001|100000001|fixture-only|passwordHash/);
      await markNotificationReadState({ userId, notificationId: notice.id, isRead: true });
      invalidateAlphaExchangeStoreCache();
      const reloaded = (await getNotificationsForUser({ userId, includeActivity: false })).notifications.find(item => item.id === notice.id)!;
      expect(reloaded.state).toBe("read");
      expect(getSafeInternalNotificationDestination(reloaded)).toBe(destination);
    }
  });
});
