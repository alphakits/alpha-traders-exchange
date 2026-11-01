// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { demandTestDb, demandTestUser, DEMAND_TEST_WALLET } from "@/test-utils/usdt-demand-fixtures";
import { getWiseUsdAccountFingerprint, createWiseUsdAccountSnapshot } from "@/lib/wise-bank-transfer";
import { createPurchaseRequest, getTradeRoomBankDetails, getWiseAccountReviewQueue, getWiseAccountsForUser,
  invalidateAlphaExchangeStoreCache, reviewWiseAccount, sanitizePurchaseRequestForActor, saveWiseAccount,
  updatePurchaseRequestStatus } from "@/lib/alpha-exchange-store";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import type { WiseUsdAccount } from "@/types/wise";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/market-service", () => ({ DEFAULT_USD_ILS_RATE: 3.05, getUsdtIlsReferenceRate: async () => 4 }));
let database: PGlite;
let repository: AlphaExchangeRepository;
const tables = ["users", "listings", "purchase_requests"] as const;
const currentKey = "synthetic-durable-wise-current-key-only";
const nextKey = "synthetic-durable-wise-next-key-only";
const queryTexts: string[] = [];

function account(userId: string): WiseUsdAccount {
  const now = new Date().toISOString();
  const details = { provider: "wise" as const, currency: "USD" as const, countryCode: "US" as const,
    accountHolderType: "personal" as const, accountHolderName: `Private ${userId}`, bankName: "Synthetic Bank",
    accountType: "checking" as const, routingNumber: "021000021", accountNumber: userId === "buyer" ? "00012345678" : "00087654321" };
  return { ...details, id: `wise-${userId}`, userId, createdAt: now, updatedAt: now, ownershipReview: {
    status: "manually_reviewed", method: "document_review", reviewedBy: "reviewer", reviewedAt: now,
    evidenceReference: "private-evidence-reference", verifiedAccountHolderName: details.accountHolderName,
    accountFingerprint: getWiseUsdAccountFingerprint(details),
  } };
}

beforeAll(async () => {
  database = await PGlite.create();
  await database.exec(await readFile("supabase/migrations/20260720160000_alpha_exchange_runtime.sql", "utf8"));
  await database.exec("create role anon; create role authenticated");
  await database.exec("insert into alpha_exchange.runtime_meta(singleton,version,updated_at) values(true,0,now()) on conflict(singleton) do nothing");
  const client = { query: (sql: string, values?: unknown[]) => { queryTexts.push(sql); return database.query(sql, values); }, release() {} };
  repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.stubEnv("NODE_ENV", "production");
  await repository.ensureReady();
  vi.unstubAllEnvs();
}, 30_000);

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", currentKey);
  vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET", "");
  vi.stubEnv("ALPHA_WISE_PAYMENTS_ENABLED", "1");
  vi.stubEnv("ALPHA_EXCHANGE_DATA_BACKEND", "postgres");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic@localhost/wise-storage-test");
  vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "0");
  await database.exec("truncate alpha_exchange.users cascade; update alpha_exchange.runtime_meta set version=0");
  const fixture = demandTestDb();
  const reviewer = demandTestUser("reviewer"); reviewer.role = "admin"; reviewer.roles = ["admin"];
  fixture.users.push(reviewer);
  for (const user of fixture.users) user.notificationPreferences = { inApp: false, email: false, sms: false };
  for (const user of fixture.users) if (["buyer", "seller"].includes(user.id)) user.wiseUsdAccounts = [account(user.id)];
  const now = new Date().toISOString();
  fixture.purchaseRequests.push({ id: "wise-trade", tradeId: "wise-trade", listingId: "listing-seller", sellerId: "seller", buyerId: "buyer",
    buyerName: "Private buyer", network: "TRC20",
    status: "accepted", createdAt: now, updatedAt: now, currency: "USD", paymentMethod: "Bank Transfer", bankTransferProvider: "wise",
    sellerWiseAccountSnapshot: createWiseUsdAccountSnapshot(account("seller")), buyerWiseAccountSnapshot: createWiseUsdAccountSnapshot(account("buyer")),
    messages: [], timeline: [], usdtAmount: "100", fiatAmount: "101.00",
  } as PurchaseRequest);
  await repository.saveSnapshot(fixture, { selectedTables: tables });
  globalThis.__alphaExchangeRepositoryPromise = Promise.resolve(repository);
  invalidateAlphaExchangeStoreCache();
  queryTexts.length = 0;
});
afterEach(() => { vi.unstubAllEnvs(); globalThis.__alphaExchangeRepositoryPromise = undefined; globalThis.__alphaExchangeMemorySnapshot = undefined; invalidateAlphaExchangeStoreCache(); });
afterAll(async () => { await database.close(); });

async function rawPayloads() {
  return (await database.query<{ payload: unknown }>("select payload from alpha_exchange.users union all select payload from alpha_exchange.purchase_requests")).rows;
}

describe("Wise encrypted PostgreSQL payload persistence", () => {
  it("opens and accepts a hosted Wise trade durably, then retains private instructions when new activity is disabled", async () => {
    const snapshot = await repository.loadSelectedSnapshot(tables);
    snapshot.purchaseRequests = [];
    const seller = snapshot.users.find(user => user.id === "seller")!;
    seller.sellerApprovalVerification = { method: "manual_authorized_reviewer_v1", identityDocumentReviewed: true,
      liveIdentityVideoReviewed: true, contactOwnershipConfirmed: true, marketplaceRulesAccepted: true,
      verifiedAt: new Date().toISOString(), verifiedByUserId: "reviewer" };
    Object.assign(snapshot.marketplaceListings[0], { bankTransferProvider: "wise", wiseAccountId: "wise-seller",
      bankAccountId: undefined, bankName: "Wise", currency: "USD", price: "1" });
    await repository.saveSnapshot(snapshot, { selectedTables: tables });
    invalidateAlphaExchangeStoreCache();
    const { request } = await createPurchaseRequest({ buyerId: "buyer", actorUserId: "buyer", listingId: "listing-seller",
      usdtAmount: "100", buyerName: "Private buyer", buyerReceivingWalletAddress: DEMAND_TEST_WALLET,
      receivingNetwork: "TRC20", paymentMethod: "Bank Transfer", bankTransferProvider: "wise", currency: "USD",
      buyerWiseAccountId: "wise-buyer", feePolicyVersion: "buyer_seller_1pct_v1" });
    expect(request.currency).toBe("USD");
    expect(request.fiatAmount).toBe("101.00");
    await updatePurchaseRequestStatus({ requestId: request.id, actorUserId: "seller", actorRole: "approved_seller", nextStatus: "accepted" });
    vi.stubEnv("ALPHA_WISE_PAYMENTS_ENABLED", "0");
    const instructions = await getTradeRoomBankDetails({ purchaseRequestId: request.id, actorUserId: "buyer", actorRole: "buyer" });
    expect(instructions.accountNumber).toBe("00087654321");
    expect(JSON.stringify(await rawPayloads())).not.toMatch(/00012345678|00087654321/);
    await expect(createPurchaseRequest({ buyerId: "buyer-two", actorUserId: "buyer-two", listingId: "listing-seller",
      usdtAmount: "100", buyerName: "Private buyer-two", buyerReceivingWalletAddress: DEMAND_TEST_WALLET,
      receivingNetwork: "TRC20", paymentMethod: "Bank Transfer", bankTransferProvider: "wise", currency: "USD",
      buyerWiseAccountId: "wise-buyer", feePolicyVersion: "buyer_seller_1pct_v1" })).rejects.toThrow(/unavailable/);
  });
  it("never substitutes stale local cache when encrypted durable data cannot be decrypted", async () => {
    const stale = await repository.loadSelectedSnapshot(tables);
    const session = { token: "synthetic-session", userId: "buyer", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    stale.authSessions = [session];
    globalThis.__alphaExchangeMemorySnapshot = stale;
    await database.query("insert into alpha_exchange.sessions(token_hash,user_id,expires_at,created_at,sort_index,payload) values($1,$2,$3,$4,0,$5::jsonb)",
      [session.token, session.userId, session.expiresAt, session.createdAt, JSON.stringify(session)]);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", "different-synthetic-key-with-no-previous-key");
    await expect(repository.loadSelectedSnapshot(tables)).rejects.toThrow("Private Wise storage is unavailable.");
    await expect(repository.loadSnapshot()).rejects.toThrow("Private Wise storage is unavailable.");
    await expect(repository.loadAuthenticatedSessionSnapshot(session.token)).rejects.toThrow("Private Wise storage is unavailable.");
    await expect(repository.loadSnapshotForListingCreation()).rejects.toThrow("Private Wise storage is unavailable.");
  });
  it("saves and reviews accounts through the hosted server capability with stale-version protection", async () => {
    const details = { ...account("buyer-two"), accountNumber: "00055555666" };
    const created = await saveWiseAccount({ actorUserId: "buyer-two", details });
    expect(created.ownershipReviewStatus).toBe("pending_review");
    const old = (await getWiseAccountReviewQueue("reviewer")).find(entry => entry.id === created.id)!;
    await saveWiseAccount({ actorUserId: "buyer-two", accountId: created.id, details: { ...details, bankName: "Changed Synthetic Bank" } });
    await expect(reviewWiseAccount({ actorUserId: "reviewer", userId: "buyer-two", accountId: created.id,
      expectedReviewVersion: old.reviewVersion, decision: "approve", evidenceReference: "private-durable-review-evidence",
      identityMatched: true, verifiedAccountHolderName: "Private buyer-two" })).rejects.toThrow(/changed/);
    const fresh = (await getWiseAccountReviewQueue("reviewer")).find(entry => entry.id === created.id)!;
    await reviewWiseAccount({ actorUserId: "reviewer", userId: "buyer-two", accountId: created.id,
      expectedReviewVersion: fresh.reviewVersion, decision: "approve", evidenceReference: "private-durable-review-evidence",
      identityMatched: true, verifiedAccountHolderName: "Private buyer-two" });
    expect((await getWiseAccountsForUser("buyer-two"))[0].ownershipReviewStatus).toBe("manually_reviewed");
    const raw = JSON.stringify(await rawPayloads());
    expect(raw).not.toMatch(/00055555666|private-durable-review-evidence/);
    vi.stubEnv("ALPHA_WISE_PAYMENTS_ENABLED", "0");
    await expect(saveWiseAccount({ actorUserId: "buyer-two", details })).rejects.toThrow(/unavailable/);
  });
  it("stores encrypted accounts/reviews/trade snapshots and roundtrips selected, auth, profile, and Trade Room reads", async () => {
    const raw = JSON.stringify(await rawPayloads());
    for (const secret of ["00012345678", "00087654321", "021000021", "private-evidence-reference", "accountFingerprint"]) expect(raw).not.toContain(secret);
    expect(raw).toContain("wise-data:v1:");
    const snapshots = [await repository.loadSelectedSnapshot(tables), await repository.loadAuthUserSnapshot({ userId: "buyer" }),
      await repository.loadAccountProfileSnapshotForUser("buyer"), await repository.loadTradeRoomSnapshot(["wise-trade"], "buyer")];
    for (const snapshot of snapshots) expect(snapshot?.users.find(user => user.id === "buyer")?.wiseUsdAccounts?.[0].accountNumber).toBe("00012345678");
    for (const snapshot of [snapshots[0], snapshots[2], snapshots[3]]) {
      expect(snapshot?.purchaseRequests[0].sellerWiseAccountSnapshot?.accountNumber).toBe("00087654321");
      const publicTrade = sanitizePurchaseRequestForActor(snapshot!.purchaseRequests[0], "buyer", "buyer");
      expect(JSON.stringify(publicTrade)).not.toMatch(/00087654321|00012345678|wise-data:v1/);
    }
  });
  it("keeps unchanged lifecycle commits free of writes despite randomized encryption", async () => {
    const before = JSON.stringify(await rawPayloads());
    const transaction = await repository.beginTradeLifecycleTransaction(tables);
    expect(transaction).not.toBeNull();
    await transaction!.commit(transaction!.snapshot, { selectedTables: ["purchase_requests"] });
    expect(queryTexts.filter(sql => /insert into alpha_exchange.purchase_requests|update alpha_exchange.runtime_meta/i.test(sql))).toEqual([]);
    expect(JSON.stringify(await rawPayloads())).toBe(before);
  });
  it("reads old-key data, writes changed trade snapshots with current key, and preserves untouched account ciphertext", async () => {
    const accountsBefore = (await database.query("select payload->'wiseUsdAccounts' as private from alpha_exchange.users where id='buyer'")).rows;
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_SECRET", nextKey);
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET", currentKey);
    const transaction = await repository.beginTradeLifecycleTransaction(tables);
    transaction!.snapshot.purchaseRequests[0].updatedAt = new Date(Date.now() + 1000).toISOString();
    await transaction!.commit(transaction!.snapshot, { selectedTables: ["purchase_requests"] });
    expect((await repository.loadSelectedSnapshot(tables)).purchaseRequests[0].buyerWiseAccountSnapshot?.accountNumber).toBe("00012345678");
    expect((await database.query("select payload->'wiseUsdAccounts' as private from alpha_exchange.users where id='buyer'")).rows).toEqual(accountsBefore);
    vi.stubEnv("ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET", "");
    expect((await repository.loadSelectedSnapshot(["purchase_requests"])).purchaseRequests[0].buyerWiseAccountSnapshot?.accountNumber).toBe("00012345678");
    await expect(repository.loadAuthUserSnapshot({ userId: "buyer" })).rejects.toThrow();
  });
  it("decrypts a focused mutation and persists only encrypted updated snapshots", async () => {
    await repository.mutateFocusedTrade("wise-trade", snapshot => {
      expect(snapshot.purchaseRequests[0].buyerWiseAccountSnapshot?.accountNumber).toBe("00012345678");
      snapshot.purchaseRequests[0].updatedAt = new Date(Date.now() + 1000).toISOString();
      return snapshot;
    });
    expect(JSON.stringify(await rawPayloads())).not.toMatch(/00012345678|00087654321/);
  });
  it("rejects persisted plaintext and cross-user ciphertext in hosted read paths", async () => {
    await database.query("update alpha_exchange.users set payload=jsonb_set(payload,'{wiseUsdAccounts}',$1::jsonb) where id='buyer'", [JSON.stringify([account("buyer")])]);
    await expect(repository.loadAuthUserSnapshot({ userId: "buyer" })).rejects.toThrow("Private Wise storage is unavailable.");
    await database.exec("update alpha_exchange.users buyer set payload=jsonb_set(buyer.payload,'{wiseUsdAccounts}',seller.payload->'wiseUsdAccounts') from alpha_exchange.users seller where buyer.id='buyer' and seller.id='seller'");
    await expect(repository.loadAuthUserSnapshot({ userId: "buyer" })).rejects.toThrow("Private Wise storage is unavailable.");
  });
});
