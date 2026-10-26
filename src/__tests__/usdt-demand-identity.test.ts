// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest, SellerReputationSnapshot } from "@/types/alpha-exchange";
import { demandTestDb, demandTestMarket, demandTestTerms, demandTestUser } from "@/test-utils/usdt-demand-fixtures";
import { demandIdentityProjector } from "@/lib/usdt-demand-identity";
import { publicAccountId } from "@/lib/public-account-identity";
import * as profileRoutes from "@/lib/public-account-username";
import * as trust from "@/lib/trust-engine";
import { createDemand, readDemandWorkspace, respondToDemand } from "@/lib/usdt-demand-engine";
import { getAccountProfileData, getPremiumSellerProfile, getPublicUserProfileRouteData, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/user-presence-store", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/user-presence-store")>(), readUserPresence: async () => ({}) }));
let db = demandTestDb();
const identity = (subject = "buyer", viewer = "seller") => demandIdentityProjector(db, viewer)(subject);
function purchase(buyerId: string, sellerId: string, status: PurchaseRequest["status"], amount = "1000", completedAt?: string): PurchaseRequest {
  const at = new Date().toISOString();
  return { id: randomUUID(), buyerId, sellerId, listingId: `listing-${sellerId}`, status, usdtAmount: amount, pricePerUsdt: "3.20",
    fiatAmount: "3200.00", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", timeline: [], createdAt: at, updatedAt: at, completedAt } as unknown as PurchaseRequest;
}
function install() {
  globalThis.__alphaExchangeMemorySnapshot = structuredClone(db);
  globalThis.__alphaExchangeRepositoryPromise = undefined;
  globalThis.__alphaExchangeMemoryEvidenceContent = new Map();
  invalidateAlphaExchangeStoreCache();
}
beforeEach(() => {
  db = demandTestDb(); vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0"); install();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); invalidateAlphaExchangeStoreCache(); });

describe("request counterparty public facts", () => {
  it("uses an explicit allowlist identical to the member public-profile identity", async () => {
    Object.assign(db.users[0], { fullName: "Private Real Name", buyerDisplayName: "Private Alias", email: "private@example.test", passwordHash: "secret-hash", verifiedPhone: "+972501234567", phoneOtpHash: "private-otp" });
    install();
    const projected = identity();
    const profile = await getPublicUserProfileRouteData({ username: profileRoutes.publicAccountUsername("buyer"), viewerUserId: "seller" });
    expect(projected).toEqual({ displayName: profile?.profile.publicTradingName, accountId: publicAccountId({ id: "buyer" }),
      profileHref: `/u/${profile?.profile.username}`, approvedSeller: false, sellerRank: null, completedPurchases: 0,
      buyerProgress: { rank: "bronze", nextRank: "silver", progressPercent: 0 } });
    expect(Object.keys(projected).sort()).toEqual(["accountId", "approvedSeller", "completedPurchases", "displayName", "profileHref", "sellerRank", "buyerProgress"].sort());
    expect(JSON.stringify(projected)).not.toMatch(/Private Real Name|Private Alias|private@example|secret-hash|972501234567|private-otp|password|email|phone|bank|userId/);
  });

  it("counts actual completed purchases and excludes sales, pending and cancelled trades", async () => {
    const at = new Date().toISOString();
    db.purchaseRequests.push(purchase("buyer", "seller", "completed"), purchase("buyer", "seller", "review_open", "1000", at),
      purchase("buyer", "seller", "locked", "1000", at), purchase("buyer", "seller", "pending"), purchase("buyer", "seller", "cancelled"),
      purchase("buyer", "seller", "declined"), purchase("buyer-two", "buyer", "completed"), purchase("buyer-two", "seller", "completed"));
    install();
    const profile = await getPublicUserProfileRouteData({ username: profileRoutes.publicAccountUsername("buyer"), viewerUserId: "seller" });
    expect(identity().completedPurchases).toBe(3);
    expect(identity().completedPurchases).toBe(profile?.stats?.completedAsBuyer);
    expect(identity().buyerProgress).toEqual({ rank: "bronze", nextRank: "silver", progressPercent: 20 });
  });

  it.each([
    ["0", "bronze", "silver", 0],
    ["14999.99", "bronze", "silver", 100],
    ["15000", "silver", "gold", 0],
    ["22500", "silver", "gold", 21.43],
    ["50000", "gold", "diamond", 0],
    ["52500", "gold", "diamond", 2.5],
    ["150000", "diamond", "elite", 0],
    ["325000", "diamond", "elite", 50],
    ["500000", "elite", null, 100],
    ["750000", "elite", null, 100],
  ] as const)("uses canonical buyer tiers for %s USDT of completed purchases", (volume, rank, nextRank, progressPercent) => {
    if (volume !== "0") db.purchaseRequests.push(purchase("buyer", "seller", "completed", volume));
    expect(identity().buyerProgress).toEqual({ rank, nextRank, progressPercent });
  });

  it.each(["buyer", "seller"])("matches %s account buyer progress using purchase evidence, never seller prestige", async userId => {
    const user = db.users.find(row => row.id === userId)!;
    Object.assign(user, { sellerPrestigeRank: "elite", lifetimeCompletedVolumeUsdt: 500000 });
    const counterpartyId = userId === "seller" ? "seller-two" : "seller";
    db.purchaseRequests.push(purchase(userId, counterpartyId, "completed", "20000"),
      purchase(userId, counterpartyId, "review_open", "2500", new Date().toISOString()),
      purchase("buyer-two", userId, "completed", "500000"));
    install();
    const account = await getAccountProfileData(userId);
    const activity = account.stats.kind === "seller" ? account.stats.buyerActivity : account.stats;
    const projected = identity(userId, userId === "buyer" ? "seller" : "buyer");
    expect(projected.completedPurchases).toBe(2);
    expect(projected.buyerProgress).toEqual({ rank: "silver", nextRank: "gold", progressPercent: 21.43 });
    expect(projected.buyerProgress).toEqual({ rank: activity.buyerLevel, nextRank: activity.nextLevel, progressPercent: activity.progressToNextLevelPercent });
    expect(JSON.stringify(projected)).not.toMatch(/lifetimeCompletedVolumeUsdt|requiredVolumeUsdt|remainingVolumeUsdt|buyerId|sellerId|reviewsGiven|activeTrades/);
  });

  it("does not turn unfinished review, locked, cancelled, or pending outcomes into purchase progress", () => {
    for (const status of ["review_open", "locked", "cancelled", "pending", "declined"] as const) db.purchaseRequests.push(purchase("buyer", "seller", status, "500000"));
    expect(identity()).toMatchObject({ completedPurchases: 0, buyerProgress: { rank: "bronze", nextRank: "silver", progressPercent: 0 } });
  });

  it("keeps completed purchase count while rejecting malformed or negative volume from rank arithmetic", () => {
    for (const amount of ["-500000", "NaN", "Infinity", "bad", "0"]) db.purchaseRequests.push(purchase("buyer", "seller", "completed", amount));
    db.purchaseRequests.push(purchase("buyer", "seller", "completed", "15000"));
    expect(identity()).toMatchObject({ completedPurchases: 6, buyerProgress: { rank: "silver", nextRank: "gold", progressPercent: 0 } });
  });

  it("rounds summed completed purchase volume consistently with the account buyer profile", async () => {
    db.purchaseRequests.push(purchase("buyer", "seller", "completed", "14999.994"), purchase("buyer", "seller", "completed", "0.002"));
    install();
    const account = await getAccountProfileData("buyer");
    expect(account.stats.kind).toBe("buyer");
    expect(account.stats).toMatchObject({ buyerLevel: "silver", lifetimeCompletedVolumeUsdt: 15000 });
    expect(identity().buyerProgress).toEqual({ rank: "silver", nextRank: "gold", progressPercent: 0 });
  });

  it("matches the real seller profile rank from completed outcomes", async () => {
    db.purchaseRequests.push(purchase("buyer", "seller", "completed", "50000"), purchase("buyer-two", "seller", "cancelled", "500000"));
    db.trustSnapshots.push({ sellerId: "seller", updatedAt: new Date().toISOString(), snapshot: { sellerId: "seller", level: "elite", totalUsdtVolume: 900000 } as SellerReputationSnapshot });
    install();
    const profile = await getPremiumSellerProfile({ sellerId: "seller", viewerUserId: "buyer" });
    expect(identity("seller", "buyer")).toMatchObject({ approvedSeller: true, sellerRank: "gold" });
    expect(identity("seller", "buyer").sellerRank).toBe(profile?.sellerLevel);
  });

  it("preserves canonical lifetime volume, earned floor and explicit owner rank overrides", () => {
    const seller = db.users.find(user => user.id === "seller")!;
    seller.lifetimeCompletedVolumeUsdt = 150000;
    expect(identity("seller", "buyer").sellerRank).toBe("diamond");
    seller.lifetimeCompletedVolumeUsdt = 0; seller.sellerPrestigeRank = "gold";
    expect(identity("seller", "buyer").sellerRank).toBe("gold");
    seller.sellerRankOverride = { rank: "silver", reason: "Private operator reason", setAt: new Date().toISOString(), setByUserId: "private-admin" };
    expect(identity("seller", "buyer").sellerRank).toBe("silver");
    expect(JSON.stringify(identity("seller", "buyer"))).not.toMatch(/Private operator|private-admin|lifetime|Volume/);
  });

  it.each(["buyer", "pending_seller", "suspended", "rejected"])("does not invent an approval badge or seller rank for status %s", status => {
    Object.assign(db.users[0], { role: "approved_seller", roles: ["approved_seller"], sellerStatus: status, sellerPrestigeRank: "elite" });
    expect(identity()).toMatchObject({ approvedSeller: false, sellerRank: null });
  });

  it("does not convert administrative access into seller approval", () => {
    Object.assign(db.users[0], { role: "admin", roles: ["admin"], sellerStatus: "buyer" });
    expect(identity()).toMatchObject({ approvedSeller: false, sellerRank: null });
  });

  it("omits private purchase statistics rather than turning them into a misleading zero", async () => {
    db.users[0].showTradeStats = false; db.purchaseRequests.push(purchase("buyer", "seller", "completed")); install();
    const profile = await getPublicUserProfileRouteData({ username: profileRoutes.publicAccountUsername("buyer"), viewerUserId: "seller" });
    expect(profile?.stats).toBeNull(); expect(identity().completedPurchases).toBeNull(); expect(identity().buyerProgress).toBeNull();
    expect(identity("buyer", "buyer").completedPurchases).toBe(1);
    expect(identity("buyer", "buyer").buyerProgress).toEqual({ rank: "bronze", nextRank: "silver", progressPercent: 6.67 });
  });

  it("respects an approved seller's purchase-statistics privacy while keeping their public seller badge", () => {
    const seller = db.users.find(user => user.id === "seller")!;
    seller.showTradeStats = false;
    db.purchaseRequests.push(purchase("seller", "seller-two", "completed", "52500"));
    expect(identity("seller", "buyer")).toMatchObject({ approvedSeller: true, sellerRank: "bronze", completedPurchases: null, buyerProgress: null });
    expect(identity("seller", "seller").buyerProgress).toEqual({ rank: "gold", nextRank: "diamond", progressPercent: 2.5 });
  });

  it.each(["isProfileHidden", "allowProfileSearch"] as const)("does not produce a dead public-profile link when %s restricts access", setting => {
    db.users[0][setting] = setting === "isProfileHidden";
    expect(identity()).toMatchObject({ profileHref: null, completedPurchases: null, buyerProgress: null, approvedSeller: false, sellerRank: null });
    expect(identity("buyer", "buyer").profileHref).toBe(`/u/${profileRoutes.publicAccountUsername("buyer")}`);
  });

  it.each(["subject", "viewer"])("respects a block from the %s when showing historical offers", side => {
    const buyer = db.users.find(user => user.id === "buyer")!; const seller = db.users.find(user => user.id === "seller")!;
    if (side === "subject") seller.blockedUserIds = [buyer.id]; else buyer.blockedUserIds = [seller.id];
    expect(identity("seller", "buyer")).toMatchObject({ profileHref: null, completedPurchases: null, buyerProgress: null, approvedSeller: false, sellerRank: null });
  });

  it.each(["deleted", "disabled"])("does not invent profile facts for a %s account", state => {
    if (state === "deleted") db.users = db.users.filter(user => user.id !== "seller"); else db.users.find(user => user.id === "seller")!.disabled = true;
    expect(identity("seller", "buyer")).toMatchObject({ accountId: publicAccountId({ id: "seller" }), profileHref: null, approvedSeller: false, sellerRank: null, completedPurchases: null, buyerProgress: null });
  });

  it("fails closed instead of linking to the first account with a colliding route key", () => {
    vi.spyOn(profileRoutes, "publicAccountUsername").mockReturnValue("seller-collision");
    expect(identity("seller", "buyer").profileHref).toBeNull();
  });

  it("joins canonical IDs even when two dashboard AT labels collide", () => {
    const first = demandTestUser("buyer-Aa"), second = demandTestUser("buyer-BB");
    expect(publicAccountId(first)).toBe(publicAccountId(second));
    db.users.push(first, second); db.purchaseRequests.push(purchase(first.id, "seller", "completed"));
    const project = demandIdentityProjector(db, "seller");
    expect(project(first.id).completedPurchases).toBe(1); expect(project(second.id).completedPurchases).toBe(0);
    expect(project(first.id).buyerProgress?.progressPercent).toBe(6.67); expect(project(second.id).buyerProgress?.progressPercent).toBe(0);
    expect(project(first.id).profileHref).not.toBe(project(second.id).profileHref);
  });

  it("projects the actual requester and each visible responding seller, without leaking competing responses", () => {
    const d = createDemand(db, "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket());
    for (const seller of ["seller", "seller-two"]) respondToDemand(db, seller, d.id, { listingId: `listing-${seller}`, price: "3.20", revision: 1, operationId: randomUUID() }, demandTestMarket());
    const buyerView = readDemandWorkspace(db, "buyer", demandTestMarket(), { id: d.id }).requests[0];
    expect(buyerView.requester?.accountId).toBe(publicAccountId({ id: "buyer" }));
    expect(buyerView.requester?.buyerProgress).toEqual({ rank: "bronze", nextRank: "silver", progressPercent: 0 });
    expect(buyerView.offers.map(offer => offer.seller?.accountId)).toEqual(["seller", "seller-two"].map(id => publicAccountId({ id })));
    expect(buyerView.offers.every(offer => offer.seller?.buyerProgress?.rank === "bronze")).toBe(true);
    const sellerView = readDemandWorkspace(db, "seller", demandTestMarket(), { id: d.id }).requests[0];
    expect(sellerView.offers).toHaveLength(1); expect(sellerView.offers[0].seller?.accountId).toBe(publicAccountId({ id: "seller" }));
    const wire = JSON.stringify(buyerView);
    for (const user of db.users) expect(wire).not.toContain(user.fullName);
    expect(wire).not.toMatch(/passwordHash|whatsappNumber|sellerBankAccounts|accountNumber|blockedUserIds|sellerRankOverride|email/);
  });

  it("reuses each projected identity once per workspace read", () => {
    const calculate = vi.spyOn(trust, "calculateSellerTrustSnapshot"); const project = demandIdentityProjector(db, "buyer");
    const first = project("seller");
    for (let index = 0; index < 100; index++) expect(project("seller")).toBe(first);
    expect(calculate).toHaveBeenCalledTimes(1);
  });
});
