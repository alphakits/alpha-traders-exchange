// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import * as repositoryModule from "@/lib/alpha-exchange-repository";
import { getFirstActionableTradeForUser, getMarketplaceListings, getMyPurchaseRequests, getNotificationsForUser, getSellerListingWorkspaceData, getTradeRoomData, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import * as presenceModule from "@/lib/user-presence-store";
import { publicAccountId } from "@/lib/public-account-identity";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "@/lib/alpha-exchange-identity";
import { getSnapshotIdentityUsers } from "@/lib/alpha-exchange-identity-directory";

const now = "2026-10-20T00:00:00.000Z";
const member = { id: "unrelated-member", fullName: "Maya Chen", buyerDisplayName: "Maya OTC", role: "buyer", passwordHash: "private-password", sellerBankAccounts: [{ accountNumber: "private-bank" }] };
const request = {
  id: "target", tradeId: "TR-TARGET", listingId: "listing", buyerId: "buyer", sellerId: "seller", buyerName: "Trade Buyer",
  displayNumber: 1, status: "accepted", paymentMethod: "Bank Transfer", usdtAmount: "100", pricePerUsdt: "3.2", fiatAmount: "320", currency: "ILS", network: "TRC20", createdAt: now, updatedAt: now,
  timeline: [{ id: "event", type: "payment_sent", message: "Maya Chen paid 320 ILS", createdAt: now }],
  messages: [{ id: "message", kind: "user", senderUserId: "seller", senderRole: "approved_seller", message: "Maya OTC confirmed payment", createdAt: now, readByUserIds: [] }],
};
const notification = { id: "notice", userId: "buyer", category: "system", type: "system_notice", title: "Maya Chen update", message: "Maya OTC confirmed payment", isRead: false, state: "unread", createdAt: now };
const activity = { id: "activity", userId: "buyer", title: "Maya Chen update", details: "Maya OTC confirmed payment", createdAt: now };
const listing = { id: "listing", sellerId: "seller", sellerDisplayName: "Trade Seller", originalAmount: "500", availableAmount: "400", price: "3.2", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", minimumTrade: "50", maximumTrade: "500", status: "active", approvalStatus: "approved", notes: "Maya Chen trading notes", sellerDescription: "Maya OTC trading desk", createdAt: now, updatedAt: now };
const fixture = {
  users: [{ id: "buyer", role: "buyer", fullName: "Trade Buyer" }, { id: "seller", role: "approved_seller", sellerStatus: "approved_seller", fullName: "Trade Seller", bio: "Maya Chen trading partner", tradingExperience: "Maya OTC trading desk" }, member],
  purchaseRequests: [request], marketplaceListings: [listing], notifications: [notification], activityLog: [activity],
  sellerApplications: [], commissionRecords: [], disputes: [], trustSnapshots: [], tradeEvidenceFiles: [], auditLogs: [],
  authSessions: [], passwordResetTokens: [], sellerReports: [], trustScoreHistory: [], privateBetaInvites: [], privateBetaInviteUses: [],
  betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
} as unknown as AlphaExchangeDb;

const db = new PGlite();
const query = vi.fn((sql: string, values?: unknown[]) => db.query(sql, values));
const sqlRepository = new repositoryModule.AlphaExchangeRepository({ query } as unknown as Pool);
const memoryRepository = new repositoryModule.AlphaExchangeRepository(null);
vi.spyOn(sqlRepository, "ensureReady").mockResolvedValue();
vi.spyOn(memoryRepository, "ensureReady").mockResolvedValue();

beforeAll(async () => {
  await db.exec(`create schema alpha_exchange;
    create table alpha_exchange.runtime_meta (singleton boolean, version bigint);
    insert into alpha_exchange.runtime_meta values (true, 1);
    create table alpha_exchange.users (id text, sort_index int, payload jsonb);
    create table alpha_exchange.listings (id text, seller_id text, status text, sort_index int, payload jsonb);
    create table alpha_exchange.purchase_requests (id text, trade_id text, listing_id text, buyer_id text, seller_id text, status text, updated_at timestamptz, sort_index int, payload jsonb);
    create table alpha_exchange.evidence (purchase_request_id text, sort_index int, payload jsonb);
    create table alpha_exchange.notifications (user_id text, sort_index int, payload jsonb);
    create table alpha_exchange.activity_logs (user_id text, sort_index int, payload jsonb);
    create table alpha_exchange.seller_applications (id text, user_id text, sort_index int, payload jsonb);
    create table alpha_exchange.commissions (seller_id text, buyer_id text, purchase_request_id text, payment_status text, sort_index int, payload jsonb);
    create table alpha_exchange.disputes (buyer_id text, seller_id text, purchase_request_id text, sort_index int, payload jsonb);
    create table alpha_exchange.trust_snapshots (seller_id text, sort_index int, payload jsonb);
    create table alpha_exchange.audit_logs (purchase_request_id text, target_user_id text, sort_index int, created_at timestamptz, payload jsonb);
    create table alpha_exchange.marketplace_enforcement_records (seller_id text, sort_index int, payload jsonb);
    create table alpha_exchange.marketplace_enforcement_audit_log (seller_id text, sort_index int, payload jsonb);`);
  for (const [index, account] of fixture.users.entries()) {
    await db.query("insert into alpha_exchange.users values ($1,$2,$3)", [account.id, index, account]);
  }
  await db.query("insert into alpha_exchange.purchase_requests values ($1,$2,$3,$4,$5,$6,$7,1,$8)",
    [request.id, request.tradeId, request.listingId, request.buyerId, request.sellerId, request.status, now, request]);
  await db.query("insert into alpha_exchange.listings values ('listing','seller','active',1,$1)", [listing]);
  await db.query("insert into alpha_exchange.notifications values ('buyer',1,$1)", [notification]);
  await db.query("insert into alpha_exchange.activity_logs values ('buyer',1,$1)", [activity]);
});
afterAll(async () => { await db.close(); });
afterEach(() => {
  vi.mocked(repositoryModule.getAlphaExchangeRepository).mockRestore?.();
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  invalidateAlphaExchangeStoreCache();
});

describe.each(["PostgreSQL", "memory"] as const)("%s scoped response privacy", backend => {
  async function install() {
    globalThis.__alphaExchangeMemorySnapshot = structuredClone(fixture) as never;
    invalidateAlphaExchangeStoreCache();
    query.mockClear();
    vi.spyOn(repositoryModule, "getAlphaExchangeRepository").mockResolvedValue(backend === "PostgreSQL" ? sqlRepository : memoryRepository);
  }

  it("masks unrelated identities in purchase-request history", async () => {
    await install();
    const [result] = await getMyPurchaseRequests("buyer", "buyer");
    expect(result.timeline[0].message).toBe(`${publicAccountId(member)} paid 320 ILS`);
    expect(result.messages?.[0].message).toBe(`${publicAccountId(member)} confirmed payment`);
    if (backend === "PostgreSQL") expect(query).toHaveBeenCalledTimes(1);
  });

  it("masks unrelated identities in the actionable trade candidate", async () => {
    await install();
    const result = await getFirstActionableTradeForUser("buyer", "buyer");
    expect(result?.timeline[0].message).toBe(`${publicAccountId(member)} paid 320 ILS`);
    expect(result?.messages?.[0].message).toBe(`${publicAccountId(member)} confirmed payment`);
    if (backend === "PostgreSQL") expect(query).toHaveBeenCalledTimes(1);
  });

  it("masks both nested request and direct Trade Room messages", async () => {
    await install();
    const result = await getTradeRoomData({ purchaseRequestId: "target", actorUserId: "buyer", actorRole: "buyer", strongConsistency: true, markMessagesRead: false });
    expect(result.request.timeline[0].message).toBe(`${publicAccountId(member)} paid 320 ILS`);
    expect(result.messages[0].message).toBe(`${publicAccountId(member)} confirmed payment`);
    expect(result.listing?.notes).toBe(`${publicAccountId(member)} trading notes`);
    expect(result.listing?.sellerDescription).toBe(`${publicAccountId(member)} trading desk`);
    expect(result.listing?.sellerProfile?.bio).toBe(`${publicAccountId(member)} trading partner`);
    if (backend === "PostgreSQL") expect(query).toHaveBeenCalledTimes(1);
  });

  it("masks unrelated notification and activity identities", async () => {
    await install();
    const result = await getNotificationsForUser({ userId: "buyer", includeActivity: true });
    expect(result.notifications[0].title).toBe(`${publicAccountId(member)} update`);
    expect(result.notifications[0].message).toBe(`${publicAccountId(member)} confirmed payment`);
    expect(result.activity[0].title).toBe(`${publicAccountId(member)} update`);
    expect(result.activity[0].details).toBe(`${publicAccountId(member)} confirmed payment`);
    if (backend === "PostgreSQL") expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("preserves marketplace listing/profile masking through the presence clone (outage=%s)", async outage => {
    await install();
    const presence = vi.spyOn(presenceModule, "readUserPresence");
    if (outage) presence.mockRejectedValue(new Error("presence unavailable"));
    else presence.mockResolvedValue({});
    try {
      const [result] = await getMarketplaceListings("active", undefined, "buyer");
      expect(result?.notes).toBe(`${publicAccountId(member)} trading notes`);
      expect(result?.sellerDescription).toBe(`${publicAccountId(member)} trading desk`);
      expect(result?.sellerProfile?.bio).toBe(`${publicAccountId(member)} trading partner`);
      expect(result?.sellerProfile?.tradingExperience).toBe(`${publicAccountId(member)} trading desk`);
      if (backend === "PostgreSQL") expect(query).toHaveBeenCalledTimes(1);
    } finally { presence.mockRestore(); }
  });

  it("masks unrelated identities in the seller's listing workspace", async () => {
    await install();
    const result = await getSellerListingWorkspaceData({ sellerId: "seller" });
    expect(result.listings[0]?.notes).toBe(`${publicAccountId(member)} trading notes`);
    expect(result.listings[0]?.sellerDescription).toBe(`${publicAccountId(member)} trading desk`);
    expect(result.listings[0]?.sellerProfile?.bio).toBe(`${publicAccountId(member)} trading partner`);
    if (backend === "PostgreSQL") expect(query).toHaveBeenCalledTimes(1);
  });
});

it("preserves a legacy owner's public identity when their raw account is a Trade Room participant", async () => {
  const owner = { ...fixture.users[0], email: ` ${ALPHA_EXCHANGE_OWNER_EMAIL.toUpperCase()} `, fullName: "Legacy Owner" };
  const ownerRequest = { ...request, buyerName: "Legacy Owner", messages: [{ ...request.messages[0], message: "Legacy Owner and Maya Chen confirmed payment" }] };
  await db.query("update alpha_exchange.users set payload=$1 where id='buyer'", [owner]);
  await db.query("update alpha_exchange.purchase_requests set payload=$1 where id='target'", [ownerRequest]);
  vi.spyOn(repositoryModule, "getAlphaExchangeRepository").mockResolvedValue(sqlRepository);
  try {
    const result = await getTradeRoomData({ purchaseRequestId: "target", actorUserId: "seller", actorRole: "approved_seller", strongConsistency: true, markMessagesRead: false });
    expect(result.messages[0].message).toBe(`Legacy Owner and ${publicAccountId(member)} confirmed payment`);
    const snapshot = await sqlRepository.loadTradeRoomSnapshot(["target"], "seller");
    expect(snapshot?.users.find(user => user.id === "buyer")?.role).toBe("buyer");
    expect(snapshot?.users.some(user => user.id === member.id)).toBe(false);
    expect(JSON.stringify(snapshot)).not.toMatch(/private-password|private-bank/);
  } finally {
    await db.query("update alpha_exchange.users set payload=$1 where id='buyer'", [fixture.users[0]]);
    await db.query("update alpha_exchange.purchase_requests set payload=$1 where id='target'", [request]);
  }
});

it("skips the complete identity directory for empty history and candidate responses while retaining caller authority", async () => {
  const history = await sqlRepository.loadPurchaseRequestSnapshotForActor({ userId: "buyer", includeAll: false, requestId: "missing" });
  const candidate = await sqlRepository.loadPurchaseRequestCandidateSnapshotForActor({ userId: "buyer", includeAll: false, activeStatuses: ["completed"], includeBuyerPending: false });
  for (const snapshot of [history, candidate]) {
    expect(snapshot.purchaseRequests).toEqual([]);
    expect(snapshot.users.map(user => user.id)).toEqual(["buyer"]);
    expect(getSnapshotIdentityUsers(snapshot)).toEqual([]);
  }
});

it("isolates batched profile masking across owner views and in-place account renames", async () => {
  const snapshot = structuredClone(fixture);
  const owner = { ...snapshot.users[0], id: "owner-viewer", role: "owner" as const, fullName: "Platform Owner" };
  snapshot.users.push(owner);
  snapshot.marketplaceListings = [0, 1, 2].map(index => ({ ...listing, id: `listing-${index}` })) as AlphaExchangeDb["marketplaceListings"];
  const presence = vi.spyOn(presenceModule, "readUserPresence").mockResolvedValue({});
  try {
    const first = await getMarketplaceListings("active", snapshot, "buyer");
    expect(first).toHaveLength(3);
    for (const result of first) {
      expect(result.sellerProfile?.bio).toBe(`${publicAccountId(member)} trading partner`);
      expect(result.notes).toBe(`${publicAccountId(member)} trading notes`);
    }
    const ownerResults = await getMarketplaceListings("active", snapshot, owner.id);
    expect(ownerResults).toHaveLength(3);
    for (const result of ownerResults) expect(result.sellerProfile?.bio).toBe("Maya Chen trading partner");

    const renamed = snapshot.users.find(user => user.id === member.id)!;
    renamed.fullName = "Leila Haddad";
    renamed.buyerDisplayName = "Leila Desk";
    snapshot.users.find(user => user.id === "seller")!.bio = "Leila Haddad trading partner";
    snapshot.users.find(user => user.id === "seller")!.tradingExperience = "Leila Desk trading experience";
    for (const entry of snapshot.marketplaceListings) {
      entry.notes = "Leila Haddad trading notes";
      entry.sellerDescription = "Leila Desk trading partner";
    }
    const next = await getMarketplaceListings("active", snapshot, "buyer");
    expect(next).toHaveLength(3);
    for (const result of next) {
      expect(result.sellerProfile?.bio).toBe(`${publicAccountId(member)} trading partner`);
      expect(result.sellerProfile?.tradingExperience).toBe(`${publicAccountId(member)} trading experience`);
      expect(result.notes).toBe(`${publicAccountId(member)} trading notes`);
    }
    expect(JSON.stringify(next)).not.toMatch(/Maya Chen|Maya OTC|Leila Haddad|Leila Desk/);
  } finally { presence.mockRestore(); }
});
