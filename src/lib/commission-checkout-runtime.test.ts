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
import { getSellerCommissionStatus, getSellerListingWorkspaceData, invalidateAlphaExchangeStoreCache, updateCommissionPaymentStatus } from "./alpha-exchange-store";
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function prepared() {
  const service = await getCommissionCheckoutRuntime(); const checkout = await service.issue({ sellerId: "seller", network: "BEP20", desiredAmount: "38" });
  const payment = { signature, network: "BEP20" as const, amountMicros: checkout.expectedMicros, timestamp: Date.parse(checkout.createdAt) + 1 };
  return { service, checkout, payment };
}
it.each(["TRC20", "BEP20"] as const)("automatically settles a full 40 USDT net receipt on %s once, after finality, without charging the sender's fee again", async (network) => {
  const initial = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  initial.commissionRecords = [{ ...initial.commissionRecords[0], commissionAmount: 40, paymentExpectedAmount: 40.000001 }];
  const service = await getCommissionCheckoutRuntime();
  const checkout = await service.issue({ sellerId: "seller", network });
  expect(checkout.expectedMicros).toBe(40_000_000);
  // Providers prove the net transfer to the platform; the sender's fee is
  // external to the commission and must not become a second amount owed.
  const payment = { signature: network === "TRC20" ? "f".repeat(64) : `0x${"f".repeat(64)}`,
    network, amountMicros: 40_000_000, timestamp: Date.parse(checkout.createdAt) + 1 };
  const scanner = network === "TRC20" ? mocks.scanTron : mocks.scanBsc;
  const verifier = network === "TRC20" ? mocks.tron : mocks.bep20;
  scanner.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  verifier.mockResolvedValue({ verified: false, pending: true });
  expect(await service.scan(Date.now() + 60_000)).toMatchObject({ verified: 0, pending: 1 });
  expect((await getSellerCommissionStatus("seller")).pendingCount).toBe(1);

  verifier.mockResolvedValue({ verified: true, pending: false });
  const reloaded = await getCommissionCheckoutRuntime();
  const outcomes = await Promise.all([reloaded.scan(Date.now() + 60_000), service.scan(Date.now() + 60_000)]);
  expect(outcomes.reduce((sum, result) => sum + result.verified, 0)).toBe(1);
  expect(await reloaded.state("seller")).toMatchObject({ status: "paid", pendingCount: 0, totalDueUsdt: 0 });
  const final = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  expect(final.commissionRecords[0]).toMatchObject({ commissionAmount: 40, paymentStatus: "paid",
    paymentBatchSettlement: { receivedMicros: 40_000_000, excessMicros: 0, waivedMicros: 0 } });
  expect(final.notifications.filter((row) => row.reason === "commission_payment_verified")).toHaveLength(1);
  expect((await reloaded.scan(Date.now() + 60_000)).verified).toBe(0);
});
it("switches a mistaken TRC20 choice to BEP20, survives reload, and clears restrictions after automatic verification", async () => {
  const service = await getCommissionCheckoutRuntime();
  const original = await service.issue({ sellerId: "seller", network: "TRC20", desiredAmount: "38" });
  const updated = await service.issue({ sellerId: "seller", network: "BEP20", currentCheckoutId: original.id });
  expect(updated.network).toBe("BEP20"); expect(updated.commissions).toEqual(original.commissions);
  const reloaded = await getCommissionCheckoutRuntime();
  expect(await reloaded.state("seller")).toMatchObject({ status: "waiting", canChangeNetwork: true, checkout: { id: updated.id, network: "BEP20" } });
  mocks.scanBsc.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [{
    signature: `0x${"d".repeat(64)}`, network: "BEP20", amountMicros: updated.expectedMicros, timestamp: Date.parse(updated.createdAt) + 1,
  }] });
  mocks.bep20.mockResolvedValue({ verified: true });
  expect((await reloaded.scan(Date.now() + 60_000)).verified).toBe(1);
  expect(await getSellerListingWorkspaceData({ sellerId: "seller" })).toMatchObject({
    commissionStatus: { status: "clear", pendingCount: 0 }, summary: { canCreateListing: true },
  });
  expect((await reloaded.scan(Date.now() + 60_000)).verified).toBe(0);
});
it.each(["TRC20", "BEP20"] as const)("an unsubmitted overdue reset remains payable and automatically settles on %s", async (network) => {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  const createdAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
  snapshot.commissionRecords = [{ ...snapshot.commissionRecords[0], createdAt, updatedAt: createdAt,
    dueAt: new Date(Date.now() - 86_400_000).toISOString(), paymentStatus: "overdue" }];
  await updateCommissionPaymentStatus({ commissionId: "cm0", actorUserId: "owner",
    paymentStatus: "overdue", paymentVerificationStatus: "pending_verification",
    paymentVerificationNotes: "Commission reset to pending." });
  const before = await getSellerListingWorkspaceData({ sellerId: "seller" });
  expect(before.commissionStatus).toMatchObject({ status: "overdue", pendingCount: 1 });
  expect(before.commissionStatus.payableRecords[0].paymentVerificationStatus).toBeUndefined();
  expect(before.summary.canCreateListing).toBe(false);

  const service = await getCommissionCheckoutRuntime();
  const checkout = await service.issue({ sellerId: "seller", network });
  const payment = { signature: network === "TRC20" ? "c".repeat(64) : `0x${"c".repeat(64)}`,
    network, amountMicros: checkout.expectedMicros, timestamp: Date.parse(checkout.createdAt) + 1 };
  const verifier = network === "TRC20" ? mocks.tron : mocks.bep20;
  const scanner = network === "TRC20" ? mocks.scanTron : mocks.scanBsc;
  verifier.mockResolvedValue({ verified: false, pending: true });
  scanner.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  expect(await service.scan(Date.now() + 60_000)).toMatchObject({ pending: 1 });
  expect((await getSellerCommissionStatus("seller")).status).toBe("overdue");
  verifier.mockResolvedValue({ verified: true, pending: false });
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(1);
  expect(await getSellerListingWorkspaceData({ sellerId: "seller" })).toMatchObject({
    commissionStatus: { status: "clear", pendingCount: 0 },
    summary: { pendingCommissionCount: 0, canCreateListing: true },
  });
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(0);
  expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).commissionRecords[0]).toMatchObject({
    commissionAmount: 18.3, paymentStatus: "paid", paymentVerificationStatus: "verified", paymentSignature: payment.signature,
  });
});
it.each(["approved_seller", "suspended"] as const)("an existing checkout survives becoming overdue for a %s account", async (sellerStatus) => {
  const { service, checkout, payment } = await prepared();
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  Object.assign(snapshot.users[0], { sellerStatus, role: sellerStatus === "suspended" ? "buyer" : "approved_seller",
    roles: [sellerStatus === "suspended" ? "buyer" : "approved_seller"] });
  for (const record of snapshot.commissionRecords) Object.assign(record, {
    paymentStatus: "overdue", dueAt: new Date(Date.now() - 60_000).toISOString(),
  });
  expect(await service.state("seller")).toMatchObject({ status: "waiting", checkout: { id: checkout.id }, pendingCount: 2 });
  expect((await service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 })).verified).toBe(1);
  expect((await getSellerCommissionStatus("seller")).status).toBe("clear");
  expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).users[0].sellerStatus).toBe(sellerStatus);
});
it("reads checkout status and scheduled scans without downloading unrelated platform history", async () => {
  const { service, checkout } = await prepared();
  const repository = await getAlphaExchangeRepository();
  const canonical = await repository.loadSnapshot();
  const projected = { ...seed(), users: canonical.users, commissionRecords: canonical.commissionRecords, auditLogs: canonical.auditLogs };
  const read = vi.spyOn(repository, "loadSelectedSnapshot").mockResolvedValue(projected);
  const fullRead = vi.spyOn(repository, "loadSnapshot").mockRejectedValue(new Error("Unrelated history must not be loaded"));
  const write = vi.spyOn(repository, "saveSnapshot");

  await expect(service.state("seller")).resolves.toMatchObject({ status: "waiting", checkout: { id: checkout.id }, pendingCount: 2 });
  await expect(service.scan(Date.now() + 60_000)).resolves.toMatchObject({ pendingCheckouts: 1, verified: 0, complete: true });
  expect(read).toHaveBeenCalledWith(["commissions", "audit_logs"]);
  expect(read).toHaveBeenCalledWith(["users", "commissions", "audit_logs"]);
  expect(fullRead).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
it("an idle scheduled scan avoids full snapshots and provider calls", async () => {
  const repository = await getAlphaExchangeRepository();
  const read = vi.spyOn(repository, "loadSelectedSnapshot").mockResolvedValue({ ...seed(), users: [] });
  const fullRead = vi.spyOn(repository, "loadSnapshot").mockRejectedValue(new Error("Unrelated history must not be loaded"));
  const service = await getCommissionCheckoutRuntime();

  await expect(service.scan(Date.now() + 60_000)).resolves.toMatchObject({ pendingCheckouts: 0, scanned: 0, complete: true });
  expect(read).toHaveBeenCalledExactlyOnceWith(["commissions", "audit_logs"]);
  expect(fullRead).not.toHaveBeenCalled();
  for (const scan of [mocks.scanBinance, mocks.scanTron, mocks.scanBsc]) expect(scan).not.toHaveBeenCalled();
});
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
it.each(["TRC20", "BEP20"] as const)("shows 100 + 2 = 102, carries a repeated shortfall once, then clears it on full receipt (%s)", async network => {
  let clock = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const initial = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  initial.commissionRecords = [{ ...initial.commissionRecords[0], commissionAmount: 100, paymentExpectedAmount: 100.000001 }];
  const amountsReceived = [98, 100, 102];
  for (let cycle = 0; cycle < amountsReceived.length; cycle++) {
    clock += 1000;
    if (cycle) {
      const current = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
      const createdAt = new Date(clock).toISOString();
      current.commissionRecords.push({ id: `new-100-${cycle}`, sellerId: "seller", rate: .01, grossAmount: 10_000,
        commissionAmount: 100, paymentStatus: "pending", createdAt, updatedAt: createdAt });
    }
    const service = await getCommissionCheckoutRuntime();
    const due = cycle ? 102 : 100;
    expect(await service.state("seller")).toMatchObject({ totalDueUsdt: due, carriedShortfallUsdt: 0,
      amountBreakdown: { commissionsUsdt: 100, previousPaymentBalanceUsdt: cycle ? 2 : 0 } });
    const checkout = await service.issue({ sellerId: "seller", network });
    const payment = { signature: `binance-deposit:${810000 + cycle}`, network,
      amountMicros: amountsReceived[cycle] * 1e6, timestamp: Date.parse(checkout.createdAt) + 1 };
    expect(await service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 }), `payment cycle ${cycle}`).toMatchObject({ verified: 1 });
    expect((await service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 })).verified).toBe(0);
    expect(await (await getCommissionCheckoutRuntime()).state("seller")).toMatchObject({ status: "paid", totalDueUsdt: 0,
      carriedShortfallUsdt: cycle < 2 ? 2 : 0,
      amountBreakdown: { commissionsUsdt: 0, previousPaymentBalanceUsdt: 0 },
      lastPayment: { dueUsdt: due, receivedUsdt: amountsReceived[cycle], carriedUsdt: cycle < 2 ? 2 : 0 } });
  }
  const final = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  expect(final.commissionRecords.filter(record => record.source === "tolerance_carry_forward")).toHaveLength(2);
  expect(final.commissionRecords.every(record => record.paymentStatus === "paid")).toBe(true);
  expect(final.notifications.filter(row => row.reason === "commission_payment_verified")).toHaveLength(3);
});
it("carries future shortfalls into the next commission instead of waiving two USDT on every payment", async () => {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  snapshot.commissionRecords = [{ ...snapshot.commissionRecords[0], commissionAmount: 40, paymentExpectedAmount: 40.000001 }];
  let received = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    if (cycle) {
      const current = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
      const createdAt = new Date().toISOString();
      current.commissionRecords.push({ id: `next-${cycle}`, sellerId: "seller", rate: .01, grossAmount: 4000,
        commissionAmount: 40, paymentStatus: "pending", createdAt, updatedAt: createdAt });
    }
    // Recreate the runtime to prove that the balance is persisted, not cached.
    const service = await getCommissionCheckoutRuntime();
    const state = await service.state("seller");
    expect(state.totalDueUsdt).toBeCloseTo((cycle + 1) * 40 - received, 6);
    if (cycle) await expect(service.issue({ sellerId: "seller", network: "BEP20", desiredAmount: "38" })).rejects.toMatchObject({ code: "outside_tolerance" });
    const checkout = await service.issue({ sellerId: "seller", network: "BEP20", desiredAmount: cycle ? "40" : "38" });
    const payment = { signature: `binance-deposit:${900000 + cycle}`, network: "BEP20" as const,
      amountMicros: checkout.expectedMicros, timestamp: Date.parse(checkout.createdAt) + 1 };
    received += payment.amountMicros / 1e6;
    expect((await service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 })).verified).toBe(1);
    expect((await service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 })).verified).toBe(0);
  }
  const state = await (await getCommissionCheckoutRuntime()).state("seller");
  expect(state).toMatchObject({ status: "paid", pendingCount: 0 });
  expect(state).toHaveProperty("carriedShortfallUsdt", expect.any(Number));
  expect(120 - received).toBeLessThanOrEqual(2);
});
it("discovers an unselected 14 USDT receipt against 14.44, verifies it and clears canonical seller restrictions", async () => {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  snapshot.commissionRecords = [{ ...snapshot.commissionRecords[0], commissionAmount: 14.44,
    paymentExpectedAmount: 14.440001, sellerFeeAmount: 7.22, buyerFeeCollectedAmount: 7.22 }];
  const service = await getCommissionCheckoutRuntime();
  const checkout = await service.issue({ sellerId: "seller", network: "BEP20", desiredAmount: "14.44" });
  const payment = { signature, network: "BEP20", amountMicros: 14_000_000, timestamp: Date.parse(checkout.createdAt) + 1 };
  mocks.scanBinance.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  mocks.scanBsc.mockRejectedValue(Error("bep20_index_plan_unsupported"));
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(1);
  expect(mocks.binance).toHaveBeenCalledWith(expect.objectContaining({ amount: 14, signature }));
  expect((await getSellerCommissionStatus("seller")).status).toBe("clear");
  expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).commissionRecords[0]).toMatchObject({
    commissionAmount: 14.44, paymentStatus: "paid", paymentVerificationStatus: "verified",
    paymentBatchSettlement: { receivedMicros: 14_000_000, waivedMicros: 440_000, excessMicros: 0 },
  });
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(0);
});
it("concurrent repository workers cannot notify or credit the checkout twice", async () => {
  const { service, payment } = await prepared(); await Promise.all([service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 }), service.reconcile({ deposits: [payment], deadline: Date.now() + 60_000 })]);
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  expect(snapshot.notifications.filter((row) => row.reason === "commission_payment_verified")).toHaveLength(1);
  expect(snapshot.auditLogs.filter((row) => row.action === "commission_paid")).toHaveLength(1);
});
it("the TRC20 scanner verifies 5.01 for 4.14 and clears the seller despite older unrelated invoices", async () => {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  snapshot.users.push({ ...snapshot.users[0], id: "other", email: "other@example.test" });
  const template = snapshot.commissionRecords[0];
  snapshot.commissionRecords = [
    { ...template, id: "current", commissionAmount: 4.14, paymentExpectedAmount: 4.140001 },
    { ...template, id: "earlier", sellerId: "other", commissionAmount: 5.86, paymentExpectedAmount: 5.860001 },
  ];
  const service = await getCommissionCheckoutRuntime();
  const earlier = await service.issue({ sellerId: "other", network: "TRC20", desiredAmount: "5.86" });
  const current = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  Object.assign(current.commissionRecords.find((row) => row.id === "earlier")!, {
    paymentStatus: "paid", paidAt: new Date(Date.parse(earlier.createdAt) + 1).toISOString(),
  });
  current.commissionRecords.push({ ...template, id: "legacy", sellerId: "other", commissionAmount: 4.18,
    paymentExpectedAmount: 4.180002, paymentStatus: "overdue" });
  const checkout = await service.issue({ sellerId: "seller", network: "TRC20", desiredAmount: "4.14" });
  const payment = { signature: "b".repeat(64), network: "TRC20", amountMicros: 5_010_000,
    timestamp: Math.max(Date.parse(checkout.createdAt), Date.parse(earlier.createdAt)) + 100 };
  mocks.tron.mockResolvedValue({ verified: true, pending: false });
  mocks.scanTron.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  const result = await service.scan(Date.now() + 60_000);
  expect(result.verified).toBe(1); expect(result.errors).toBe(0);
  expect(mocks.tron).toHaveBeenCalledWith(expect.objectContaining(payment), Date.parse(checkout.createdAt));
  expect((await getSellerCommissionStatus("seller")).status).toBe("clear");
  const saved = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  expect(saved.commissionRecords.find((row) => row.id === "current")).toMatchObject({
    commissionAmount: 4.14, paymentStatus: "paid", paymentVerificationStatus: "verified",
    paymentBatchSettlement: { receivedMicros: 5_010_000, waivedMicros: 0, excessMicros: 870_000 },
  });
  expect(saved.commissionRecords.find((row) => row.id === "legacy")?.paymentStatus).toBe("overdue");
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(0);
});
it("complete Binance history covers BSC index failure and independently verifies the receipt", async () => {
  const { service, payment } = await prepared(); mocks.scanBsc.mockRejectedValue(Error("bep20_index_plan_unsupported")); mocks.scanBinance.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  const result = await service.scan(Date.now() + 60_000); expect(result.complete).toBe(true); expect(result.verified).toBe(1); expect(mocks.binance).toHaveBeenCalledOnce();
});
it("incomplete receiving history is not labeled complete", async () => {
  const { service } = await prepared(); mocks.scanBsc.mockRejectedValue(Error("bep20_index_plan_unsupported")); mocks.scanBinance.mockResolvedValue({ configured: true, complete: false, pages: 5, deposits: [] });
  expect((await service.scan(Date.now() + 60_000)).complete).toBe(false);
});
it.each(["TRC20", "BEP20"] as const)("keeps %s unpaid until its receiving history is complete, then recovers once", async (network) => {
  const service = await getCommissionCheckoutRuntime();
  const checkout = await service.issue({ sellerId: "seller", network });
  const payment = { signature: network === "TRC20" ? "e".repeat(64) : `0x${"e".repeat(64)}`,
    network, amountMicros: checkout.expectedMicros - 300_000, timestamp: Date.parse(checkout.createdAt) + 1 };
  const scanner = network === "TRC20" ? mocks.scanTron : mocks.scanBsc;
  const verifier = network === "TRC20" ? mocks.tron : mocks.bep20;
  mocks.scanBinance.mockResolvedValue({ configured: false, complete: false, pages: 0, deposits: [] });
  scanner.mockResolvedValue({ configured: true, complete: false, pages: 5, deposits: [payment] });
  verifier.mockResolvedValue({ verified: true, pending: false });
  const before = structuredClone(globalThis.__alphaExchangeMemorySnapshot);

  expect(await service.scan(Date.now() + 60_000)).toMatchObject({ complete: false, verified: 0 });
  expect(verifier).not.toHaveBeenCalled();
  expect(globalThis.__alphaExchangeMemorySnapshot).toEqual(before);
  expect((await getSellerCommissionStatus("seller")).pendingCount).toBe(2);

  scanner.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  expect(await service.scan(Date.now() + 60_000)).toMatchObject({ complete: true, verified: 1 });
  expect((await getSellerCommissionStatus("seller")).pendingCount).toBe(0);
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(0);
});
it("does not settle an internal Binance receipt from truncated receiving history", async () => {
  const { service, payment } = await prepared();
  mocks.scanBsc.mockRejectedValue(Error("bep20_index_plan_unsupported"));
  mocks.scanBinance.mockResolvedValue({ configured: true, complete: false, pages: 5, deposits: [payment] });
  expect(await service.scan(Date.now() + 60_000)).toMatchObject({ complete: false, verified: 0 });
  expect(mocks.binance).not.toHaveBeenCalled();
  expect((await getSellerCommissionStatus("seller")).pendingCount).toBe(2);
});
it("an unrelated TRON outage does not prevent a complete BEP20 scan from settling", async () => {
  const { service, payment } = await prepared();
  mocks.scanTron.mockRejectedValue(Error("tron_http_503"));
  mocks.scanBinance.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  expect(await service.scan(Date.now() + 60_000)).toMatchObject({ complete: true, verified: 1 });
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
it.each(["2.54", "3.54", "4.54"])("today's 2%% fee settles automatically for a prepared %s USDT payment", async (desiredAmount) => {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  snapshot.commissionRecords = [{ ...snapshot.commissionRecords[0], commissionAmount: 3.54,
    sellerFeeAmount: 1.77, buyerFeeCollectedAmount: 1.77, feePolicyVersion: "buyer_seller_1pct_v1",
    paymentExpectedAmount: 3.540001 }];
  const service = await getCommissionCheckoutRuntime();
  const checkout = await service.issue({ sellerId: "seller", network: "BEP20", desiredAmount });
  expect(checkout.expectedMicros).toBe(Math.round(Number(desiredAmount) * 1e6));
  const payment = { signature, network: "BEP20", amountMicros: checkout.expectedMicros, timestamp: Date.parse(checkout.createdAt) + 1 };
  mocks.scanBinance.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  const result = await service.scan(Date.now() + 60_000);
  expect(result.verified).toBe(1);
  expect((await getSellerCommissionStatus("seller")).status).toBe("clear");
  expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).commissionRecords[0]).toMatchObject({
    commissionAmount: 3.54, sellerFeeAmount: 1.77, buyerFeeCollectedAmount: 1.77,
    feePolicyVersion: "buyer_seller_1pct_v1", paymentStatus: "paid",
  });
});
it("receiving 30 for a 29.20 checkout automatically clears canonical seller access and records 0.80 excess", async () => {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  snapshot.commissionRecords = [{ ...snapshot.commissionRecords[0], commissionAmount: 29.2,
    sellerFeeAmount: 14.6, buyerFeeCollectedAmount: 14.6, paymentExpectedAmount: 29.200001 }];
  const service = await getCommissionCheckoutRuntime();
  const checkout = await service.issue({ sellerId: "seller", network: "BEP20" });
  expect(checkout.roundedMicros).toBe(30_000_000);
  mocks.scanBinance.mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [{
    signature, network: "BEP20", amountMicros: 30_000_000, timestamp: Date.parse(checkout.createdAt) + 1,
  }] });
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(1);
  expect((await getSellerCommissionStatus("seller")).status).toBe("clear");
  expect(mocks.binance).toHaveBeenCalledWith(expect.objectContaining({ amount: 30 }));
  expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).commissionRecords[0]).toMatchObject({
    commissionAmount: 29.2, sellerFeeAmount: 14.6, buyerFeeCollectedAmount: 14.6, paymentStatus: "paid",
    paymentBatchSettlement: { receivedMicros: 30_000_000, excessMicros: 800_000, waivedMicros: 0 },
  });
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(0);
});

it.each([
  ["TRC20", -2], ["TRC20", 1], ["TRC20", 2],
  ["BEP20", -2], ["BEP20", 1], ["BEP20", 2],
] as const)("scanner settles a %s receipt at %+d USDT and unlocks once despite closed rounded history", async (network, delta) => {
  const snapshot = globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
  const previousCreated = new Date(Date.now() - 120_000).toISOString();
  snapshot.commissionRecords = [{ ...snapshot.commissionRecords[0], commissionAmount: 30, paymentExpectedAmount: 30.000002 },
    { ...snapshot.commissionRecords[0], id: "old-fee", sellerId: "other", commissionAmount: 30.94,
      paymentExpectedAmount: 30.940001, paymentReservedExpectedAmounts: [30.94, 31],
      paymentStatus: "paid", paymentVerificationStatus: "verified", createdAt: previousCreated,
      paidAt: new Date(Date.now() - 90_000).toISOString() }];
  const previous = { id: "old-checkout", sellerId: "other", network, createdAt: previousCreated,
    expectedMicros: 30_940_000, requestedMicros: 30_940_000, dueMicros: 30_940_000, roundedMicros: 31_000_000,
    commissions: [{ id: "old-fee", createdAt: previousCreated, dueMicros: 30_940_000 }] };
  snapshot.auditLogs = [{ id: `${previous.id}:issued`, action: "commission_recorded", actorUserId: "other", targetUserId: "other",
    createdAt: previousCreated, details: "Historical fixture", newValue: { kind: "commission_checkout_issued_v1", checkout: previous } }];
  const service = await getCommissionCheckoutRuntime();
  const current = await service.issue({ sellerId: "seller", network });
  const payment = { signature: network === "TRC20" ? "e".repeat(64) : `0x${"e".repeat(64)}`, network,
    amountMicros: (30 + delta) * 1e6, timestamp: Date.parse(current.createdAt) + 1 };
  (network === "TRC20" ? mocks.tron : mocks.bep20).mockResolvedValue({ verified: true });
  (network === "TRC20" ? mocks.scanTron : mocks.scanBsc).mockResolvedValue({ configured: true, complete: true, pages: 1, deposits: [payment] });
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(1);
  expect(await getSellerListingWorkspaceData({ sellerId: "seller" })).toMatchObject({
    commissionStatus: { status: "clear", pendingCount: 0 }, summary: { canCreateListing: true },
  });
  expect((globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb).commissionRecords[0]).toMatchObject({
    commissionAmount: 30, paymentStatus: "paid", paymentBatchSettlement: {
      receivedMicros: payment.amountMicros, waivedMicros: Math.max(0, -delta) * 1e6, excessMicros: Math.max(0, delta) * 1e6,
    },
  });
  expect((await service.scan(Date.now() + 60_000)).verified).toBe(0);
});
