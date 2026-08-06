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

const TEST_FALLBACK_DIR = `.next-runtime-test${process.env.VITEST_WORKER_ID ? `-${process.env.VITEST_WORKER_ID}` : ""}`;

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

  it("prefers a newer persisted fallback snapshot over stale in-memory state after a load failure", async () => {
    const fallbackPath = path.join(process.cwd(), TEST_FALLBACK_DIR, "alpha-exchange-fallback.json");
    globalThis.__alphaExchangeMemorySnapshot = {
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
      sellerReviews: [],
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

    expect(fallback.marketplaceListings).toEqual([expect.objectContaining({ id: "listing-persisted", availableAmount: "750" })]);
    expect(fallback.purchaseRequests).toEqual([expect.objectContaining({ id: "purchase-1", status: "review_open" })]);
    expect((fallback as AlphaExchangeDb & { __runtimeVersion?: number }).__runtimeVersion).toBe(12);
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
      users: [{ id: "user-1", email: "user@example.com", role: "buyer", roles: ["buyer"], sellerStatus: "buyer", availabilityStatus: "available", onlineStatus: "online", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never],
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
      sellerReviews: [],
    })).resolves.toBeUndefined();

    const sessionInserts = client.query.mock.calls
      .filter(([sql]) => typeof sql === "string" && sql.toLowerCase().includes("insert into alpha_exchange.sessions"));
    expect(sessionInserts).toHaveLength(1);
    expect(sessionInserts[0]?.[1][0]).toEqual(expect.arrayContaining(["good-token"]));
    expect(sessionInserts[0]?.[1][1]).toEqual(expect.arrayContaining(["user-1"]));
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
      users: [{ id: "user-1", email: "user@example.com", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", availabilityStatus: "available", onlineStatus: "online", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never],
      sellerApplications: [],
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
      sellerReviews: [],
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

    await expect(repository.saveSnapshot({
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
      sellerReviews: [],
    })).resolves.toBeUndefined();

    expect(globalThis.__alphaExchangeMemorySnapshot).toBeDefined();
  });

  it("coalesces stale snapshot writes by preserving the latest state instead of throwing", async () => {
    const repository = new AlphaExchangeRepository(null);
    const baseline = await repository.loadSnapshot();
    const baselineSnapshot = baseline as AlphaExchangeDb & { __runtimeVersion?: number };
    baselineSnapshot.__runtimeVersion = 2;
    baselineSnapshot.purchaseRequests = [{ id: "request-1", status: "accepted", listingId: "listing-1", sellerId: "seller-1", buyerId: "buyer-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never];
    globalThis.__alphaExchangeMemorySnapshot = baselineSnapshot as never;

    const staleDb = {
      users: [],
      sellerApplications: [],
      marketplaceListings: [],
      purchaseRequests: [{ id: "request-2", status: "pending", listingId: "listing-1", sellerId: "seller-1", buyerId: "buyer-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
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
      __runtimeVersion: 1,
    } as unknown as AlphaExchangeDb;

    await expect(repository.saveSnapshot(staleDb)).resolves.toBeUndefined();
    const savedSnapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb & { __runtimeVersion?: number };
    expect(savedSnapshot.__runtimeVersion).toBe(3);
    expect(savedSnapshot.purchaseRequests).toEqual(expect.arrayContaining([expect.objectContaining({ id: "request-1" }), expect.objectContaining({ id: "request-2" })]));
  });

  it("clears the in-flight store state after a failed save so the next write can proceed", async () => {
    const repository = {
      loadSnapshot: vi.fn().mockResolvedValue({
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
        sellerReviews: [],
      }),
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
    expect(cteCall![1][0]).toBe("user-1");
    expect(cteCall![1][1]).toBe("session-token");
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

    await expect(repository.saveSnapshot({
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
      sellerReviews: [],
    })).resolves.toBeUndefined();

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

    await expect(repository.saveSnapshot({
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
      sellerReviews: [],
    })).resolves.toBeUndefined();

    expect(firstClient.release).toHaveBeenCalledWith(true);
    expect(secondClient.release).toHaveBeenCalled();
  });
});
