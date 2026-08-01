import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("AlphaExchangeRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAlphaExchangeRepository).mockReset();
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

  it("retries an aborted transaction with a fresh client so auth sessions still persist", async () => {
    const firstClient = {
      query: vi.fn().mockRejectedValueOnce(new Error("current transaction is aborted, commands ignored until end of transaction block")),
      release: vi.fn(),
    };
    const secondClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ next_index: "0" }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] }),
      release: vi.fn(),
    };
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValueOnce(firstClient).mockResolvedValueOnce(secondClient),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.upsertAuthSession({
      token: "session-token",
      userId: "user-1",
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    })).resolves.toBeUndefined();

    expect(firstClient.release).toHaveBeenCalledWith(true);
    expect(secondClient.release).toHaveBeenCalled();
  });

  it("retries after an advisory lock timeout so saveSnapshot can continue", async () => {
    const firstClient = {
      query: vi.fn()
        .mockResolvedValue({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }))
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
