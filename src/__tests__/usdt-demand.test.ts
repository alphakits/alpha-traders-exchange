// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { calculateCardlessUsdtAmount } from "@alpha-traders/contracts";
import { demandTestDb, demandTestMarket, demandTestTerms, DEMAND_TEST_WALLET } from "@/test-utils/usdt-demand-fixtures";
import { assertDemandActor, assertDemandListing, assertDemandPrice, assertDemandTerms, canRespond, commitDemandMatch, demandState, validateDemandMatch } from "@/lib/usdt-demand-policy";
import { createDemand, changeDemand, respondToDemand, readDemandWorkspace, withdrawDemandOffer } from "@/lib/usdt-demand-engine";
import { publishDemand, offerDemand } from "@/lib/usdt-demand-store";
import { createPurchaseRequest, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import type { PurchaseRequest } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/market-service", async () => {
  const { demandTestMarket } = await import("@/test-utils/usdt-demand-fixtures");
  return { DEFAULT_USD_ILS_RATE: 3.05, getMarketSnapshot: async () => demandTestMarket(), getUsdtIlsReferenceRate: async () => 3.2 };
});
let db = demandTestDb();
const publish = () => createDemand(db, "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket());
const offer = (id: string, seller = "seller", price = "3.20") => respondToDemand(db, seller, id, { listingId: `listing-${seller}`, revision: 1, price, operationId: randomUUID() }, demandTestMarket());
beforeEach(() => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  db = demandTestDb(); globalThis.__alphaExchangeMemorySnapshot = structuredClone(db);
  globalThis.__alphaExchangeRepositoryPromise = undefined;
  globalThis.__alphaExchangeMemoryEvidenceContent = new Map();
  invalidateAlphaExchangeStoreCache();
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("request rules", () => {
  it.each(["2.85", "3.55"])("accepts the inclusive ±0.35 boundary %s", p => expect(assertDemandPrice(p, demandTestMarket())).toBe(p));
  it.each(["2.84", "3.56", "3.201", "0", "NaN"])("rejects invalid/out-of-band price %s", p => expect(() => assertDemandPrice(p, demandTestMarket())).toThrow());
  it("does not round a fractional live ceiling upward", () => { expect(() => assertDemandPrice("3.56", demandTestMarket(3.205))).toThrow(); expect(assertDemandPrice("3.55", demandTestMarket(3.205))).toBe("3.55"); });
  it("rejects stale and unavailable quotes", () => { expect(() => assertDemandPrice("3.20", demandTestMarket(3.2, 120001))).toThrow(); const market = demandTestMarket(); market.unavailablePairs.push("usdtIls"); expect(() => assertDemandPrice("3.20", market)).toThrow(); });
  it.each(["disabled", "email", "phone", "age", "role"])("denies an ineligible %s account", field => {
    const user = db.users[0];
    if (field === "disabled") user.disabled = true;
    if (field === "email") user.emailVerified = false;
    if (field === "phone") delete user.phoneVerifiedAt;
    if (field === "age") delete user.ageEligibility;
    if (field === "role") Object.assign(user, { role: "guest", roles: [], sellerStatus: "rejected" });
    expect(() => assertDemandActor(user)).toThrow();
  });
  it("supports eligible sellers requesting as buyers", () => expect(createDemand(db, "seller", { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket()).requesterId).toBe("seller"));
  it.each(["..", "--"])("rejects a punctuation-only meeting city %s", city => {
    expect(() => createDemand(db, "buyer", { terms: { ...demandTestTerms(), paymentMethod: "Face-to-Face (Meet in Person)", city }, operationId: randomUUID() }, demandTestMarket())).toThrow(/meeting city/);
    expect(db.usdtDemands).toHaveLength(0);
  });
  it("creates only one request and one notice per eligible seller on retry", () => {
    const body = { terms: demandTestTerms(), operationId: randomUUID() };
    const d = createDemand(db, "buyer", body, demandTestMarket());
    expect(createDemand(db, "buyer", body, demandTestMarket()).id).toBe(d.id);
    expect(db.usdtDemands).toHaveLength(1); expect(db.notifications).toHaveLength(2);
    expect(db.notifications.every(n => n.relatedHref?.endsWith(d.id))).toBe(true);
    expect(() => createDemand(db, "buyer", { ...body, terms: { ...body.terms, amount: "2000" } }, demandTestMarket())).toThrow(/key/);
    expect(() => publish()).toThrow(/already/);
  });
  it("honors blocks, suspension and availability for seller discovery", () => {
    const seller = db.users[2]; seller.blockedUserIds = ["buyer"]; expect(canRespond(db, seller, "buyer")).toBe(false);
    seller.blockedUserIds = []; seller.sellerStatus = "suspended"; expect(canRespond(db, seller, "buyer")).toBe(false);
    seller.sellerStatus = "approved_seller"; seller.availabilityStatus = "vacation"; publish(); expect(db.notifications).toHaveLength(1);
  });
  it("pauses changing prices without rewriting terms", () => { const d = publish(); expect(demandState(db, d, demandTestMarket(4))).toBe("paused"); expect(d.price).toBe("3.20"); });
  it("expires after 24h and requires manual renewal", () => {
    const d = publish(); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 86400_001);
    expect(demandState(db, d, demandTestMarket())).toBe("expired");
    changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: demandTestTerms() }, demandTestMarket());
    expect(d.revision).toBe(2); expect(demandState(db, d, demandTestMarket())).toBe("open");
  });
  it("rejects stale revisions and unauthorized updates", () => {
    const d = publish(); expect(() => changeDemand(db, "buyer-two", d.id, { action: "cancel", revision: 1 }, demandTestMarket())).toThrow(/not found/);
    changeDemand(db, "buyer", d.id, { action: "cancel", revision: 1 }, demandTestMarket());
    expect(() => changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: demandTestTerms() }, demandTestMarket())).toThrow(/changed/);
  });
  it("limits re-publication and never reopens an active trade", () => {
    const d = publish(); expect(() => changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: demandTestTerms() }, demandTestMarket())).toThrow(/five minutes/);
    d.state = "matched"; expect(() => changeDemand(db, "buyer", d.id, { action: "cancel", revision: 1 }, demandTestMarket())).toThrow(/Trade Room/);
  });
  it("requires an exact ATM cash total including the buyer fee", () => {
    const terms = { ...demandTestTerms(), paymentMethod: "Cardless ATM Withdrawal" as const };
    expect(() => assertDemandTerms(terms, demandTestMarket())).toThrow(/ATM/);
    terms.amount = calculateCardlessUsdtAmount("1000", terms.price, true)!;
    expect(() => assertDemandTerms(terms, demandTestMarket())).not.toThrow();
  });
  it("replays the original publication after renewal without reapplying its original terms", () => {
    const body = { terms: { ...demandTestTerms(), city: "ignored for bank transfer" }, operationId: randomUUID() };
    const d = createDemand(db, "buyer", body, demandTestMarket());
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 300_001);
    changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: { ...demandTestTerms(), amount: "2000" } }, demandTestMarket());
    const checkEligibility = vi.fn(() => { throw new Error("Must not check new-publication eligibility on retry"); });
    expect(createDemand(db, "buyer", body, demandTestMarket(3.2, 120_001), checkEligibility)).toMatchObject({ id: d.id, amount: "2000", city: "", revision: 2 });
    expect(checkEligibility).not.toHaveBeenCalled();
    expect(() => createDemand(db, "buyer", { ...body, terms: { ...body.terms, amount: "2000" } }, demandTestMarket())).toThrow(/key/);
  });
  it("retains accepted response and trade history when a cancelled trade is manually reopened", () => {
    const d = publish(); const o = offer(d.id);
    const trade = { id: "cancelled-match", buyerId: "buyer", sellerId: "seller", listingId: o.listingId, status: "cancelled", usdtAmount: d.amount, pricePerUsdt: o.price, feePolicyVersion: "buyer_seller_1pct_v1" } as PurchaseRequest;
    const input = { buyerId: "buyer", demandId: d.id, offerId: o.id, revision: d.revision, listingId: o.listingId, amount: d.amount, paymentMethod: d.paymentMethod, network: d.network };
    commitDemandMatch(db, input, demandTestMarket(), trade); db.purchaseRequests.push(trade);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 300_001);
    changeDemand(db, "buyer", d.id, { action: "renew", revision: 1, terms: demandTestTerms() }, demandTestMarket());
    expect(d).toMatchObject({ state: "open", revision: 2 });
    expect(d.purchaseRequestId).toBeUndefined(); expect(d.acceptedOfferId).toBeUndefined();
    expect(o.state).toBe("accepted");
    expect(d.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "matched", revision: 1, purchaseRequestId: trade.id, offerId: o.id }),
      expect.objectContaining({ action: "renewed", revision: 2, purchaseRequestId: trade.id, offerId: o.id }),
    ]));
    expect(readDemandWorkspace(db, "buyer", demandTestMarket(), { id: d.id }).requests[0].offers[0].available).toBe(false);
  });
  it("enforces the five-publication rolling limit across manual renewals", () => {
    const d = publish(); vi.useFakeTimers();
    for (let i = 0; i < 4; i += 1) {
      vi.setSystemTime(Date.now() + 300_001);
      changeDemand(db, "buyer", d.id, { action: "renew", revision: d.revision, terms: demandTestTerms() }, demandTestMarket());
    }
    vi.setSystemTime(Date.now() + 300_001);
    expect(() => changeDemand(db, "buyer", d.id, { action: "renew", revision: d.revision, terms: demandTestTerms() }, demandTestMarket())).toThrow(/five requests per day/);
  });
});

describe("seller responses and privacy", () => {
  it("hides identities, rival responses and matched trade identifiers", () => {
    const d = publish(); const first = offer(d.id); offer(d.id, "seller-two");
    const view = readDemandWorkspace(db, "seller", demandTestMarket(), { id: d.id });
    expect(view.requests[0].offers).toHaveLength(1);
    expect(JSON.stringify(view)).not.toMatch(/example.test|Private buyer|requesterId|passwordHash|phoneVerifiedAt/);
    d.state = "matched"; d.acceptedOfferId = first.id; d.purchaseRequestId = "private-trade";
    expect(readDemandWorkspace(db, "seller-two", demandTestMarket(), { id: d.id }).requests[0].purchaseRequestId).toBeUndefined();
  });
  it("only allows approved compatible listings and available stock", () => {
    const d = publish(); const listing = db.marketplaceListings[0]; listing.status = "draft"; expect(() => offer(d.id)).toThrow();
    listing.status = "active"; listing.network = "BEP20"; expect(() => offer(d.id)).toThrow();
    listing.network = "TRC20"; listing.availableAmount = "999"; expect(() => offer(d.id)).toThrow();
    listing.availableAmount = "10000"; listing.minimumTrade = "2000"; expect(() => offer(d.id)).toThrow();
  });
  it("withdraws own response and invalidates responses after listing edits", () => {
    const d = publish(); const o = offer(d.id);
    db.marketplaceListings[0].updatedAt = new Date(Date.now() + 1).toISOString();
    expect(readDemandWorkspace(db, "buyer", demandTestMarket(), { id: d.id }).requests[0].offers[0].available).toBe(false);
    expect(() => withdrawDemandOffer(db, "seller-two", d.id, o.id)).toThrow();
    withdrawDemandOffer(db, "seller", d.id, o.id); expect(o.state).toBe("withdrawn");
  });
  it("enforces full amount, method, network and ownership on match", () => {
    const d = publish(); const o = offer(d.id);
    const input = { buyerId: "buyer", demandId: d.id, offerId: o.id, revision: 1, listingId: o.listingId, amount: d.amount, paymentMethod: d.paymentMethod, network: d.network };
    expect(validateDemandMatch(db, input, demandTestMarket()).offer.id).toBe(o.id);
    for (const patch of [{ amount: "999" }, { network: "BEP20" }, { paymentMethod: "Cardless ATM Withdrawal" }, { buyerId: "buyer-two" }, { revision: 2 }]) expect(() => validateDemandMatch(db, { ...input, ...patch }, demandTestMarket())).toThrow();
  });
  it("counts demand matches against inventory and seller capacity", () => {
    const d = publish(); db.purchaseRequests = Array.from({ length: 3 }, (_, i) => ({ id: String(i), sellerId: "seller", listingId: "listing-seller", usdtAmount: "1000", status: "pending", usdtDemandId: String(i) } as PurchaseRequest));
    expect(() => assertDemandListing(db, d, db.marketplaceListings[0])).toThrow(/three/);
    db.purchaseRequests = db.purchaseRequests.slice(0, 1); db.purchaseRequests[0].usdtAmount = "9500";
    expect(() => assertDemandListing(db, d, db.marketplaceListings[0])).toThrow(/amount/);
  });
  it("matches face-to-face requests only to the seller's normalized meeting city, including at acceptance", () => {
    const terms = { ...demandTestTerms(), paymentMethod: "Face-to-Face (Meet in Person)" as const, city: "  HaIfA  " };
    const d = createDemand(db, "buyer", { terms, operationId: randomUUID() }, demandTestMarket());
    const listing = db.marketplaceListings[0]; listing.paymentMethod = terms.paymentMethod; listing.paymentMethods = [terms.paymentMethod];
    const seller = db.users.find(u => u.id === "seller")!; seller.city = "Tel Aviv";
    expect(() => offer(d.id)).toThrow(/matching/);
    seller.city = "Haifa"; const o = offer(d.id);
    seller.city = "Jerusalem";
    expect(() => validateDemandMatch(db, { buyerId: "buyer", demandId: d.id, offerId: o.id, revision: 1, listingId: o.listingId, amount: d.amount, paymentMethod: d.paymentMethod, network: d.network }, demandTestMarket())).toThrow(/matching/);
    expect(readDemandWorkspace(db, "seller", demandTestMarket(), { id: d.id }).listings).toHaveLength(0);
  });
});

describe("canonical trade integration", () => {
  async function prepare() {
    const d = await publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() });
    const o = await offerDemand("seller", d.id, { listingId: "listing-seller", revision: d.revision, price: "3.10", operationId: randomUUID() });
    return { d, o, input: { buyerId: "buyer", actorUserId: "buyer", buyerName: "Private buyer", listingId: "listing-seller", usdtAmount: "1000", buyerReceivingWalletAddress: DEMAND_TEST_WALLET,
      receivingNetwork: "TRC20", paymentMethod: "Bank Transfer", feePolicyVersion: "buyer_seller_1pct_v1" as const, usdtDemandId: d.id, usdtDemandOfferId: o.id, usdtDemandRevision: d.revision } };
  }
  it("persists one matched demand and one trade at the agreed price incl. 1%", async () => {
    const { input } = await prepare();
    const first = await createPurchaseRequest(input); const retry = await createPurchaseRequest(input);
    expect(first.request).toMatchObject({ pricePerUsdt: "3.10", fiatAmount: "3131.00", status: "pending", usdtDemandId: input.usdtDemandId });
    expect(retry.request.id).toBe(first.request.id); expect(retry.replayed).toBe(true);
    const stored = await (await getAlphaExchangeRepository()).loadSnapshot();
    expect(stored.purchaseRequests).toHaveLength(1); expect(stored.usdtDemands?.[0]).toMatchObject({ state: "matched", purchaseRequestId: first.request.id });
    expect(stored.usdtDemands?.[0].offers[0].state).toBe("accepted");
  });
  it("allows only one winner for simultaneous accept taps", async () => {
    const { input } = await prepare();
    const results = await Promise.allSettled([createPurchaseRequest(input), createPurchaseRequest(input)]);
    expect(results.filter(r => r.status === "fulfilled").length).toBeGreaterThan(0);
    const stored = await (await getAlphaExchangeRepository()).loadSnapshot();
    expect(stored.purchaseRequests).toHaveLength(1); expect(stored.usdtDemands?.[0].offers.filter(o => o.state === "accepted")).toHaveLength(1);
  });
  it("replays a published request after its trade was created while blocking a new publication", async () => {
    const { d, input } = await prepare(); await createPurchaseRequest(input);
    const retry = await publishDemand("buyer", { terms: demandTestTerms(), operationId: d.operationId });
    expect(retry).toMatchObject({ id: d.id, state: "matched" });
    await expect(publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() })).rejects.toThrow(/current trade/);
    const stored = await (await getAlphaExchangeRepository()).loadSnapshot();
    expect(stored.usdtDemands).toHaveLength(1); expect(stored.purchaseRequests).toHaveLength(1);
  });
  it("persists only one trade when competing seller responses are accepted simultaneously", async () => {
    const { d, input } = await prepare();
    const other = await offerDemand("seller-two", d.id, { listingId: "listing-seller-two", revision: d.revision, price: "3.15", operationId: randomUUID() });
    const outcomes = await Promise.allSettled([createPurchaseRequest(input), createPurchaseRequest({ ...input, listingId: other.listingId, usdtDemandOfferId: other.id })]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    const stored = await (await getAlphaExchangeRepository()).loadSnapshot();
    expect(stored.purchaseRequests).toHaveLength(1); expect(stored.usdtDemands?.[0].offers.filter(o => o.state === "accepted")).toHaveLength(1);
    expect(stored.usdtDemands?.[0].purchaseRequestId).toBe(stored.purchaseRequests[0].id);
  });
  it("blocks ordinary purchase flow when a demand trade is already pending", async () => {
    const { input } = await prepare(); await createPurchaseRequest(input);
    await expect(createPurchaseRequest({ ...input, listingId: "listing-seller-two", usdtDemandId: undefined, usdtDemandOfferId: undefined, usdtDemandRevision: undefined })).rejects.toThrow(/active trade/);
  });
  it("rejects a disabled feature before storing anything", async () => {
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0");
    await expect(publishDemand("buyer", { terms: demandTestTerms(), operationId: randomUUID() })).rejects.toThrow(/unavailable/);
    expect(globalThis.__alphaExchangeMemorySnapshot?.usdtDemands).toHaveLength(0);
  });
});
