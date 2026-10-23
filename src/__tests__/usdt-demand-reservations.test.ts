// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { demandTestDb, demandTestTerms, DEMAND_TEST_WALLET } from "@/test-utils/usdt-demand-fixtures";
import { publishDemand, offerDemand } from "@/lib/usdt-demand-store";
import { createPurchaseRequest, invalidateAlphaExchangeStoreCache, updateMarketplaceListingForSeller, updatePurchaseRequestStatus } from "@/lib/alpha-exchange-store";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

const hooks = vi.hoisted(() => ({ market: undefined as undefined | (() => Promise<void>), reference: undefined as undefined | (() => Promise<void>) }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/market-service", async () => {
  const { demandTestMarket } = await import("@/test-utils/usdt-demand-fixtures");
  return { DEFAULT_USD_ILS_RATE: 3.05, getMarketSnapshot: async () => { await hooks.market?.(); return demandTestMarket(); }, getUsdtIlsReferenceRate: async () => { await hooks.reference?.(); return 3.2; } };
});
beforeEach(() => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1"); vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  globalThis.__alphaExchangeMemorySnapshot = structuredClone(demandTestDb());
  globalThis.__alphaExchangeRepositoryPromise = undefined;
  globalThis.__alphaExchangeMemoryEvidenceContent = new Map(); hooks.market = undefined; hooks.reference = undefined;
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const stored = async () => (await getAlphaExchangeRepository()).loadSnapshot();
async function prepare(buyerId = "buyer") {
  const d = await publishDemand(buyerId, { terms: demandTestTerms(), operationId: randomUUID() });
  const o = await offerDemand("seller", d.id, { listingId: "listing-seller", revision: 1, price: "3.10", operationId: randomUUID() });
  return { buyerId, actorUserId: buyerId, buyerName: "Private buyer", listingId: "listing-seller", usdtAmount: "1000",
    buyerReceivingWalletAddress: DEMAND_TEST_WALLET, receivingNetwork: "TRC20", paymentMethod: "Bank Transfer",
    feePolicyVersion: "buyer_seller_1pct_v1" as const, usdtDemandId: d.id, usdtDemandOfferId: o.id, usdtDemandRevision: 1 };
}
function shrinkListing() {
  return updateMarketplaceListingForSeller({ listingId: "listing-seller", sellerId: "seller", actorUserId: "seller", availableAmount: "500", maximumTrade: "500", changeReason: "inventory_update" });
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe("pending demand inventory reservations", () => {
  it("commits the listing lock with the match and refuses a seller inventory edit", async () => {
    const input = await prepare(); const created = await createPurchaseRequest(input);
    expect((await stored()).marketplaceListings[0]).toMatchObject({ status: "matched", activeTradeRequestId: created.request.id, availableAmount: "10000" });
    await expect(shrinkListing()).rejects.toThrow(/locked/);
    expect((await stored()).marketplaceListings[0].availableAmount).toBe("10000");
  });
  it.each(["cancelled", "declined"] as const)("releases the pending reservation on %s without deducting inventory", async status => {
    const input = await prepare(); const { request } = await createPurchaseRequest(input);
    const isSeller = status === "declined";
    await updatePurchaseRequestStatus({ requestId: request.id, nextStatus: status,
      actorUserId: isSeller ? "seller" : "buyer", actorRole: isSeller ? "approved_seller" : "buyer" });
    const snapshot = await stored();
    expect(snapshot.marketplaceListings[0]).toMatchObject({ status: "active", availableAmount: "10000" });
    expect(snapshot.marketplaceListings[0].activeTradeRequestId).toBeUndefined();
    await expect(shrinkListing()).resolves.toMatchObject({ availableAmount: "500" });
  });
  it("seller acceptance retains one reservation and cancellation releases it", async () => {
    const { request } = await createPurchaseRequest(await prepare());
    const command = { requestId: request.id, nextStatus: "accepted" as const, actorUserId: "seller", actorRole: "approved_seller" as const };
    await updatePurchaseRequestStatus(command); await updatePurchaseRequestStatus(command);
    expect((await stored()).marketplaceListings[0]).toMatchObject({ status: "matched", activeTradeRequestId: request.id, availableAmount: "10000" });
    await expect(shrinkListing()).rejects.toThrow(/locked/);
    await updatePurchaseRequestStatus({ requestId: request.id, nextStatus: "cancelled", actorUserId: "buyer", actorRole: "buyer" });
    expect((await stored()).marketplaceListings[0]).toMatchObject({ status: "active", availableAmount: "10000" });
  });
  it("duplicate concurrent match taps persist one trade and its listing lock", async () => {
    const input = await prepare();
    const results = await Promise.allSettled([createPurchaseRequest(input), createPurchaseRequest(input)]);
    expect(results.some(result => result.status === "fulfilled")).toBe(true);
    const snapshot = await stored(); expect(snapshot.purchaseRequests).toHaveLength(1);
    expect(snapshot.usdtDemands![0].purchaseRequestId).toBe(snapshot.purchaseRequests[0].id);
    expect(snapshot.marketplaceListings[0]).toMatchObject({ status: "matched", activeTradeRequestId: snapshot.purchaseRequests[0].id });
  });
  it("keeps the other pending demand reserved when one seller response is declined", async () => {
    await createPurchaseRequest(await prepare()); await createPurchaseRequest(await prepare("buyer-two"));
    const before = await stored(); const representative = before.marketplaceListings[0].activeTradeRequestId!;
    const remaining = before.purchaseRequests.find(request => request.id !== representative)!;
    await updatePurchaseRequestStatus({ requestId: representative, nextStatus: "declined", actorUserId: "seller", actorRole: "approved_seller" });
    expect((await stored()).marketplaceListings[0]).toMatchObject({ status: "matched", activeTradeRequestId: remaining.id, availableAmount: "10000" });
    await expect(shrinkListing()).rejects.toThrow(/locked/);
    await updatePurchaseRequestStatus({ requestId: remaining.id, nextStatus: "cancelled", actorUserId: remaining.buyerId, actorRole: "buyer" });
    expect((await stored()).marketplaceListings[0]).toMatchObject({ status: "active", availableAmount: "10000" });
  });
  it("rejects a match if a seller inventory edit wins the race", async () => {
    const input = await prepare(); const paused = gate(); const entered = gate();
    hooks.market = async () => { entered.resolve(); await paused.promise; };
    const matching = createPurchaseRequest(input); const outcome = matching.then(() => "matched", () => "rejected");
    await entered.promise; await shrinkListing(); paused.resolve();
    expect(await outcome).toBe("rejected");
    expect((await stored()).purchaseRequests).toHaveLength(0);
    expect((await stored()).marketplaceListings[0]).toMatchObject({ status: "active", availableAmount: "500" });
  });
  it("rejects a stale inventory edit if the demand match wins the commit race", async () => {
    const input = await prepare(); const paused = gate(); const entered = gate();
    // Pause the seller's quote validation after reading its old listing, before
    // writeDb's local commit queue. The match can then acquire the commit first.
    hooks.reference = async () => { hooks.reference = undefined; entered.resolve(); await paused.promise; };
    const editing = updateMarketplaceListingForSeller({ listingId: "listing-seller", sellerId: "seller", actorUserId: "seller", availableAmount: "500", maximumTrade: "500", price: "3.21" });
    const outcome = editing.then(() => "edited", () => "rejected");
    await entered.promise; const match = await createPurchaseRequest(input); paused.resolve();
    expect(await outcome).toBe("rejected");
    expect((await stored()).marketplaceListings[0]).toMatchObject({ status: "matched", availableAmount: "10000", activeTradeRequestId: match.request.id });
    expect((await stored()).purchaseRequests).toHaveLength(1);
  });
});
