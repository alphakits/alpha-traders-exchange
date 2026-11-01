import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import { calculateSellerTrustSnapshot } from "@/lib/trust-engine";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

const NOW = "2026-10-31T12:00:00.000Z";

function fixture() {
  return {
    users: ["seller", "other"].map(id => ({ id, fullName: id, email: `${id}@example.test`, role: "approved_seller",
      sellerStatus: "approved_seller", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: NOW })),
    purchaseRequests: [
      { id: "bought", tradeId: "bought-trade", buyerId: "seller", sellerId: "other", status: "completed", usdtAmount: "500", createdAt: NOW, updatedAt: NOW },
      { id: "sold", buyerId: "other", sellerId: "seller", status: "completed", usdtAmount: "15000", createdAt: NOW, updatedAt: NOW },
      { id: "unrelated", buyerId: "another", sellerId: "other", status: "pending", usdtAmount: "100", createdAt: NOW, updatedAt: NOW },
    ],
    marketplaceEnforcementRecords: ["seller", "other"].map(sellerId => ({ id: `violation-${sellerId}`, sellerId,
      status: "active", appealStatus: "none", violationNumber: 1, feeAmount: 10, feeCurrency: "USDT",
      reason: "Documented marketplace violation", issuedByUserId: "owner", issuedAt: NOW, createdAt: NOW, updatedAt: NOW })),
    sellerReviews: [
      { id: "own-review", tradeId: "bought-trade", buyerId: "seller", sellerId: "other", rating: 5 },
      { id: "other-review", tradeId: "sold", buyerId: "other", sellerId: "seller", rating: 4 },
      { id: "orphan-review", tradeId: "missing", buyerId: "seller", sellerId: "other", rating: 5 },
    ],
    sellerApplications: [], marketplaceListings: [], commissionRecords: [], auditLogs: [], authSessions: [],
    passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [],
    trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [],
    betaAnnouncements: [], adminAnnouncementRuns: [], __runtimeVersion: 3,
  } as unknown as AlphaExchangeDb;
}

beforeEach(() => {
  vi.stubEnv("ALPHA_EXCHANGE_TEST_PERSIST_FALLBACK", "0");
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.__alphaExchangeMemorySnapshot = undefined as never;
  globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
});

describe("account profile reputation dependencies", () => {
  it.each(["memory", "postgres"] as const)("keeps a seller's private trust consistent with canonical enforcement (%s)", async mode => {
    const source = fixture();
    globalThis.__alphaExchangeMemorySnapshot = source as never;
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(values).toEqual(["seller"]);
      expect(sql).toContain("from alpha_exchange.marketplace_enforcement_records where seller_id = $1");
      return { rows: [{ version: "3", users: source.users.slice(0, 1), purchase_requests: source.purchaseRequests.slice(0, 2),
        marketplace_enforcement_records: source.marketplaceEnforcementRecords!.slice(0, 1) }] };
    });
    const pool = { query, connect: vi.fn(), on: vi.fn() } as unknown as Pool;
    const repository = new AlphaExchangeRepository(mode === "memory" ? null : pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
    const scoped = await repository.loadAccountProfileSnapshotForUser("seller");
    expect(scoped.users.map(user => user.id)).toEqual(["seller"]);
    expect(scoped.purchaseRequests.map(request => request.id)).toEqual(["bought", "sold"]);
    expect(scoped.marketplaceEnforcementRecords?.map(record => record.id)).toEqual(["violation-seller"]);
    const reputation = (snapshot: AlphaExchangeDb, omitEnforcement = false) => calculateSellerTrustSnapshot({
      now: Date.parse(NOW), seller: snapshot.users[0], listings: [], commissions: [],
      requests: snapshot.purchaseRequests.filter(request => request.sellerId === "seller"),
      enforcementRecords: omitEnforcement ? [] : snapshot.marketplaceEnforcementRecords,
    });
    expect(reputation(scoped).trustScore).toBe(reputation(source).trustScore);
    expect(reputation(scoped).marketplaceViolations).toBe(1);
    expect(reputation(scoped).trustScore).toBeLessThan(reputation(scoped, true).trustScore);
    if (mode === "memory") expect(scoped.sellerReviews.map(review => review.id)).toEqual(["own-review"]);
    else expect(query).toHaveBeenCalledTimes(1);
  });
});
