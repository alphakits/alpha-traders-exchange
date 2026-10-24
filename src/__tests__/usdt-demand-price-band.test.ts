// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIlsReferencePriceBounds, maximumIlsListingPrice } from "@alpha-traders/contracts";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { DEMAND_TEST_WALLET, demandTestDb, demandTestMarket, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";
import { changeDemand, createDemand, readDemandWorkspace, respondToDemand } from "@/lib/usdt-demand-engine";
import { assertDemandPrice, commitDemandMatch, demandReference, validateDemandMatch } from "@/lib/usdt-demand-policy";
import { editDemand, mutateDemands, offerDemand, publishDemand } from "@/lib/usdt-demand-store";
import { createPurchaseRequest, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

const market = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/market-service", () => ({ DEFAULT_USD_ILS_RATE: 3.05, getMarketSnapshot: market.get, getUsdtIlsReferenceRate: async () => 3.1 }));
let db = demandTestDb();
const terms = (price = "3.10") => ({ ...demandTestTerms(), price });
const publish = (price = "3.10") => createDemand(db, "buyer", { terms: terms(price), operationId: randomUUID() }, demandTestMarket(3.1));
const respond = (id: string, price = "3.10", rate = 3.1) => respondToDemand(db, "seller", id, { listingId: "listing-seller", revision: 1, price, operationId: randomUUID() }, demandTestMarket(rate));
const stored = async () => (await getAlphaExchangeRepository()).loadSnapshot();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1"); vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  db = demandTestDb();
  globalThis.__alphaExchangeMemorySnapshot = structuredClone(db);
  globalThis.__alphaExchangeRepositoryPromise = undefined;
  globalThis.__alphaExchangeMemoryEvidenceContent = new Map();
  invalidateAlphaExchangeStoreCache();
  market.get.mockReset().mockImplementation(async () => demandTestMarket(3.1));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("exact live-reference cent boundaries", () => {
  it.each([
    [3.1, "2.75", "3.45"], [3.105, "2.76", "3.45"], [3.205, "2.86", "3.55"],
    [3.100000001, "2.76", "3.45"], [3.099999999, "2.75", "3.44"],
  ])("keeps the unrounded reference %s within %s–%s", (rate, minimum, maximum) => {
    const reference = Number(rate);
    expect(getIlsReferencePriceBounds(reference)).toEqual({ minimumPrice: minimum, maximumPrice: maximum });
    expect(demandReference(demandTestMarket(reference))).toMatchObject({ minimum, maximum });
    expect(maximumIlsListingPrice(reference).toFixed(2)).toBe(maximum);
    expect(assertDemandPrice(String(minimum), demandTestMarket(reference))).toBe(minimum);
    expect(assertDemandPrice(String(maximum), demandTestMarket(reference))).toBe(maximum);
    expect(() => assertDemandPrice((Number(minimum) - .01).toFixed(2), demandTestMarket(reference))).toThrow(/between/);
    expect(() => assertDemandPrice((Number(maximum) + .01).toFixed(2), demandTestMarket(reference))).toThrow(/between/);
  });

  it("preserves both inclusive boundaries for every whole-cent supported reference", () => {
    for (let cents = 200; cents <= 1000; cents++) {
      expect(getIlsReferencePriceBounds(cents / 100)).toEqual({ minimumPrice: ((cents - 35) / 100).toFixed(2), maximumPrice: ((cents + 35) / 100).toFixed(2) });
    }
  });

  it.each(["2.75", "3.45"])("accepts %s at publication, renewal, response and match", price => {
    const d = publish(price);
    vi.setSystemTime(Date.now() + 300_000);
    changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: terms(price) }, demandTestMarket(3.1));
    const o = respondToDemand(db, "seller", d.id, { listingId: "listing-seller", revision: d.revision, price, operationId: randomUUID() }, demandTestMarket(3.1));
    const input = { buyerId: "buyer", demandId: d.id, offerId: o.id, revision: d.revision, listingId: o.listingId, amount: d.amount, paymentMethod: d.paymentMethod, network: d.network };
    expect(validateDemandMatch(db, input, demandTestMarket(3.1)).offer.price).toBe(price);
    commitDemandMatch(db, input, demandTestMarket(3.1), { id: "matched-trade", pricePerUsdt: price, feePolicyVersion: "buyer_seller_1pct_v1" } as PurchaseRequest);
    expect(d.state).toBe("matched");
  });

  it.each(["2.74", "3.46"])("rejects %s at publication, renewal and response without changing data", price => {
    expect(() => publish(price)).toThrow(/2.75.*3.45/);
    expect(db.usdtDemands).toHaveLength(0); expect(db.notifications).toHaveLength(0);
    const d = publish(); vi.setSystemTime(Date.now() + 300_000);
    const before = structuredClone(db);
    expect(() => changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: terms(price) }, demandTestMarket(3.1))).toThrow(/2.75.*3.45/);
    expect(() => respond(d.id, price)).toThrow(/2.75.*3.45/);
    expect(db).toEqual(before);
  });

  it("pauses a request when the reference moves, then recovers only with a valid renewal", () => {
    const d = publish("3.45");
    expect(readDemandWorkspace(db, "buyer", demandTestMarket(3.09)).requests[0].state).toBe("paused");
    expect(readDemandWorkspace(db, "seller", demandTestMarket(3.09), { scope: "available" }).requests).toHaveLength(0);
    expect(() => respond(d.id, "3.10", 3.09)).toThrow(/no longer open/);
    vi.setSystemTime(Date.now() + 300_000);
    expect(() => changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: terms("3.45") }, demandTestMarket(3.09))).toThrow(/3.44/);
    changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: terms("3.44") }, demandTestMarket(3.09));
    expect(readDemandWorkspace(db, "seller", demandTestMarket(3.09), { scope: "available" }).requests[0].state).toBe("open");
  });

  it.each(["requested", "offered"])("rechecks the %s price against a changed quote at final match", which => {
    const d = publish(which === "requested" ? "3.45" : "3.10");
    const o = respond(d.id, which === "offered" ? "3.45" : "3.10");
    const input = { buyerId: "buyer", demandId: d.id, offerId: o.id, revision: 1, listingId: o.listingId, amount: d.amount, paymentMethod: d.paymentMethod, network: d.network };
    const before = structuredClone(db);
    expect(() => validateDemandMatch(db, input, demandTestMarket(3.09))).toThrow(/3.44/);
    expect(() => commitDemandMatch(db, input, demandTestMarket(3.09), { id: "rejected-trade", pricePerUsdt: o.price, feePolicyVersion: "buyer_seller_1pct_v1" } as PurchaseRequest)).toThrow(/3.44/);
    expect(db).toEqual(before);
    expect(readDemandWorkspace(db, "buyer", demandTestMarket(3.09), { id: d.id }).requests[0].offers[0].available).toBe(false);
  });

  it("rejects an expired quote at final commit and permits cancellation without a quote", () => {
    const d = publish(); const o = respond(d.id); const quote = demandTestMarket(3.1);
    const input = { buyerId: "buyer", demandId: d.id, offerId: o.id, revision: 1, listingId: o.listingId, amount: d.amount, paymentMethod: d.paymentMethod, network: d.network };
    vi.setSystemTime(Date.now() + 120_000);
    expect(() => commitDemandMatch(db, input, quote, { id: "rejected-trade", pricePerUsdt: o.price, feePolicyVersion: "buyer_seller_1pct_v1" } as PurchaseRequest)).toThrow(/fresh/);
    expect(d.state).toBe("open");
    changeDemand(db, "buyer", d.id, { action: "cancel", revision: 1 }, quote);
    expect(d.state).toBe("cancelled");
  });
});

describe("fresh quote mutation boundaries", () => {
  async function prepare() {
    const d = await publishDemand("buyer", { terms: terms(), operationId: randomUUID() });
    const o = await offerDemand("seller", d.id, { listingId: "listing-seller", revision: 1, price: "3.45", operationId: randomUUID() });
    return { d, input: { buyerId: "buyer", actorUserId: "buyer", buyerName: "Private buyer", listingId: o.listingId, usdtAmount: d.amount,
      buyerReceivingWalletAddress: DEMAND_TEST_WALLET, receivingNetwork: d.network, paymentMethod: d.paymentMethod,
      feePolicyVersion: "buyer_seller_1pct_v1" as const, usdtDemandId: d.id, usdtDemandOfferId: o.id, usdtDemandRevision: 1 } };
  }

  it("refreshes the provider for publish, renew and response instead of accepting a cached higher ceiling", async () => {
    market.get.mockImplementation(async (options?: { forceRefresh?: boolean }) => demandTestMarket(options?.forceRefresh ? 3.1 : 3.2));
    await expect(publishDemand("buyer", { terms: terms("3.46"), operationId: randomUUID() })).rejects.toMatchObject({ code: "PRICE_OUTSIDE_BAND" });
    const d = await publishDemand("buyer", { terms: terms(), operationId: randomUUID() });
    await expect(offerDemand("seller", d.id, { listingId: "listing-seller", revision: 1, price: "3.46", operationId: randomUUID() })).rejects.toMatchObject({ code: "PRICE_OUTSIDE_BAND" });
    vi.setSystemTime(Date.now() + 300_000);
    await expect(editDemand("buyer", d.id, { action: "renew", revision: 1, terms: terms("3.46") })).rejects.toMatchObject({ code: "PRICE_OUTSIDE_BAND" });
    expect(market.get.mock.calls.every(([options]) => options?.forceRefresh === true)).toBe(true);
    expect((await stored()).usdtDemands![0]).toMatchObject({ price: "3.10", revision: 1, offers: [] });
  });

  it("refreshes only after a queued mutation gets its turn", async () => {
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const blocker = mutateDemands(() => undefined, async () => { entered(); await gate; });
    await ready;
    const waiting = publishDemand("buyer", { terms: terms("3.45"), operationId: randomUUID() });
    const outcome = waiting.then(() => "published", error => error.code);
    await Promise.resolve();
    expect(market.get).not.toHaveBeenCalled();
    market.get.mockImplementation(async () => demandTestMarket(3.09));
    release(); await blocker;
    expect(await outcome).toBe("PRICE_OUTSIDE_BAND");
    expect((await stored()).usdtDemands).toHaveLength(0);
  });

  it.each(["lower", "unavailable", "expired"])("rolls back the entire match if its pre-write quote becomes %s", async change => {
    const { input } = await prepare();
    const before = await stored();
    const rejected = demandTestMarket(change === "lower" ? 3.09 : 3.1, change === "expired" ? 120_000 : 0);
    if (change === "unavailable") rejected.unavailablePairs.push("usdtIls");
    market.get.mockReset().mockResolvedValueOnce(demandTestMarket(3.1)).mockResolvedValue(rejected);
    await expect(createPurchaseRequest(input)).rejects.toMatchObject({ code: change === "lower" ? "PRICE_OUTSIDE_BAND" : "QUOTE_UNAVAILABLE" });
    expect(market.get).toHaveBeenCalledTimes(2);
    expect(market.get.mock.calls.every(([options]) => options?.forceRefresh === true)).toBe(true);
    const after = await stored();
    expect(after.purchaseRequests).toHaveLength(0);
    expect(after.usdtDemands).toEqual(before.usdtDemands);
    expect(after.notifications).toEqual(before.notifications);
    expect(after.marketplaceListings).toEqual(before.marketplaceListings);
  });

  it("replays a committed trade without changing terms or depending on a new quote", async () => {
    const { input } = await prepare(); const first = await createPurchaseRequest(input);
    market.get.mockClear().mockRejectedValue(new Error("Provider unavailable"));
    const replay = await createPurchaseRequest(input);
    expect(replay).toMatchObject({ replayed: true, request: { id: first.request.id, pricePerUsdt: "3.45" } });
    expect(market.get).not.toHaveBeenCalled();
    expect((await stored()).purchaseRequests).toHaveLength(1);
  });

  it("cancels an open request without calling an unavailable provider", async () => {
    const d = await publishDemand("buyer", { terms: terms(), operationId: randomUUID() });
    market.get.mockClear().mockRejectedValue(new Error("Provider unavailable"));
    await expect(editDemand("buyer", d.id, { action: "cancel", revision: 1 })).resolves.toMatchObject({ state: "cancelled", revision: 2 });
    expect(market.get).not.toHaveBeenCalled();
    expect((await stored()).usdtDemands![0].state).toBe("cancelled");
  });

  it("fails closed before fetching a quote when the feature is disabled", async () => {
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0");
    await expect(publishDemand("buyer", { terms: terms(), operationId: randomUUID() })).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    expect(market.get).not.toHaveBeenCalled();
  });
});
