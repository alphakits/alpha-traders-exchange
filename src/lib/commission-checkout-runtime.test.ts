// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
const mocks = vi.hoisted(() => ({ pool: vi.fn(), binance: vi.fn(), tron: vi.fn(), bep20: vi.fn(), scanBinance: vi.fn(), scanTron: vi.fn(), scanBsc: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: mocks.pool }));
vi.mock("@/lib/commission-deposit-discovery", () => ({ verifyBinanceInternalCommissionDeposit: mocks.binance,
  scanBinanceCommissionDeposits: mocks.scanBinance, scanTronCommissionDeposits: mocks.scanTron, scanBep20CommissionDeposits: mocks.scanBsc }));
vi.mock("@/lib/bep20-commission-verifier", () => ({ verifyBep20Commission: mocks.bep20 }));
vi.mock("@/lib/commission-batch-tron-verifier", () => ({ verifyCommissionBatchTronReceipt: mocks.tron }));
import { getAlphaExchangeRepository } from "./alpha-exchange-repository";
import { getSellerCommissionStatus, invalidateAlphaExchangeStoreCache } from "./alpha-exchange-store";
import { getCommissionCheckoutRuntime } from "./commission-checkout-runtime";
const signature = "binance-deposit:123456789123456789";
function seed() {
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  return { __runtimeVersion: 0, users: [
    { id: "seller", fullName: "Seller", email: "seller@example.test", role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", createdAt, updatedAt: createdAt, notificationPreferences: { inApp: true, email: false } },
  ], commissionRecords: [18.3, 20].map((commissionAmount, index) => ({ id: `cm${index}`, sellerId: "seller", rate: 0.01, grossAmount: commissionAmount * 100, commissionAmount, paymentStatus: "pending", createdAt, updatedAt: createdAt,
    paymentExpectedAmount: commissionAmount + 0.000001, paymentExpectedAmountMode: "unique_v1", paymentExpectedAmountAssignedAt: createdAt })),
    marketplaceListings: [], purchaseRequests: [], auditLogs: [], notifications: [], authSessions: [], activityLog: [], passwordResetTokens: [], sellerApplications: [],
    disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], tradeMessages: [], privateBetaInvites: [], privateBetaInviteUses: [],
    betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], smsDeliveries: [], marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [],
  } as unknown as AlphaExchangeDb;
}
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv("ALPHA_EXCHANGE_COMMISSION_CHECKOUT_V1", "1"); vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "1");
  globalThis.__alphaExchangeRepositoryPromise = undefined as never; globalThis.__alphaExchangeMemorySnapshot = seed() as never; invalidateAlphaExchangeStoreCache();
  // Initialize the actual repository's isolated memory adapter, then separately
  // mock only the checkout schema-readiness query. No live SQL/provider is used.
  mocks.pool.mockReturnValue(null); const repository = await getAlphaExchangeRepository(); await repository.loadSnapshot();
  mocks.pool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [{ ready: true }] }) });
  mocks.binance.mockResolvedValue({ verified: true, pending: false });
  for (const scan of [mocks.scanBinance, mocks.scanTron, mocks.scanBsc]) scan.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [] });
});
afterEach(() => vi.unstubAllEnvs());
async function prepared() {
  const service = await getCommissionCheckoutRuntime(); const checkout = await service.issue({ sellerId: "seller", network: "BEP20", desiredAmount: "38" });
  const payment = { signature, network: "BEP20" as const, amountMicros: checkout.expectedMicros, timestamp: Date.parse(checkout.createdAt) + 1 };
  return { service, checkout, payment };
}
it("actual repository persists owner-free 38 for 38.30 and clears canonical seller dues", async () => {
  const { service, payment } = await prepared(); expect((await getSellerCommissionStatus("seller")).status).not.toBe("clear");
  expect((await service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 })).verified).toBe(1);
  expect((await getSellerCommissionStatus("seller")).status).toBe("clear");
  expect(mocks.binance).toHaveBeenCalledWith(expect.objectContaining({ amount: 38, signature }));
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  expect(snapshot.commissionRecords.map((record) => record.commissionAmount)).toEqual([18.3,20]);
  expect(snapshot.users).toHaveLength(1); expect(snapshot.users[0].role).toBe("approved_seller");
  expect(snapshot.notifications.filter((row) => row.reason === "commission_payment_verified")).toHaveLength(1);
  expect(snapshot.commissionRecords.every((row) => row.paymentConfirmationEmailPending)).toBe(true);
});
it("concurrent repository workers cannot notify or credit the checkout twice", async () => {
  const { service, payment } = await prepared(); await Promise.all([service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 }), service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 })]);
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  expect(snapshot.notifications.filter((row) => row.reason === "commission_payment_verified")).toHaveLength(1);
  expect(snapshot.auditLogs.filter((row) => row.action === "commission_paid")).toHaveLength(1);
});
it("complete Binance history covers BSC index failure and independently verifies the receipt", async () => {
  const { service, payment } = await prepared(); mocks.scanBsc.mockRejectedValue(Error("bep20_index_plan_unsupported")); mocks.scanBinance.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  const result = await service.scan(Date.now() + 60_000); expect(result.complete).toBe(true); expect(result.verified).toBe(1); expect(mocks.binance).toHaveBeenCalledOnce();
});
it("incomplete receiving history is not labeled complete", async () => {
  const { service } = await prepared(); mocks.scanBsc.mockRejectedValue(Error("bep20_index_plan_unsupported")); mocks.scanBinance.mockResolvedValue({ configured: true, complete: false, pages: 5, deposits: [] });
  expect((await service.scan(Date.now() + 60_000)).complete).toBe(false);
});
it("provider finality wait keeps debt unpaid without owner action", async () => {
  const { service, payment } = await prepared(); mocks.binance.mockResolvedValue({ verified: false, pending: true });
  const result = await service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 }); expect(result.verified).toBe(0); expect(result.pending).toBe(1);
  expect((await getSellerCommissionStatus("seller")).status).not.toBe("clear");
});
it("absent or disabled database guards stop activation", async () => {
  mocks.pool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [{ ready: false }] }) });
  await expect(getCommissionCheckoutRuntime()).rejects.toThrow("guards");
});
