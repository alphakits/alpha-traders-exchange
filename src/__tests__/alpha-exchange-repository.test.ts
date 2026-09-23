import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import type { Pool } from "pg";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const mockPool = { query: vi.fn(), connect: vi.fn(), on: vi.fn() } as unknown as Pool;

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => mockPool,
}));

vi.mock("@/lib/alpha-exchange-display", () => ({
  createExchangeDisplayLookup: () => ({}),
  normalizeDisplayNumber: (value: unknown) => (typeof value === "number" ? value : undefined),
  replaceExchangeEntityIds: (value: string) => value,
}));

vi.mock("@/lib/alpha-exchange-repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/alpha-exchange-repository")>("@/lib/alpha-exchange-repository");
  return {
    ...actual,
    getAlphaExchangeRepository: vi.fn(),
  };
});

import { AlphaExchangeRepository, getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { submitBuyerTradeReview, upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";

const TEST_FALLBACK_DIR = `.next-runtime-test-${process.env.VITEST_WORKER_ID ?? "single"}-${process.pid}`;

function createEmptyDb(): AlphaExchangeDb {
  return {
    users: [],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [],
    auditLogs: [],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [],
    activityLog: [],
    disputes: [],
    sellerReports: [],
    trustSnapshots: [],
    trustScoreHistory: [],
    tradeEvidenceFiles: [],
    privateBetaInvites: [],
    privateBetaInviteUses: [],
    betaFeedback: [],
    betaAnnouncements: [],
    adminAnnouncementRuns: [],
    sellerReviews: [],
  };
}

describe("AlphaExchangeRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALPHA_EXCHANGE_TEST_PERSIST_FALLBACK = "1";
    vi.mocked(getAlphaExchangeRepository).mockReset();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    const fallbackPath = path.join(process.cwd(), TEST_FALLBACK_DIR, "alpha-exchange-fallback.json");
    if (existsSync(fallbackPath)) {
      rmSync(fallbackPath, { force: true });
    }
    mkdirSync(path.dirname(fallbackPath), { recursive: true });
  });

  afterEach(() => {
    const fallbackPath = path.join(process.cwd(), TEST_FALLBACK_DIR, "alpha-exchange-fallback.json");
    if (existsSync(fallbackPath)) {
      rmSync(fallbackPath, { force: true });
    }
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    delete process.env.ALPHA_EXCHANGE_TEST_PERSIST_FALLBACK;
    vi.unstubAllEnvs();
  });

  it("commits a review to only its canonical trade and makes an identical retry a no-op", async () => {
    const db = createEmptyDb();
    db.purchaseRequests = [{ id: "focused-trade", buyerId: "buyer", sellerId: "seller", listingId: "listing", status: "completed", updatedAt: "2026-09-21T00:00:00Z", sellerBuyerReview: { rating: 5, comment: "Existing seller review" } }] as AlphaExchangeDb["purchaseRequests"];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("as target_id")) return { rows: [{ target_id: "focused-trade", payload: structuredClone(db) }] };
      if (sql.startsWith("update alpha_exchange.purchase_requests")) db.purchaseRequests[0] = JSON.parse(String(values?.[1]));
      return { rows: [] };
    });
    const release = vi.fn();
    const repo = new AlphaExchangeRepository({ query: vi.fn(), connect: vi.fn().mockResolvedValue({ query, release }), on: vi.fn() } as unknown as Pool);
    vi.spyOn(repo, "ensureReady").mockResolvedValue(undefined);
    const apply = (snapshot: AlphaExchangeDb) => {
      snapshot.purchaseRequests[0].buyerReview = { reviewerUserId: "buyer", rating: 5, comment: "Fast trade", createdAt: "2026-09-21T00:00:01Z" };
      return snapshot;
    };
    await repo.mutateFocusedTrade("focused-trade", apply);
    await repo.mutateFocusedTrade("focused-trade", apply);
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql.filter((statement) => statement.startsWith("update alpha_exchange.purchase_requests"))).toHaveLength(1);
    expect(sql.filter((statement) => statement.includes("version = version + 1"))).toHaveLength(1);
    expect(sql.some((statement) => /delete from/i.test(statement))).toBe(false);
    expect(db.purchaseRequests[0].sellerBuyerReview?.comment).toBe("Existing seller review");
    expect(db.purchaseRequests[0].buyerReview?.comment).toBe("Fast trade");
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("saves and retries the review service through the focused database transaction", async () => {
    const db = createEmptyDb();
    db.purchaseRequests = [{ id: "focused-review", currency: "ILS", paymentMethod: "Bank Transfer", buyerId: "buyer", sellerId: "seller", buyerName: "Buyer", listingId: "listing", status: "completed", network: "TRC20", usdtAmount: "125", fiatAmount: "400", createdAt: "2026-09-21T00:00:00Z", completedAt: "2026-09-21T00:01:00Z", updatedAt: "2026-09-21T00:01:00Z", messages: [], timeline: [] }] as AlphaExchangeDb["purchaseRequests"];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("as target_id")) return { rows: [{ target_id: "focused-review", payload: structuredClone(db) }] };
      if (sql.startsWith("update alpha_exchange.purchase_requests")) db.purchaseRequests[0] = JSON.parse(String(values?.[1]));
      return { rows: [] };
    });
    const repo = new AlphaExchangeRepository({ query: vi.fn(), connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }), on: vi.fn() } as unknown as Pool);
    vi.spyOn(repo, "ensureReady").mockResolvedValue(undefined);
    const fullRead = vi.spyOn(repo, "loadSelectedSnapshot");
    const fullSave = vi.spyOn(repo, "saveSnapshot");
    vi.mocked(getAlphaExchangeRepository).mockResolvedValue(repo);
    const input = { requestId: "focused-review", buyerUserId: "buyer", rating: 5, comment: "Quick exchange" };
    await expect(submitBuyerTradeReview(input)).resolves.toMatchObject({ review: { rating: 5, comment: "Quick exchange" } });
    await expect(submitBuyerTradeReview(input)).resolves.toMatchObject({ review: { rating: 5, comment: "Quick exchange" } });
    expect(db.purchaseRequests[0].buyerReview?.comment).toBe("Quick exchange");
    const cleanupCalls = query.mock.calls.filter(([sql]) => sql.startsWith("update alpha_exchange.notifications"));
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0][1]).toEqual(["buyer", "focused-review", db.purchaseRequests[0].updatedAt]);
    expect(cleanupCalls[0][0]).toContain("payload->>'relatedRequestId' = $2");
    expect(fullRead).not.toHaveBeenCalled();
    expect(fullSave).not.toHaveBeenCalled();
    expect(query.mock.calls.filter(([sql]) => sql.startsWith("update alpha_exchange.purchase_requests"))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO alpha_exchange.audit_logs"))).toBe(true);
  });

  it("rolls back an in-place lifecycle change in a focused mutation", async () => {
    const db = createEmptyDb();
    db.purchaseRequests = [{ id: "focused-trade", buyerId: "buyer", sellerId: "seller", listingId: "listing", status: "completed" }] as AlphaExchangeDb["purchaseRequests"];
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("as target_id") ? [{ target_id: "focused-trade", payload: structuredClone(db) }] : [] }));
    const release = vi.fn();
    const repo = new AlphaExchangeRepository({ query: vi.fn(), connect: vi.fn().mockResolvedValue({ query, release }), on: vi.fn() } as unknown as Pool);
    vi.spyOn(repo, "ensureReady").mockResolvedValue(undefined);
    await expect(repo.mutateFocusedTrade("focused-trade", (snapshot) => {
      snapshot.purchaseRequests[0].status = "cancelled";
      return snapshot;
    })).rejects.toThrow("cannot change lifecycle");
    expect(query).toHaveBeenCalledWith("rollback");
    expect(query.mock.calls.some(([sql]) => sql.startsWith("update "))).toBe(false);
    expect(release).toHaveBeenCalled();
  });

  it("skips runtime DDL when the current schema sentinel exists", async () => {
    const query = vi.fn((queryText: string) => {
      if (queryText.includes("to_regclass")) {
        return Promise.resolve({ rows: [{ ready: true }] });
      }
      if (queryText.includes("count(*)::text")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);
    await repository.ensureReady();

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      "select to_regclass($1) is not null as ready",
      ["alpha_exchange.idx_alpha_exchange_commissions_unpaid_seller"],
    );
    expect(query.mock.calls.some(([sql]) => String(sql).includes("create schema"))).toBe(false);
  });

  it("avoids the local seed count during production bootstrap", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const query = vi.fn((queryText: string) => {
      if (queryText.includes("to_regclass")) {
        return Promise.resolve({ rows: [{ ready: true }] });
      }
      throw new Error(`Unexpected production bootstrap query: ${queryText}`);
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);
    await repository.ensureReady();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("count(*)::text"))).toBe(false);
  });

  it("retains safe runtime bootstrap when the schema sentinel is missing", async () => {
    const query = vi.fn((queryText: string) => {
      if (queryText.includes("to_regclass")) {
        return Promise.resolve({ rows: [{ ready: false }] });
      }
      if (queryText.includes("count(*)::text")) {
        return Promise.resolve({ rows: [{ count: "1" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);
    await repository.ensureReady();

    expect(query.mock.calls.some(([sql]) => String(sql).includes("create schema if not exists alpha_exchange"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("idx_alpha_exchange_marketplace_enforcement_audit_seller_created"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("idx_alpha_exchange_mobile_push_receipts"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("seller_entered_flagged_state"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("idx_alpha_exchange_notifications_trust_reconciliation"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("create table if not exists alpha_exchange.evidence_blobs"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("idx_alpha_exchange_evidence_blobs_updated"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("idx_alpha_exchange_commissions_unpaid_seller"))).toBe(true);
  });

  it("loads unpaid commission seller IDs with one targeted canonical query", async () => {
    const query = vi.fn((queryText: string, _values?: unknown[]) => {
      void _values;
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("select distinct seller_id from alpha_exchange.commissions")) {
        return Promise.resolve({ rows: [{ seller_id: "seller-1" }, { seller_id: "seller-2" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.loadUnpaidCommissionSellerIds()).resolves.toEqual(["seller-1", "seller-2"]);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("select distinct seller_id"))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("from alpha_exchange.listings order by"))).toBe(false);
  });

  it("loads the public marketplace and commission locks in one seller-scoped query", async () => {
    const seller = {
      id: "seller-1",
      email: "seller@example.test",
      fullName: "Seller",
      sellerStatus: "approved_seller",
    };
    const viewer = { id: "buyer-1", email: "buyer@example.test", fullName: "Buyer" };
    const activeListing = { id: "listing-active", sellerId: "seller-1", status: "active" };
    const closedListing = { id: "listing-closed", sellerId: "seller-1", status: "closed" };
    const commission = { id: "commission-1", sellerId: "seller-1", paymentStatus: "pending" };
    const query = vi.fn((queryText: string, values?: unknown[]) => {
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes("with candidate_seller_ids as materialized")) {
        expect(values).toEqual(["buyer-1"]);
        expect(queryText).toContain("where status = 'active'");
        expect(queryText).toContain("request.seller_id in (select seller_id from candidate_seller_ids)");
        expect(queryText).toContain("commission.seller_id in (select seller_id from candidate_seller_ids)");
        expect(queryText).toContain("commission.payment_status <> 'paid'");
        expect(queryText).toContain("entry.target_user_id in (select seller_id from candidate_seller_ids)");
        expect(queryText).not.toContain("alpha_exchange.sessions");
        expect(queryText).not.toContain("alpha_exchange.notifications");
        return Promise.resolve({
          rows: [{
            version: "33",
            users: [seller, viewer],
            seller_applications: [],
            listings: [activeListing, closedListing],
            purchase_requests: [],
            commissions: [commission],
            unpaid_commission_seller_ids: ["seller-1"],
            audit_logs: [],
            trust_snapshots: [],
            marketplace_enforcement_records: [],
          }],
        });
      }
      throw new Error(`Unexpected query: ${queryText}`);
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    const loaded = await repository.loadMarketplaceListingSnapshotForViewer(" buyer-1 ");
    const snapshot = loaded.snapshot;

    expect(snapshot.users).toEqual([seller, viewer]);
    expect(snapshot.marketplaceListings).toEqual([activeListing, closedListing]);
    expect(snapshot.commissionRecords).toEqual([commission]);
    expect(snapshot.notifications).toEqual([]);
    expect(loaded.unpaidCommissionSellerIds).toEqual(["seller-1"]);
    expect((snapshot as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(33);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("with candidate_seller_ids as materialized"))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("select distinct seller_id from alpha_exchange.commissions"))).toBe(false);
  });

  it("loads one Trade Room snapshot and revision without a full-table fan-out", async () => {
    const requestPayload = {
      id: "purchase-1",
      tradeId: "trade-1",
      listingId: "listing-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      buyerName: "Buyer",
      usdtAmount: "100",
      fiatAmount: "330",
      pricePerUsdt: "3.3",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Face-to-Face (Meet in Person)",
      status: "accepted",
      createdAt: "2026-09-14T18:00:00.000Z",
      updatedAt: "2026-09-14T18:00:01.000Z",
    };
    const query = vi.fn((queryText: string) => {
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes("request.payload as request_payload")) {
        return Promise.resolve({ rows: [{
          request_payload: requestPayload,
          listing_payload: { id: "listing-1", sellerId: "seller-1" },
          buyer_payload: { id: "buyer-1", fullName: "Buyer" },
          seller_payload: { id: "seller-1", fullName: "Seller" },
          dispute_payloads: [],
          commission_payloads: [],
          evidence_payloads: [],
          version: "42",
        }] });
      }
      if (queryText.includes("select id, buyer_id, seller_id, status")) {
        return Promise.resolve({ rows: [{
          id: "purchase-1",
          buyer_id: "buyer-1",
          seller_id: "seller-1",
          status: "accepted",
          updated_at: "2026-09-14T18:00:01.000Z",
        }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.loadTradeRoomSnapshot(["purchase-1"])).resolves.toMatchObject({
      purchaseRequests: [{ id: "purchase-1", status: "accepted" }],
      marketplaceListings: [{ id: "listing-1" }],
      users: [{ id: "buyer-1" }, { id: "seller-1" }],
      __runtimeVersion: 42,
    });
    await expect(repository.loadTradeRoomRevision(["purchase-1"])).resolves.toEqual({
      id: "purchase-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "accepted",
      updatedAt: "2026-09-14T18:00:01.000Z",
    });

    expect(query.mock.calls.filter(([sql]) => String(sql).includes("request.payload as request_payload"))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("select id, buyer_id, seller_id, status"))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("select payload from alpha_exchange.users"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith("select payload from alpha_exchange.purchase_requests"))).toBe(false);
  });

  it("loads only the explicitly selected critical-path snapshot tables", async () => {
    const query = vi.fn((queryText: string) => {
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes('as "purchase_requests"') && queryText.includes('as "notifications"')) {
        return Promise.resolve({
          rows: [{
            version: "17",
            purchase_requests: [{ id: "purchase-1", status: "accepted" }],
            notifications: [],
          }],
        });
      }
      throw new Error(`Unexpected full-table query: ${queryText}`);
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    const snapshot = await repository.loadSelectedSnapshot(["purchase_requests", "notifications"]);

    expect(snapshot.purchaseRequests).toEqual([{ id: "purchase-1", status: "accepted" }]);
    expect(snapshot.users).toEqual([]);
    expect((snapshot as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(17);
    const selectedQueries = query.mock.calls.filter(([sql]) => String(sql).includes("jsonb_agg(payload order by sort_index asc)"));
    expect(selectedQueries).toHaveLength(1);
    expect(String(selectedQueries[0]?.[0])).not.toContain('as "users"');
  });

  it("retries one transient selected-snapshot read with a fresh pool checkout", async () => {
    let selectedAttempts = 0;
    const query = vi.fn((queryText: string) => {
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes('as "users"')) {
        selectedAttempts += 1;
        if (selectedAttempts === 1) return Promise.reject(new Error("Query read timeout"));
        return Promise.resolve({ rows: [{ version: "18", users: [{ id: "user-1" }] }] });
      }
      throw new Error(`Unexpected query: ${queryText}`);
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    const snapshot = await repository.loadSelectedSnapshot(["users"]);

    expect(snapshot.users).toEqual([{ id: "user-1" }]);
    expect((snapshot as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(18);
    expect(selectedAttempts).toBe(2);
  });

  it("resolves an authenticated session, account, and seller role context in one query", async () => {
    const session = {
      token: "hashed-session-token",
      userId: "user-1",
      createdAt: "2026-09-15T12:00:00.000Z",
      expiresAt: "2026-09-16T12:00:00.000Z",
    };
    const user = { id: "user-1", email: "reviewer@example.test", fullName: "Reviewer" };
    const application = { id: "application-1", userId: "user-1", status: "approved" };
    const query = vi.fn((queryText: string, values?: unknown[]) => {
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes("with matched_session as materialized")) {
        expect(values).toEqual(["hashed-session-token"]);
        expect(queryText).toContain("where token_hash = $1");
        expect(queryText).not.toContain('as "password_reset_tokens"');
        return Promise.resolve({
          rows: [{
            version: "19",
            sessions: [session],
            users: [user],
            seller_applications: [application],
          }],
        });
      }
      throw new Error(`Unexpected query: ${queryText}`);
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    const snapshot = await repository.loadAuthenticatedSessionSnapshot("hashed-session-token");

    expect(snapshot.authSessions).toEqual([session]);
    expect(snapshot.users).toEqual([user]);
    expect(snapshot.sellerApplications).toEqual([application]);
    expect((snapshot as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(19);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("with matched_session as materialized"))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('as "sessions"'))).toBe(false);
  });

  it("loads the owner dashboard in bounded groups on one consistent connection", async () => {
    const payloads: Record<string, unknown[]> = {
      users: [{ id: "owner-1", role: "owner" }],
      listings: [{ id: "listing-1", status: "active" }],
      notifications: [{ id: "notification-1", userId: "owner-1" }],
      audit_logs: [{ id: "audit-1", action: "review" }],
      activity_logs: [{ id: "activity-1", userId: "owner-1" }],
      private_beta_invites: [{ id: "invite-1", code: "TEST" }],
    };
    const clientQuery = vi.fn((queryText: string) => {
      if (/^(begin|commit|rollback)/i.test(queryText.trim())) return Promise.resolve({ rows: [] });
      if (queryText.includes("runtime_meta")) {
        const row: Record<string, unknown> = { version: "57" };
        for (const match of queryText.matchAll(/as "([^"]+)"/g)) {
          row[match[1]] = payloads[match[1]] ?? [];
        }
        return Promise.resolve({ rows: [row] });
      }
      throw new Error(`Unexpected client query: ${queryText}`);
    });
    const release = vi.fn();
    const client = { query: clientQuery, release };
    const poolQuery = vi.fn((queryText: string) => {
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      throw new Error(`Unexpected pool query: ${queryText}`);
    });
    const pool = {
      query: poolQuery,
      connect: vi.fn().mockResolvedValue(client),
      on: vi.fn(),
    } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    const snapshot = await repository.loadAdminDashboardSnapshot();

    const aggregateQueries = clientQuery.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => sql.includes("runtime_meta"));
    expect(aggregateQueries).toHaveLength(6);
    for (const sql of aggregateQueries) {
      expect(sql).not.toContain("alpha_exchange.sessions");
      expect(sql).not.toContain("alpha_exchange.password_reset_tokens");
      expect(sql).not.toContain("alpha_exchange.sms_deliveries");
      expect(sql).not.toContain("alpha_exchange.admin_announcement_runs");
      expect(sql).not.toContain("alpha_exchange.seller_profiles");
      expect(sql).not.toContain("alpha_exchange.seller_settings");
      expect(sql).not.toContain("alpha_exchange.trades");
    }
    const combinedAggregateSql = aggregateQueries.join("\n");
    for (const tableName of ["notifications", "audit_logs", "trust_score_history", "activity_logs", "marketplace_enforcement_audit_log"]) {
      const boundedTablePattern = new RegExp(`from alpha_exchange\\.${tableName}\\s+order by sort_index asc\\s+limit 250`);
      expect(combinedAggregateSql).toMatch(boundedTablePattern);
    }
    expect(aggregateQueries.find((sql) => sql.includes('as "users"'))).not.toContain("limit 250");
    expect(aggregateQueries.find((sql) => sql.includes('as "listings"'))).not.toContain("limit 250");
    expect(snapshot.users).toEqual([{ id: "owner-1", role: "owner" }]);
    expect(snapshot.marketplaceListings).toEqual([{ id: "listing-1", status: "active" }]);
    expect(snapshot.notifications).toEqual([{ id: "notification-1", userId: "owner-1" }]);
    expect((snapshot as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(57);
    expect(clientQuery).toHaveBeenNthCalledWith(1, "begin transaction isolation level repeatable read read only");
    expect(clientQuery).toHaveBeenLastCalledWith("commit");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalledWith(true);
  });

  it("loads dashboard account, trade-history, and notification data with actor-scoped queries", async () => {
    const account = { id: "buyer-1", email: "buyer@example.com", fullName: "Buyer" };
    const request = {
      id: "purchase-1",
      tradeId: "trade-1",
      listingId: "listing-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "completed",
    };
    const listing = {
      id: "listing-1",
      sellerId: "seller-1",
      displayNumber: 101,
    };
    const notification = {
      id: "notification-1",
      userId: "buyer-1",
      relatedRequestId: "purchase-1",
      relatedTradeId: "trade-1",
      relatedListingId: "listing-1",
    };
    const query = vi.fn((queryText: string, values?: unknown[]) => {
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes("with selected_users as materialized")) {
        expect(values).toEqual([null, "buyer@example.com"]);
        return Promise.resolve({ rows: [{ version: "21", users: [account], seller_applications: [] }] });
      }
      if (queryText.includes("with visible_requests as materialized")) {
        expect(values).toEqual(["buyer-1", false, null]);
        expect(queryText).toContain("from alpha_exchange.listings listing");
        expect(queryText).toContain("select buyer_id from visible_requests union select seller_id from visible_requests");
        return Promise.resolve({ rows: [{ version: "22", users: [account], listings: [listing], purchase_requests: [request], evidence: [] }] });
      }
      if (queryText.includes("with candidate_request as materialized")) {
        expect(values).toEqual(["buyer-1", false, ["accepted", "payment_sent"], true]);
        expect(queryText).toContain("order by updated_at desc");
        expect(queryText).toContain("limit 1");
        return Promise.resolve({ rows: [{ version: "22", users: [account], listings: [listing], purchase_requests: [request] }] });
      }
      if (queryText.includes("with recipient_notifications as materialized")) {
        expect(values).toEqual(["buyer-1", false]);
        return Promise.resolve({
          rows: [{
            version: "23",
            users: [account],
            seller_applications: [],
            listings: [],
            purchase_requests: [request],
            commissions: [],
            notifications: [notification],
            activity_logs: [],
            disputes: [],
            trust_snapshots: [],
          }],
        });
      }
      throw new Error(`Unexpected query: ${queryText}`);
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    const authSnapshot = await repository.loadAuthUserSnapshot({ normalizedEmail: "buyer@example.com" });
    const requestSnapshot = await repository.loadPurchaseRequestSnapshotForActor({ userId: "buyer-1", includeAll: false });
    const activeRequestSnapshot = await repository.loadPurchaseRequestCandidateSnapshotForActor({
      userId: "buyer-1",
      includeAll: false,
      activeStatuses: ["accepted", "payment_sent"],
      includeBuyerPending: true,
    });
    const notificationSnapshot = await repository.loadNotificationSnapshotForUser({ userId: "buyer-1", includeActivity: false });

    expect(authSnapshot.users).toEqual([account]);
    expect(authSnapshot.purchaseRequests).toEqual([]);
    expect(requestSnapshot.purchaseRequests).toEqual([request]);
    expect(requestSnapshot.marketplaceListings).toEqual([listing]);
    expect(activeRequestSnapshot.purchaseRequests).toEqual([request]);
    expect(activeRequestSnapshot.marketplaceListings).toEqual([listing]);
    expect(requestSnapshot.users).toEqual([account]);
    expect(activeRequestSnapshot.users).toEqual([account]);
    expect(notificationSnapshot.notifications).toEqual([notification]);
    expect(notificationSnapshot.purchaseRequests).toEqual([request]);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("with selected_users as materialized"))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("with visible_requests as materialized"))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("with candidate_request as materialized"))).toHaveLength(1);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("with recipient_notifications as materialized"))).toHaveLength(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('as "admin_announcement_runs"'))).toBe(false);
  });

  it("loads profile and seller workspace snapshots without unrelated accounts or trades", async () => {
    const buyer = { id: "buyer-1", email: "buyer@example.com", fullName: "Buyer" };
    const seller = { id: "seller-1", email: "seller@example.com", fullName: "Seller" };
    const buyerRequest = { id: "purchase-buyer", buyerId: "buyer-1", sellerId: "seller-1" };
    const sellerListing = { id: "listing-1", sellerId: "seller-1", status: "active" };
    const query = vi.fn((queryText: string, values?: unknown[]) => {
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes("from alpha_exchange.sessions where user_id = $1")) {
        expect(values).toEqual(["buyer-1"]);
        return Promise.resolve({
          rows: [{
            version: "31",
            users: [buyer],
            seller_applications: [],
            sessions: [],
            purchase_requests: [buyerRequest],
            listings: [],
            commissions: [],
            trust_snapshots: [],
          }],
        });
      }
      if (queryText.includes("from alpha_exchange.marketplace_enforcement_audit_log where seller_id = $1")) {
        expect(values).toEqual(["seller-1"]);
        return Promise.resolve({
          rows: [{
            version: "32",
            users: [seller],
            seller_applications: [],
            listings: [sellerListing],
            purchase_requests: [buyerRequest],
            commissions: [],
            audit_logs: [],
            trust_snapshots: [],
            marketplace_enforcement_records: [],
            marketplace_enforcement_audit_log: [],
          }],
        });
      }
      throw new Error(`Unexpected query: ${queryText}`);
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    const profileSnapshot = await repository.loadAccountProfileSnapshotForUser("buyer-1");
    const sellerSnapshot = await repository.loadSellerWorkspaceSnapshotForUser("seller-1");

    expect(profileSnapshot.users).toEqual([buyer]);
    expect(profileSnapshot.purchaseRequests).toEqual([buyerRequest]);
    expect(profileSnapshot.marketplaceListings).toEqual([]);
    expect(sellerSnapshot.users).toEqual([seller]);
    expect(sellerSnapshot.marketplaceListings).toEqual([sellerListing]);
    expect(sellerSnapshot.purchaseRequests).toEqual([buyerRequest]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('as "password_reset_tokens"'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('as "beta_feedback"'))).toBe(false);
  });

  it("stores db:// compliance evidence in PostgreSQL instead of the deployment filesystem", async () => {
    const content = Buffer.from("compliance-evidence");
    const storageKey = "db://alpha-exchange-evidence/compliance/seller-1/evidence-1.png";
    const query = vi.fn((queryText: string, _values?: unknown[]) => {
      void _values;
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes("select content from alpha_exchange.evidence_blobs")) {
        return Promise.resolve({ rows: [{ content }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.writeEvidenceContent(storageKey, content)).resolves.toBeUndefined();
    await expect(repository.readEvidenceContent(storageKey)).resolves.toEqual(content);

    const blobWrite = query.mock.calls.find(([sql]) => String(sql).includes("insert into alpha_exchange.evidence_blobs"));
    expect(blobWrite?.[1]).toEqual([storageKey, content]);
    expect(existsSync(path.join(process.cwd(), "data", "alpha-exchange-evidence", "compliance", "seller-1", "evidence-1.png"))).toBe(false);
  });

  it("falls back to the in-memory snapshot when the database connection times out", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("timeout exceeded when trying to connect")),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);
    const snapshot = await repository.loadSnapshot();

    expect(snapshot).toBeDefined();
    expect(snapshot).toHaveProperty("__runtimeVersion", 0);
  });

  it("reuses the latest successful database snapshot when a later load falls back to memory", async () => {
    const listing = {
      id: "listing-1",
      sellerId: "seller-1",
      sellerDisplayName: "Seller One",
      photos: [],
      originalAmount: "1000",
      availableAmount: "700",
      price: "3.2",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      paymentMethod: "Bank Transfer",
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "1000",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      notes: "",
      sellerDescription: "",
      responseTime: "5 min",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    let failLoads = false;
    const pool = {
      query: vi.fn((queryText: string) => {
        if (failLoads) {
          return Promise.reject(new Error("timeout exceeded when trying to connect"));
        }
        if (queryText.includes("jsonb_agg(payload order by sort_index asc)")) {
          return Promise.resolve({
            rows: [{
              version: "7",
              users: [{ id: "seller-1", email: "seller@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" }],
              listings: [listing],
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);
    const loaded = await repository.loadSnapshot();
    expect(loaded.marketplaceListings).toEqual([expect.objectContaining({ id: "listing-1", availableAmount: "700" })]);
    expect((loaded as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(7);

    failLoads = true;
    const fallback = await repository.loadSnapshot();
    expect(fallback.marketplaceListings).toEqual([expect.objectContaining({ id: "listing-1", availableAmount: "700" })]);
    expect((fallback as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(7);
  });

  it("shares the latest fallback snapshot across repository instances", async () => {
    const listing = {
      id: "listing-shared",
      sellerId: "seller-1",
      sellerDisplayName: "Seller One",
      photos: [],
      originalAmount: "1000",
      availableAmount: "700",
      price: "3.2",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      paymentMethod: "Bank Transfer",
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "1000",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      notes: "",
      sellerDescription: "",
      responseTime: "5 min",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const successPool = {
      query: vi.fn((queryText: string) => {
        if (queryText.includes("jsonb_agg(payload order by sort_index asc)")) {
          return Promise.resolve({
            rows: [{
              version: "9",
              users: [{ id: "seller-1", email: "seller@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" }],
              listings: [listing],
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    const firstRepository = new AlphaExchangeRepository(successPool);
    const loaded = await firstRepository.loadSnapshot();
    expect(loaded.marketplaceListings).toEqual([expect.objectContaining({ id: "listing-shared" })]);

    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;

    const failingPool = {
      query: vi.fn().mockRejectedValue(new Error("timeout exceeded when trying to connect")),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    const secondRepository = new AlphaExchangeRepository(failingPool);
    const fallback = await secondRepository.loadSnapshot();
    expect(fallback.marketplaceListings).toEqual([expect.objectContaining({ id: "listing-shared", availableAmount: "700" })]);
    expect((fallback as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(9);
  });

  it("prefers explicit in-memory state over a stale persisted fallback after a load failure", async () => {
    const fallbackPath = path.join(process.cwd(), TEST_FALLBACK_DIR, "alpha-exchange-fallback.json");
    globalThis.__alphaExchangeMemorySnapshot = {
      ...createEmptyDb(),
      __runtimeVersion: 1,
    } as never;

    writeFileSync(fallbackPath, JSON.stringify({
      users: [{ id: "seller-1", email: "seller@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" }],
      sellerApplications: [],
      marketplaceListings: [{
        id: "listing-persisted",
        sellerId: "seller-1",
        sellerDisplayName: "Seller One",
        photos: [],
        originalAmount: "1000",
        availableAmount: "750",
        price: "3.2",
        currency: "ILS",
        network: "TRC20",
        paymentMethods: ["Bank Transfer"],
        paymentMethod: "Bank Transfer",
        bankName: "Bank Hapoalim",
        minimumTrade: "50",
        maximumTrade: "1000",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        notes: "",
        sellerDescription: "",
        responseTime: "5 min",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      purchaseRequests: [{ id: "purchase-1", listingId: "listing-persisted", sellerId: "seller-1", buyerId: "buyer-1", status: "review_open", usdtAmount: "250" }],
      commissionRecords: [],
      auditLogs: [],
      authSessions: [],
      passwordResetTokens: [],
      notifications: [],
      activityLog: [],
      disputes: [],
      sellerReports: [],
      trustSnapshots: [],
      trustScoreHistory: [],
      tradeEvidenceFiles: [],
      privateBetaInvites: [],
      privateBetaInviteUses: [],
      betaFeedback: [],
      betaAnnouncements: [],
      adminAnnouncementRuns: [],
      sellerReviews: [],
      __runtimeVersion: 12,
    }), "utf8");

    const pool = {
      query: vi.fn().mockRejectedValue(new Error("timeout exceeded when trying to connect")),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);
    const fallback = await repository.loadSnapshot();

    expect(fallback.marketplaceListings).toEqual([]);
    expect(fallback.purchaseRequests).toEqual([]);
    expect((fallback as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(1);
  });

  it("drops orphan auth sessions before full snapshot writes", async () => {
    const client = {
      query: vi.fn((sql: string) => {
        if (typeof sql === "string" && sql.includes("select payload from alpha_exchange.sessions")) {
          return Promise.resolve({
            rows: [
              { payload: { token: "good-token", userId: "user-1", createdAt: new Date().toISOString(), expiresAt: new Date().toISOString() } },
              { payload: { token: "orphan-token", userId: "missing-user", createdAt: new Date().toISOString(), expiresAt: new Date().toISOString() } },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.saveSnapshot({
      ...createEmptyDb(),
      users: [{ id: "user-1", email: "user@example.com", role: "buyer", roles: ["buyer"], sellerStatus: "buyer", availabilityStatus: "available", onlineStatus: "online", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never],
    })).resolves.toBeUndefined();

    const sessionInserts = (client.query.mock.calls as unknown[][])
      .filter(([sql]) => typeof sql === "string" && sql.toLowerCase().includes("insert into alpha_exchange.sessions"));
    expect(sessionInserts).toHaveLength(1);
    const firstInsertArgs = (Array.isArray(sessionInserts[0]?.[1]) ? sessionInserts[0]?.[1] : []) as unknown[];
    expect(firstInsertArgs[0]).toEqual(expect.arrayContaining(["good-token"]));
    expect(firstInsertArgs[1]).toEqual(expect.arrayContaining(["user-1"]));
    expect(JSON.stringify(sessionInserts)).not.toContain("orphan-token");
  });

  it("keeps partial user writes scoped without rewriting listings", async () => {
    const client = {
      query: vi.fn((sql: string) => {
        if (typeof sql === "string" && sql.includes("select version::text as version from alpha_exchange.runtime_meta")) {
          return Promise.resolve({ rows: [{ version: "4" }] });
        }
        if (typeof sql === "string" && sql.includes("select payload from alpha_exchange.sessions")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);
    await repository.saveSnapshot({
      ...createEmptyDb(),
      users: [{ id: "user-1", email: "user@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", availabilityStatus: "available", onlineStatus: "online", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never],
      marketplaceListings: [{
        id: "listing-1",
        sellerId: "user-1",
        sellerDisplayName: "Seller One",
        photos: [],
        originalAmount: "1000",
        availableAmount: "700",
        price: "3.2",
        currency: "ILS",
        network: "TRC20",
        paymentMethods: ["Bank Transfer"],
        paymentMethod: "Bank Transfer",
        bankName: "Bank Hapoalim",
        minimumTrade: "50",
        maximumTrade: "1000",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        notes: "",
        sellerDescription: "",
        responseTime: "5 min",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }] as never,
      __runtimeVersion: 4,
    } as AlphaExchangeDb, { selectedTables: ["users"] });

    const listingInsert = client.query.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("insert into alpha_exchange.listings"));
    expect(listingInsert).toBeUndefined();
    const fullUsersDelete = client.query.mock.calls.find(([sql]) => typeof sql === "string" && sql.trim() === "delete from alpha_exchange.users");
    expect(fullUsersDelete).toBeUndefined();
    const scopedUsersDelete = client.query.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("delete from alpha_exchange.users where not"));
    expect(scopedUsersDelete).toBeDefined();
  });

  it("recovers a stale trade write with one aggregate query on the checked-out client", async () => {
    const canonicalRequest = {
      id: "request-canonical",
      status: "accepted",
      listingId: "listing-1",
      sellerId: "seller-1",
      buyerId: "buyer-1",
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:01.000Z",
    };
    const client = {
      query: vi.fn((sql: string) => {
        if (typeof sql === "string" && sql.includes("jsonb_agg(payload order by sort_index asc)")) {
          return Promise.resolve({
            rows: [{ version: "2", purchase_requests: [canonicalRequest] }],
          });
        }
        if (typeof sql === "string" && sql.includes("select version::text as version from alpha_exchange.runtime_meta")) {
          return Promise.resolve({ rows: [{ version: "2" }] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client),
      on: vi.fn(),
    } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);
    const staleSnapshot = {
      ...createEmptyDb(),
      purchaseRequests: [{
        ...canonicalRequest,
        id: "request-incoming",
        status: "pending",
        updatedAt: "2026-09-15T00:00:02.000Z",
      }],
      __runtimeVersion: 1,
    } as unknown as AlphaExchangeDb;

    await repository.saveSnapshot(staleSnapshot, {
      skipReadyCheck: true,
      selectedTables: ["purchase_requests"],
    });

    const aggregateQueries = client.query.mock.calls.filter(([sql]) => (
      typeof sql === "string" && sql.includes("jsonb_agg(payload order by sort_index asc)")
    ));
    expect(aggregateQueries).toHaveLength(1);
    expect(client.query.mock.calls.some(([sql]) => (
      typeof sql === "string" && sql.trimStart().startsWith("select payload from alpha_exchange.")
    ))).toBe(false);
    expect(staleSnapshot.purchaseRequests.map((request) => request.id).sort()).toEqual([
      "request-canonical",
      "request-incoming",
    ]);
  });

  it("switches to the in-memory snapshot after initialization fails so later writes do not hit the database", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("database unavailable")),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);
    await expect(repository.loadSnapshot()).resolves.toBeDefined();

    await expect(repository.saveSnapshot(createEmptyDb())).resolves.toBeUndefined();

    expect(globalThis.__alphaExchangeMemorySnapshot).toBeDefined();
  });

  it("coalesces stale snapshot writes by preserving the latest state instead of throwing", async () => {
    const repository = new AlphaExchangeRepository(null);
    const baseline = await repository.loadSnapshot();
    const baselineSnapshot = baseline as AlphaExchangeDb & { __runtimeVersion?: number };
    baselineSnapshot.__runtimeVersion = 2;
    baselineSnapshot.purchaseRequests = [{ id: "request-1", status: "accepted", listingId: "listing-1", sellerId: "seller-1", buyerId: "buyer-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never];
    globalThis.__alphaExchangeMemorySnapshot = baselineSnapshot as never;

    const staleDb: AlphaExchangeDb & { __runtimeVersion: number } = {
      ...createEmptyDb(),
      purchaseRequests: [{
        id: "request-2",
        status: "pending",
        listingId: "listing-1",
        sellerId: "seller-1",
        buyerId: "buyer-1",
        buyerName: "Buyer One",
        buyerWhatsapp: "+972500000000",
        buyerNotes: "",
        buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
        usdtAmount: "100",
        fiatAmount: "320",
        currency: "ILS",
        network: "TRC20",
        paymentMethod: "Bank Transfer",
        timeline: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      __runtimeVersion: 1,
    };

    await expect(repository.saveSnapshot(staleDb)).resolves.toBeUndefined();
    const savedSnapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion?: number };
    expect(savedSnapshot.__runtimeVersion).toBe(3);
    expect(savedSnapshot.purchaseRequests).toEqual(expect.arrayContaining([expect.objectContaining({ id: "request-1" }), expect.objectContaining({ id: "request-2" })]));
  });

  it("does not let a stale trade write roll back another listing, audit entry, or commission", async () => {
    const repository = new AlphaExchangeRepository(null);
    const baseline = await repository.loadSnapshot();
    const listingBase = {
      sellerId: "seller-1",
      sellerDisplayName: "Seller One",
      photos: [],
      originalAmount: "500",
      availableAmount: "500",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      paymentMethod: "Bank Transfer",
      minimumTrade: "50",
      maximumTrade: "500",
      responseTime: "5 min",
      approvalStatus: "approved",
      createdAt: "2026-09-04T10:00:00.000Z",
    };
    const latestSnapshot = {
      ...baseline,
      marketplaceListings: [{
        ...listingBase,
        id: "listing-1",
        status: "matched",
        activeTradeRequestId: "request-1",
        updatedAt: "2026-09-04T10:02:00.000Z",
      }, {
        ...listingBase,
        id: "listing-2",
        status: "active",
        updatedAt: "2026-09-04T10:00:00.000Z",
      }],
      auditLogs: [{ id: "audit-1", action: "listing_matched", actorUserId: "seller-1", createdAt: "2026-09-04T10:02:00.000Z" }],
      commissionRecords: [{ id: "commission-1", purchaseRequestId: "request-1", listingId: "listing-1", sellerId: "seller-1", buyerId: "buyer-1", rate: 0.01, grossAmount: 320, commissionAmount: 1, paymentStatus: "pending", createdAt: "2026-09-04T10:02:00.000Z", updatedAt: "2026-09-04T10:02:00.000Z" }],
      __runtimeVersion: 2,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
    globalThis.__alphaExchangeMemorySnapshot = latestSnapshot as never;

    const staleWriter = {
      ...baseline,
      marketplaceListings: [{
        ...listingBase,
        id: "listing-1",
        status: "active",
        updatedAt: "2026-09-04T10:00:00.000Z",
      }, {
        ...listingBase,
        id: "listing-2",
        status: "matched",
        activeTradeRequestId: "request-2",
        updatedAt: "2026-09-04T10:03:00.000Z",
      }],
      auditLogs: [{ id: "audit-2", action: "listing_matched", actorUserId: "seller-1", createdAt: "2026-09-04T10:03:00.000Z" }],
      commissionRecords: [{ id: "commission-2", purchaseRequestId: "request-2", listingId: "listing-2", sellerId: "seller-1", buyerId: "buyer-2", rate: 0.01, grossAmount: 320, commissionAmount: 1, paymentStatus: "pending", createdAt: "2026-09-04T10:03:00.000Z", updatedAt: "2026-09-04T10:03:00.000Z" }],
      __runtimeVersion: 1,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };

    await repository.saveSnapshot(staleWriter, {
      selectedTables: ["listings", "audit_logs", "commissions"],
    });

    const persisted = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    expect(persisted.marketplaceListings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "listing-1", status: "matched", activeTradeRequestId: "request-1" }),
      expect.objectContaining({ id: "listing-2", status: "matched", activeTradeRequestId: "request-2" }),
    ]));
    expect(persisted.auditLogs.map((entry) => entry.id)).toEqual(expect.arrayContaining(["audit-1", "audit-2"]));
    expect(persisted.commissionRecords.map((entry) => entry.id)).toEqual(expect.arrayContaining(["commission-1", "commission-2"]));
    expect(staleWriter.marketplaceListings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "listing-1", status: "matched" }),
      expect.objectContaining({ id: "listing-2", status: "matched" }),
    ]));
  });

  it("preserves an issued exact commission intent when stale overdue maintenance has a later timestamp", async () => {
    const repository = new AlphaExchangeRepository(null);
    const baseline = await repository.loadSnapshot();
    const baseCommission = {
      id: "commission-intent",
      purchaseRequestId: "request-intent",
      listingId: "listing-intent",
      sellerId: "seller-1",
      buyerId: "buyer-1",
      rate: 0.01,
      grossAmount: 700,
      commissionAmount: 7,
      createdAt: "2026-09-04T10:00:00.000Z",
    };
    const latestSnapshot = {
      ...baseline,
      commissionRecords: [{
        ...baseCommission,
        paymentStatus: "pending",
        paymentExpectedAmount: 7.000001,
        paymentExpectedAmountMode: "unique_v1",
        paymentExpectedAmountAssignedAt: "2026-09-04T10:01:00.000Z",
        paymentReservedExpectedAmounts: [7],
        updatedAt: "2026-09-04T10:01:00.000Z",
      }],
      __runtimeVersion: 2,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
    globalThis.__alphaExchangeMemorySnapshot = latestSnapshot as never;

    const staleMaintenanceWriter = {
      ...baseline,
      commissionRecords: [{
        ...baseCommission,
        paymentStatus: "overdue",
        overdueNotifiedAt: "2026-09-04T10:03:00.000Z",
        updatedAt: "2026-09-04T10:03:00.000Z",
      }],
      __runtimeVersion: 1,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };

    await repository.saveSnapshot(staleMaintenanceWriter, { selectedTables: ["commissions"] });

    const persisted = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    expect(persisted.commissionRecords[0]).toMatchObject({
      id: "commission-intent",
      paymentStatus: "overdue",
      paymentExpectedAmount: 7.000001,
      paymentExpectedAmountMode: "unique_v1",
      paymentExpectedAmountAssignedAt: "2026-09-04T10:01:00.000Z",
      paymentReservedExpectedAmounts: [7],
    });
  });

  it("never lets stale overdue maintenance roll a paid commission back", async () => {
    const repository = new AlphaExchangeRepository(null);
    const baseline = await repository.loadSnapshot();
    const baseCommission = {
      id: "commission-paid",
      purchaseRequestId: "request-paid",
      listingId: "listing-paid",
      sellerId: "seller-1",
      buyerId: "buyer-1",
      rate: 0.01,
      grossAmount: 700,
      commissionAmount: 7,
      createdAt: "2026-09-04T10:00:00.000Z",
    };
    const latestSnapshot = {
      ...baseline,
      commissionRecords: [{
        ...baseCommission,
        paymentStatus: "paid",
        paymentVerificationStatus: "verified",
        paymentSignature: "a1".repeat(32),
        paymentExpectedAmount: 7.000001,
        paymentExpectedAmountMode: "unique_v1",
        paymentExpectedAmountAssignedAt: "2026-09-04T10:01:00.000Z",
        paidAt: "2026-09-04T10:02:00.000Z",
        updatedAt: "2026-09-04T10:02:00.000Z",
      }],
      __runtimeVersion: 2,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
    globalThis.__alphaExchangeMemorySnapshot = latestSnapshot as never;

    const staleMaintenanceWriter = {
      ...baseline,
      commissionRecords: [{
        ...baseCommission,
        paymentStatus: "overdue",
        overdueNotifiedAt: "2026-09-04T10:04:00.000Z",
        updatedAt: "2026-09-04T10:04:00.000Z",
      }],
      __runtimeVersion: 1,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };

    await repository.saveSnapshot(staleMaintenanceWriter, { selectedTables: ["commissions"] });

    const persisted = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    expect(persisted.commissionRecords[0]).toMatchObject({
      id: "commission-paid",
      paymentStatus: "paid",
      paymentVerificationStatus: "verified",
      paymentSignature: "a1".repeat(32),
      paymentExpectedAmount: 7.000001,
      paidAt: "2026-09-04T10:02:00.000Z",
    });
  });

  it("does not let stale overdue maintenance erase a pending TxID submission", async () => {
    const repository = new AlphaExchangeRepository(null);
    const baseline = await repository.loadSnapshot();
    const baseCommission = {
      id: "commission-pending-tx",
      purchaseRequestId: "request-pending-tx",
      listingId: "listing-pending-tx",
      sellerId: "seller-1",
      buyerId: "buyer-1",
      rate: 0.01,
      grossAmount: 700,
      commissionAmount: 7,
      createdAt: "2026-09-04T10:00:00.000Z",
    };
    const latestSnapshot = {
      ...baseline,
      commissionRecords: [{
        ...baseCommission,
        paymentStatus: "pending",
        paymentProvider: "crypto_wallet",
        paymentNetwork: "TRC20",
        recipientWalletAddress: "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8",
        paymentSignature: "b2".repeat(32),
        paymentSubmittedAt: "2026-09-04T10:02:00.000Z",
        paymentVerificationStatus: "pending_verification",
        paymentVerificationNotes: "Waiting for TRON finality.",
        paymentExpectedAmount: 7.000001,
        paymentExpectedAmountMode: "unique_v1",
        paymentExpectedAmountAssignedAt: "2026-09-04T10:01:00.000Z",
        updatedAt: "2026-09-04T10:02:00.000Z",
      }],
      __runtimeVersion: 2,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
    globalThis.__alphaExchangeMemorySnapshot = latestSnapshot as never;

    const staleMaintenanceWriter = {
      ...baseline,
      commissionRecords: [{
        ...baseCommission,
        paymentStatus: "overdue",
        overdueNotifiedAt: "2026-09-04T10:04:00.000Z",
        updatedAt: "2026-09-04T10:04:00.000Z",
      }],
      __runtimeVersion: 1,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };

    await repository.saveSnapshot(staleMaintenanceWriter, { selectedTables: ["commissions"] });

    const persisted = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    expect(persisted.commissionRecords[0]).toMatchObject({
      id: "commission-pending-tx",
      paymentStatus: "overdue",
      paymentSignature: "b2".repeat(32),
      paymentVerificationStatus: "pending_verification",
      paymentVerificationNotes: "Waiting for TRON finality.",
      paymentExpectedAmount: 7.000001,
    });
  });

  it("does not resurrect a stale paid row after a newer deliberate reversal", async () => {
    const repository = new AlphaExchangeRepository(null);
    const baseline = await repository.loadSnapshot();
    const baseCommission = {
      id: "commission-reversed",
      purchaseRequestId: "request-reversed",
      listingId: "listing-reversed",
      sellerId: "seller-1",
      buyerId: "buyer-1",
      rate: 0.01,
      grossAmount: 700,
      commissionAmount: 7,
      createdAt: "2026-09-04T10:00:00.000Z",
    };
    const latestSnapshot = {
      ...baseline,
      commissionRecords: [{
        ...baseCommission,
        paymentStatus: "pending",
        paymentVerificationStatus: "failed",
        paymentVerificationNotes: "Owner reversed an incorrect settlement.",
        updatedAt: "2026-09-04T10:05:00.000Z",
      }],
      __runtimeVersion: 2,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
    globalThis.__alphaExchangeMemorySnapshot = latestSnapshot as never;

    const staleWriter = {
      ...baseline,
      commissionRecords: [{
        ...baseCommission,
        paymentStatus: "paid",
        paymentVerificationStatus: "verified",
        paidAt: "2026-09-04T10:02:00.000Z",
        updatedAt: "2026-09-04T10:02:00.000Z",
      }],
      __runtimeVersion: 1,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };

    await repository.saveSnapshot(staleWriter, { selectedTables: ["commissions"] });

    const persisted = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    expect(persisted.commissionRecords[0]).toMatchObject({
      id: "commission-reversed",
      paymentStatus: "pending",
      paymentVerificationStatus: "failed",
      paymentVerificationNotes: "Owner reversed an incorrect settlement.",
    });
    expect(persisted.commissionRecords[0].paidAt).toBeUndefined();
  });

  it("runs a security validation against the canonical merged snapshot before a stale write can commit", async () => {
    const repository = new AlphaExchangeRepository(null);
    const baseline = await repository.loadSnapshot();
    const activeRequest: Record<string, unknown> = {
      id: "request-1",
      status: "accepted",
      listingId: "listing-1",
      sellerId: "seller-1",
      buyerId: "buyer-1",
      createdAt: "2026-08-22T10:00:00.000Z",
      updatedAt: "2026-08-22T10:00:00.000Z",
      messages: [],
    };
    const terminalSnapshot = {
      ...baseline,
      purchaseRequests: [{
        ...activeRequest,
        status: "completed",
        completedAt: "2026-08-22T10:01:00.000Z",
        updatedAt: "2026-08-22T10:01:00.000Z",
      }],
      notifications: [],
      __runtimeVersion: 2,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
    globalThis.__alphaExchangeMemorySnapshot = terminalSnapshot as never;

    const stalePokeCandidate = {
      ...baseline,
      purchaseRequests: [{
        ...activeRequest,
        messages: [{ id: "poke-message", kind: "system", message: "Buyer sent a reminder", createdAt: "2026-08-22T10:00:30.000Z" }],
        pokeState: { buyerToSellerAt: "2026-08-22T10:00:30.000Z" },
      }],
      notifications: [{ id: "poke-notification", userId: "seller-1" }],
      __runtimeVersion: 1,
    } as unknown as AlphaExchangeDb & { __runtimeVersion: number };

    await expect(repository.saveSnapshot(stalePokeCandidate, {
      selectedTables: ["purchase_requests", "notifications"],
      validateBeforeCommit: (canonicalSnapshot) => {
        expect(canonicalSnapshot.purchaseRequests[0]).toMatchObject({ status: "completed" });
        throw new Error("terminal trade cannot receive a Poke");
      },
    })).rejects.toThrow("terminal trade cannot receive a Poke");

    const persisted = globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
    expect(persisted.purchaseRequests[0]).toMatchObject({ status: "completed", messages: [] });
    expect(persisted.notifications).toHaveLength(0);
  });

  it("clears the in-flight store state after a failed save so the next write can proceed", async () => {
    const repository = {
      loadSnapshot: vi.fn().mockResolvedValue(createEmptyDb()),
      saveSnapshot: vi.fn()
        .mockRejectedValueOnce(new Error("save failed"))
        .mockResolvedValueOnce(undefined),
    };
    vi.mocked(getAlphaExchangeRepository).mockResolvedValue(repository as never);

    await expect(upsertUserProfileForAuth({
      fullName: "Test User",
      email: "test@example.com",
      whatsappNumber: "0501234567",
    })).rejects.toThrow("save failed");

    const createdUser = await upsertUserProfileForAuth({
      fullName: "Test User",
      email: "test@example.com",
      whatsappNumber: "0501234567",
    });

    expect(createdUser.email).toBe("test@example.com");
    expect(repository.saveSnapshot).toHaveBeenCalledTimes(2);
  });

  it("persists auth sessions via a single CTE pool.query (no manual client checkout)", async () => {
    // upsertAuthSession was refactored from a 5-step transaction (BEGIN/DELETE/SELECT MAX/INSERT/COMMIT)
    // to a single atomic CTE using pool.query(). The pg pool handles connection health internally,
    // so manual client checkout + release(true) retry is no longer needed.
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.upsertAuthSession({
      token: "session-token",
      userId: "user-1",
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    })).resolves.toBeUndefined();

    // pool.query should have been called with the CTE (no pool.connect needed)
    expect(pool.connect).not.toHaveBeenCalled();
    const calls = (pool.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]][];
    const cteCall = calls.find(([sql]) => typeof sql === "string" && sql.includes("WITH del AS"));
    expect(cteCall).toBeDefined();
    const cteArgs = (cteCall?.[1] as unknown[] | undefined) ?? [];
    expect(cteArgs[0]).toBe("user-1");
    expect(cteArgs[1]).toBe("session-token");
  });

  it("retries after an advisory lock timeout so saveSnapshot can continue", async () => {
    const advisoryTimeoutError = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const firstClient = {
      query: vi.fn()
        .mockResolvedValue({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(advisoryTimeoutError)
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    const secondClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.saveSnapshot(createEmptyDb())).resolves.toBeUndefined();

    expect(firstClient.release).toHaveBeenCalledWith(true);
    expect(firstClient.query.mock.calls.some(([sql]) => String(sql).startsWith("delete from"))).toBe(false);
    expect(secondClient.release).toHaveBeenCalledOnce();
  });

  it("retries a failed snapshot save with a fresh client after an aborted transaction", async () => {
    const firstClient = {
      query: vi.fn().mockRejectedValueOnce(new Error("current transaction is aborted, commands ignored until end of transaction block")),
      release: vi.fn(),
    };
    const secondClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.saveSnapshot(createEmptyDb())).resolves.toBeUndefined();

    expect(firstClient.release).toHaveBeenCalledWith(true);
    expect(secondClient.release).toHaveBeenCalled();
  });

  it.each(["lock", "write", "commit"])("discards a timed-out %s connection without queuing rollback or publishing an unconfirmed version", async (stage) => {
    const db = { ...createEmptyDb(), __runtimeVersion: 0 };
    const client = {
      query: vi.fn((sql: string) => {
        if ((stage === "lock" && sql.includes("pg_advisory_xact_lock"))
          || (stage === "write" && sql.startsWith("delete from"))
          || (stage === "commit" && sql === "commit")) return Promise.reject(new Error("Query read timeout"));
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const repository = new AlphaExchangeRepository({
      query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn().mockResolvedValue(client), on: vi.fn(),
    } as unknown as Pool);
    await expect(repository.saveSnapshot(db, { selectedTables: ["purchase_requests"] })).rejects.toThrow("Query read timeout");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(client.query.mock.calls.some(([sql]) => sql === "rollback")).toBe(false);
    expect(db.__runtimeVersion).toBe(0);
    if (stage === "lock") expect(client.query.mock.calls.some(([sql]) => sql.startsWith("delete from"))).toBe(false);
  });

  it("rebases a stale review using its declared tables and preserves other buyers' reviews", async () => {
    const requests = [
      { id: "target", status: "review_open", createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z" },
      { id: "other", buyerReview: { comment: "Already saved" }, createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:00.000Z" },
    ];
    const client = {
      query: vi.fn((sql: string) => {
        if (sql.includes("jsonb_agg")) return Promise.resolve({ rows: [{ version: "2", purchase_requests: requests }] });
        if (sql.includes("select version::text as version")) return Promise.resolve({ rows: [{ version: "2" }] });
        return Promise.resolve({ rows: [] });
      }), release: vi.fn(),
    };
    const repository = new AlphaExchangeRepository({
      query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn().mockResolvedValue(client), on: vi.fn(),
    } as unknown as Pool);
    const db = { ...createEmptyDb(), __runtimeVersion: 1 };
    await repository.saveSnapshot(db, {
      selectedTables: ["purchase_requests"],
      rebaseTables: ["purchase_requests", "users"],
      rebaseOnLatest: (snapshot) => {
        snapshot.purchaseRequests[0].buyerReview = { reviewerUserId: "buyer", rating: 5, comment: "Done", createdAt: "2026-09-21T00:00:00.000Z" };
        return snapshot;
      },
    });
    const sql = client.query.mock.calls.find(([query]) => query.includes("jsonb_agg"))?.[0] ?? "";
    expect(sql).toContain('as "purchase_requests"');
    expect(sql).not.toContain('as "sessions"');
    expect(sql).not.toContain('as "evidence"');
    expect(db.purchaseRequests[1].buyerReview?.comment).toBe("Already saved");
    expect(db.purchaseRequests[0].buyerReview?.comment).toBe("Done");
    expect(db.__runtimeVersion).toBe(3);
  });
});
