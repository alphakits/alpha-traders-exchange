import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ records: vi.fn(), retry: vi.fn(), recover: vi.fn(), submit: vi.fn(), tron: vi.fn(), bsc: vi.fn(), binance: vi.fn(), context: vi.fn(), reconcile: vi.fn(), runtime: vi.fn() }));
vi.mock("@/lib/alpha-exchange-store", () => ({ getCommissionRecordsForAutomaticReconciliation: mocks.records, reverifyPendingCommissionPayments: mocks.retry,
  recoverPendingCommissionPaymentConfirmationEmails: mocks.recover, submitSellerCommissionWalletPayment: mocks.submit }));
vi.mock("@/lib/commission-deposit-discovery", () => ({ scanTronCommissionDeposits: mocks.tron, scanBep20CommissionDeposits: mocks.bsc, scanBinanceCommissionDeposits: mocks.binance }));
vi.mock("@/lib/commission-batch-runtime", () => ({ getCommissionBatchRuntime: mocks.runtime }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));
import { GET } from "./route";
const secret = "long-enough-test-cron-secret-not-real";
const tx = "binance-deposit:123456";
const time = Date.now() - 60_000;
const deposit = { network: "BEP20", signature: tx, payer: "", amountMicros: 38_000_000, timestamp: Date.now() - 10_000 };
function request(auth = true) { return new NextRequest("https://example.test/api/cron/commission-payment-verification", { headers: auth ? { authorization: `Bearer ${secret}` } : {} }); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", secret); vi.stubEnv("ALPHA_EXCHANGE_COMMISSION_BATCH_V1", "1");
  mocks.records.mockResolvedValue([]); mocks.retry.mockResolvedValue({ checked:0, verified:0, stillPending:0, failed:0, errors:0 });
  mocks.recover.mockResolvedValue({ checked:0, queued:0, errors:0, pending:0, budgetExhausted:false });
  mocks.submit.mockResolvedValue({ verification: { verified:true } });
  mocks.tron.mockResolvedValue({ configured:true, complete:true, pages:1, deposits:[] });
  mocks.bsc.mockRejectedValue(new Error("bep20_index_plan_unsupported"));
  mocks.binance.mockResolvedValue({ configured:true, complete:true, pages:1, deposits:[deposit] });
  mocks.runtime.mockResolvedValue({ scanContext:mocks.context, reconcile:mocks.reconcile });
  mocks.context.mockResolvedValue({ pending:[{id:'batch'}], reserved:new Set([tx]), earliestTimestamp:time });
  mocks.reconcile.mockResolvedValue({ checked:1, verified:1, waiting:0, review:0, errors:0, duplicate:0, budgetExhausted:false });
});
afterEach(() => vi.unstubAllEnvs());
describe("batch integration in the existing protected minute scanner", () => {
  it("scans approved batches even without individual unpaid candidates", async () => {
    const response = await GET(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body.autoReconciliation.batchSettlement.verified).toBe(1);
    expect(mocks.binance).toHaveBeenCalledWith(time-300_000);
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({ deposits:[deposit], limit:1 }));
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("reserved original receipt never enters the legacy amount-only matcher", async () => {
    mocks.records.mockResolvedValue([{ id:'other',sellerId:'different',paymentStatus:'pending',commissionAmount:38,paymentExpectedAmount:38,
      paymentExpectedAmountMode:'unique_v1',paymentExpectedAmountAssignedAt:new Date(time).toISOString() }]);
    mocks.reconcile.mockResolvedValue({ checked:1,verified:0,waiting:1,review:0,errors:0,duplicate:0,budgetExhausted:false });
    const body = await (await GET(request())).json(); expect(body.autoReconciliation.skippedUsed).toBe(1); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("disabled rollout leaves the original scanner path unchanged", async () => {
    vi.stubEnv('ALPHA_EXCHANGE_COMMISSION_BATCH_V1','0'); await GET(request()); expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("no unauthorized call can read private Binance or group data", async () => {
    expect((await GET(request(false))).status).toBe(401); expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.binance).not.toHaveBeenCalled();
  });
  it("degraded Binance history never hides the BEP20 plan error", async () => {
    mocks.binance.mockResolvedValue({ configured:true,complete:false,pages:5,deposits:[] });
    const response = await GET(request()); expect(response.status).toBe(503);
    const body = await response.json(); expect(body.autoReconciliation.providers.BEP20.fallback).toBeUndefined();
  });
  it("batch subsystem failure is reported, not mistaken for a settled payment", async () => {
    mocks.reconcile.mockRejectedValue(new Error('unavailable')); const response=await GET(request()); expect(response.status).toBe(503);
    expect((await response.json()).autoReconciliation.batchSettlement).toBeUndefined();
  });
});
