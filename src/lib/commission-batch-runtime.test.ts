// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
const mocks = vi.hoisted(() => ({ binance: vi.fn(), bep20: vi.fn(), tron: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/commission-deposit-discovery", () => ({ verifyBinanceInternalCommissionDeposit: mocks.binance }));
vi.mock("@/lib/bep20-commission-verifier", () => ({ verifyBep20Commission: mocks.bep20 }));
vi.mock("@/lib/commission-batch-tron-verifier", () => ({ verifyCommissionBatchTronReceipt: mocks.tron }));
import { getCommissionBatchRuntime } from "./commission-batch-runtime";
import { getSellerCommissionStatus, invalidateAlphaExchangeStoreCache } from "./alpha-exchange-store";
const signature = "binance-deposit:123456789123456789";
function seed() {
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  return { __runtimeVersion: 0, users: [
    { id: "owner", fullName: "Owner", email: "owner@example.test", role: "owner", roles: ["owner", "admin"], createdAt, updatedAt: createdAt },
    { id: "seller", fullName: "Seller", email: "seller@example.test", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", createdAt, updatedAt: createdAt, notificationPreferences: { inApp: true, email: false } },
  ], commissionRecords: [18.3, 20].map((commissionAmount, index) => ({ id: `cm${index}`, sellerId: "seller", rate: 0.01, grossAmount: commissionAmount * 100, commissionAmount, paymentStatus: "pending", createdAt, updatedAt: createdAt,
    paymentExpectedAmount: commissionAmount + 0.000001, paymentExpectedAmountMode: "unique_v1", paymentExpectedAmountAssignedAt: createdAt })),
    marketplaceListings: [], purchaseRequests: [], auditLogs: [], notifications: [], authSessions: [], activityLog: [], passwordResetTokens: [], sellerApplications: [],
    disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], tradeMessages: [], privateBetaInvites: [], privateBetaInviteUses: [],
    betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], smsDeliveries: [], marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [],
  } as unknown as AlphaExchangeDb;
}
const input = { actorUserId: "owner", sellerId: "seller", commissionIds: ["cm0", "cm1"], signature, network: "BEP20" as const };
const payment = () => ({ signature, network: "BEP20" as const, amountMicros: 38_000_000, timestamp: Date.now() - 1000 });
beforeEach(() => { vi.stubEnv("ALPHA_EXCHANGE_COMMISSION_BATCH_V1", "0"); vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "1");
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  globalThis.__alphaExchangeMemorySnapshot = seed() as never; invalidateAlphaExchangeStoreCache();
  vi.clearAllMocks(); mocks.binance.mockResolvedValue({ verified: true, pending: false });
});
afterEach(() => { vi.unstubAllEnvs(); });
describe("actual repository and batch runtime", () => {
  it("settles an attributed 38 payment against 38.30 through the actual repository and clears the seller's dues", async () => {
    expect((await getSellerCommissionStatus("seller")).status).not.toBe("clear");
    const runtime = await getCommissionBatchRuntime(); await runtime.approve(input);
    const result = await runtime.reconcile({ deposits: [payment()], deadline: Date.now() + 60_000 });
    expect(result.verified).toBe(1); expect((await getSellerCommissionStatus("seller")).status).toBe("clear");
    expect(mocks.binance).toHaveBeenCalledWith(expect.objectContaining({ amount: 38, signature }));
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.commissionRecords.map((record) => record.commissionAmount)).toEqual([18.3, 20]);
    expect(snapshot.commissionRecords.every((record) => record.paymentConfirmationEmailPending && record.paymentStatus === "paid")).toBe(true);
    expect(snapshot.notifications.filter((item) => item.reason === "commission_payment_verified")).toHaveLength(1);
  });
  it("concurrent runtime workers do not settle or notify twice", async () => {
    const runtime = await getCommissionBatchRuntime(); await runtime.approve(input);
    await Promise.all([runtime.reconcile({ deposits: [payment()], deadline: Date.now() + 60_000 }), runtime.reconcile({ deposits: [payment()], deadline: Date.now() + 60_000 })]);
    const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(snapshot.notifications.filter((item) => item.reason === "commission_payment_verified")).toHaveLength(1);
    expect(snapshot.auditLogs.filter((entry) => entry.action === "commission_paid")).toHaveLength(1);
  });
  it("independent receipt verification still blocks settlement after owner association", async () => {
    mocks.binance.mockResolvedValue({ verified: false, pending: true }); const runtime = await getCommissionBatchRuntime(); await runtime.approve(input);
    const result = await runtime.reconcile({ deposits: [payment()], deadline: Date.now() + 60_000 }); expect(result.verified).toBe(0);
    expect((await getSellerCommissionStatus("seller")).status).not.toBe("clear");
  });
  it("does not rewrite the owner, seller, active sessions or listings", async () => {
    const before = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    const saved = JSON.stringify({ users: before.users, sessions: before.authSessions, listings: before.marketplaceListings });
    const runtime = await getCommissionBatchRuntime(); await runtime.approve(input); await runtime.reconcile({ deposits: [payment()], deadline: Date.now() + 60_000 });
    const after = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
    expect(JSON.stringify({ users: after.users, sessions: after.authSessions, listings: after.marketplaceListings })).toBe(saved);
  });
  it("an unidentified rounded receipt does not guess an owner or seller", async () => {
    const runtime = await getCommissionBatchRuntime(); const result = await runtime.reconcile({ deposits: [payment()], deadline: Date.now() + 60_000 });
    expect(result.verified).toBe(0); expect(mocks.binance).not.toHaveBeenCalled();
  });
  it("refuses release activation without durable guards", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_COMMISSION_BATCH_V1", "1"); await expect(getCommissionBatchRuntime()).rejects.toThrow("durable PostgreSQL");
  });
});
