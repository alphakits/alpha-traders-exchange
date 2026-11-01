import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

const CREATED = "2026-10-31T12:00:00.000Z";
const RECORDED = "2026-11-01T12:00:00.000Z";
const LATER = "2026-11-01T12:05:00.000Z";

function fixture() {
  const request = { id: "credited-request", tradeId: "trade", listingId: "listing", buyerId: "buyer", sellerId: "seller",
    buyerName: "Buyer", status: "completed", usdtAmount: "14672.940267", fiatAmount: "46953.41", pricePerUsdt: "3.2",
    currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", timeline: [], messages: [],
    completedAt: CREATED, createdAt: CREATED, updatedAt: RECORDED,
    buyerVolumeCredit: { source: "owner_attestation", operationId: "owner-buyer-credit", inputFingerprint: "a".repeat(64),
      recordedAt: RECORDED, recordedByUserId: "owner", requestId: "credited-request", reason: "Owner confirmed the buyer's full purchase volume",
      buyerId: "buyer", settledUsdtAmount: "14672.940267", creditedUsdtAmount: "15000" },
  };
  const canonical = { users: [], purchaseRequests: [request], marketplaceListings: [], commissionRecords: [],
    auditLogs: [{ id: "credit-audit", action: "admin_override", purchaseRequestId: request.id, createdAt: RECORDED }],
    sellerApplications: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [],
    sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [],
    privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
    __runtimeVersion: 2,
  } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
  const incoming = structuredClone(canonical);
  incoming.__runtimeVersion = 1;
  incoming.purchaseRequests[0].buyerVolumeCredit = undefined;
  incoming.purchaseRequests[0].updatedAt = LATER;
  return { canonical, incoming };
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

describe("owner-attested buyer credit persistence", () => {
  it.each(["memory", "postgres"] as const)("keeps the correction through a later stale writer without changing settlement (%s)", async mode => {
    const { canonical, incoming } = fixture();
    const credit = structuredClone(canonical.purchaseRequests[0].buyerVolumeCredit);
    incoming.purchaseRequests[0].status = "cancelled";
    incoming.purchaseRequests[0].buyerId = "another-buyer";
    incoming.purchaseRequests[0].usdtAmount = "1";
    incoming.purchaseRequests[0].completedAt = undefined;
    incoming.purchaseRequests[0].messages = [{ id: "later-message", purchaseRequestId: "credited-request", kind: "user",
      senderUserId: "buyer", senderRole: "buyer", message: "New message", createdAt: LATER, readByUserIds: [] }];
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.includes("json_agg(payload order by sort_index asc)")) return { rows: [{ version: "2",
        purchase_requests: canonical.purchaseRequests, audit_logs: canonical.auditLogs }] };
      if (sql.includes("select version::text as version from alpha_exchange.runtime_meta")) return { rows: [{ version: "2" }] };
      return { rows: [] };
    }), release: vi.fn() };
    const pool = { query: vi.fn(), connect: vi.fn().mockResolvedValue(client), on: vi.fn() } as unknown as Pool;
    globalThis.__alphaExchangeMemorySnapshot = structuredClone(canonical) as never;
    const repository = new AlphaExchangeRepository(mode === "memory" ? null : pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
    await repository.saveSnapshot(incoming, { selectedTables: ["purchase_requests", "audit_logs"] });
    expect(incoming.purchaseRequests[0]).toMatchObject({ buyerVolumeCredit: credit, status: "completed", buyerId: "buyer",
      usdtAmount: "14672.940267", fiatAmount: "46953.41", completedAt: CREATED });
    expect(incoming.purchaseRequests[0].messages).toHaveLength(1);
    expect(incoming.purchaseRequests[0].messages?.[0].message).toBe("New message");
    expect(incoming.auditLogs).toEqual(canonical.auditLogs);
    expect(incoming.commissionRecords).toEqual([]);
    expect(incoming.marketplaceListings).toEqual([]);
    if (mode === "postgres") expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("keeps a later legitimate buyer review while pinning the credit's trade and amount", async () => {
    const { canonical, incoming } = fixture();
    incoming.purchaseRequests[0].buyerVolumeCredit = structuredClone(canonical.purchaseRequests[0].buyerVolumeCredit);
    incoming.purchaseRequests[0].status = "review_open";
    incoming.purchaseRequests[0].buyerReview = { reviewerUserId: "buyer", rating: 5, comment: "Completed purchase", createdAt: LATER };
    incoming.purchaseRequests[0].buyerId = "stale-buyer";
    incoming.purchaseRequests[0].usdtAmount = "15000";
    globalThis.__alphaExchangeMemorySnapshot = canonical as never;
    await new AlphaExchangeRepository(null).saveSnapshot(incoming);
    expect(incoming.purchaseRequests[0]).toMatchObject({ status: "review_open", buyerId: "buyer", usdtAmount: "14672.940267",
      buyerVolumeCredit: canonical.purchaseRequests[0].buyerVolumeCredit, buyerReview: { rating: 5, comment: "Completed purchase" } });
  });

  it("does not accept a replacement attestation from a stale snapshot", async () => {
    const { canonical, incoming } = fixture();
    incoming.purchaseRequests[0].buyerVolumeCredit = { ...canonical.purchaseRequests[0].buyerVolumeCredit!, creditedUsdtAmount: "500000" };
    globalThis.__alphaExchangeMemorySnapshot = canonical as never;
    await new AlphaExchangeRepository(null).saveSnapshot(incoming);
    expect(incoming.purchaseRequests[0].buyerVolumeCredit).toEqual(canonical.purchaseRequests[0].buyerVolumeCredit);
  });
});
