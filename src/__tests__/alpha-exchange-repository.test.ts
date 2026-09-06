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
import { upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";

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
      ["alpha_exchange.idx_alpha_exchange_marketplace_enforcement_audit_seller_created"],
    );
    expect(query.mock.calls.some(([sql]) => String(sql).includes("create schema"))).toBe(false);
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
        if (queryText.includes("select version::text as version from alpha_exchange.runtime_meta")) {
          return Promise.resolve({ rows: [{ version: "7" }] });
        }
        if (queryText.includes("from alpha_exchange.users")) {
          return Promise.resolve({ rows: [{ payload: { id: "seller-1", email: "seller@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" } }] });
        }
        if (queryText.includes("from alpha_exchange.listings")) {
          return Promise.resolve({ rows: [{ payload: listing }] });
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
        if (queryText.includes("select version::text as version from alpha_exchange.runtime_meta")) {
          return Promise.resolve({ rows: [{ version: "9" }] });
        }
        if (queryText.includes("from alpha_exchange.users")) {
          return Promise.resolve({ rows: [{ payload: { id: "seller-1", email: "seller@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" } }] });
        }
        if (queryText.includes("from alpha_exchange.listings")) {
          return Promise.resolve({ rows: [{ payload: listing }] });
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

    expect(firstClient.release).toHaveBeenCalled();
    expect(secondClient.release).not.toHaveBeenCalled();
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
});
