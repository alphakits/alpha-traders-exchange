// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const SECRET = "test-cron-secret-that-is-at-least-32-characters";
const TX = "a".repeat(64);
const mocks = vi.hoisted(() => ({ records: vi.fn(), retry: vi.fn(), submit: vi.fn(), tron: vi.fn(), bsc: vi.fn(), binance: vi.fn() }));
vi.mock("@/lib/alpha-exchange-store", () => ({ getCommissionRecordsForAutomaticReconciliation: mocks.records,
  reverifyPendingCommissionPayments: mocks.retry, submitSellerCommissionWalletPayment: mocks.submit }));
vi.mock("@/lib/commission-deposit-discovery", () => ({ scanTronCommissionDeposits: mocks.tron,
  scanBep20CommissionDeposits: mocks.bsc, scanBinanceInternalCommissionDeposits: mocks.binance }));
import { GET } from "./route";
const request = (secret = SECRET) => new NextRequest("https://www.alphatraders.co.il/api/cron/commission-payment-verification", { headers: { authorization: `Bearer ${secret}` } });
const candidate = (extra = {}) => ({ id: "commission-1", sellerId: "seller-1", paymentStatus: "pending", commissionAmount: 6.25,
  paymentExpectedAmount: 6.250001, paymentExpectedAmountMode: "unique_v1", paymentExpectedAmountAssignedAt: new Date(Date.now() - 60_000).toISOString(), ...extra });
const deposit = (extra = {}) => ({ network: "TRC20", signature: TX, payer: "sender", amountMicros: 6250001, timestamp: Date.now(), ...extra });
const scan = (deposits: unknown[] = [], extra = {}) => ({ configured: true, complete: true, pages: 1, deposits, ...extra });
describe("commission scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", SECRET);
    mocks.records.mockResolvedValue([candidate()]); mocks.tron.mockResolvedValue(scan()); mocks.bsc.mockResolvedValue(scan());
    mocks.binance.mockResolvedValue(scan([], { configured: false, complete: false, pages: 0 }));
    mocks.submit.mockResolvedValue({ verification: { verified: true } });
    mocks.retry.mockResolvedValue({ checked: 0, verified: 0, stillPending: 0, failed: 0, errors: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects missing configuration and unauthorized calls before touching records", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short"); expect((await GET(request("short"))).status).toBe(503);
    expect(mocks.records).not.toHaveBeenCalled();
  });
  it.each(["TRC20", "BEP20", "BINANCE_INTERNAL"])("discovers and verifies %s without a seller or admin click", async (provider) => {
    const network = provider === "BEP20" ? "BEP20" : "TRC20";
    const signature = provider === "BINANCE_INTERNAL" ? "binance-deposit:123456789" : provider === "BEP20" ? `0x${TX}` : TX;
    (provider === "TRC20" ? mocks.tron : provider === "BEP20" ? mocks.bsc : mocks.binance).mockResolvedValue(scan([deposit({ network, signature })]));
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.submit).toHaveBeenCalledWith({ sellerUserId: "seller-1", commissionId: "commission-1", network, payerWalletAddress: "sender", paymentSignature: signature });
    expect((await response.json()).autoReconciliation).toMatchObject({ matched: 1, verified: 1 });
    expect(mocks.retry).toHaveBeenCalledWith({ limit: 1, deadline: expect.any(Number) });
  });
  it("discovers a genuine payment after a failed wrong TxID", async () => {
    mocks.records.mockResolvedValue([candidate({ paymentSignature: "b".repeat(64), paymentVerificationStatus: "failed" })]);
    mocks.tron.mockResolvedValue(scan([deposit()])); await GET(request()); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("preserves pending and grandfathered original submissions", async () => {
    mocks.records.mockResolvedValue([candidate({ paymentSignature: TX, paymentVerificationStatus: "pending_verification" }),
      candidate({ id: "legacy", paymentSignature: TX, paymentVerificationStatus: "failed", paymentExpectedAmountMode: "legacy_base" })]);
    await GET(request()); expect(mocks.tron).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.retry).toHaveBeenCalled();
  });
  it("does not accept rounded, unrelated or pre-intent deposits", async () => {
    mocks.tron.mockResolvedValue(scan([deposit({ amountMicros: 6250000 }), deposit({ signature: "b".repeat(64), timestamp: Date.now() - 600_000 })]));
    const body = await (await GET(request())).json(); expect(mocks.submit).not.toHaveBeenCalled();
    expect(body.autoReconciliation).toMatchObject({ unmatchedAmount: 1, beforeIntent: 1 });
  });
  it("does not guess between equal amounts, even after other transfers", async () => {
    mocks.records.mockResolvedValue([candidate(), candidate({ id: "commission-2", sellerId: "seller-2" })]);
    mocks.tron.mockResolvedValue(scan([deposit(), deposit({ signature: "b".repeat(64) })]));
    await GET(request()); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("skips used deposits before the batch limit so newer payments are not starved", async () => {
    mocks.records.mockResolvedValue([candidate(), candidate({ id: "paid", paymentStatus: "paid", paymentSignature: `0x${TX.toUpperCase()}` })]);
    mocks.tron.mockResolvedValue(scan([deposit(), deposit({ signature: "b".repeat(64) })]));
    const body = await (await GET(request())).json(); expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit.mock.calls[0][0].paymentSignature).toBe("b".repeat(64)); expect(body.autoReconciliation.skippedUsed).toBe(1);
  });
  it("deduplicates provider results and counts rejected proofs separately from pending", async () => {
    mocks.tron.mockResolvedValue(scan([deposit(), deposit()])); mocks.submit.mockResolvedValue({ verification: { verified: false, pending: false } });
    const body = await (await GET(request())).json(); expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(body.autoReconciliation).toMatchObject({ pending: 0, rejected: 1, verified: 0 });
  });
  it("continues healthy providers and pending verification when a scanner fails, and reports degraded status", async () => {
    mocks.tron.mockRejectedValue(new Error("tron_http_429")); mocks.bsc.mockResolvedValue(scan([deposit({ network: "BEP20", signature: `0x${TX}` })]));
    const response = await GET(request()); expect(response.status).toBe(503); expect(mocks.retry).toHaveBeenCalled(); expect(mocks.submit).toHaveBeenCalled();
    expect((await response.json()).ok).toBe(false);
  });
  it("reports incomplete history instead of silently presenting it as a full scan", async () => {
    mocks.tron.mockResolvedValue(scan([], { complete: false, pages: 5 })); expect((await GET(request())).status).toBe(503);
  });
  it("does not expose arbitrary provider exception messages", async () => {
    mocks.tron.mockRejectedValue(new Error("https://provider.invalid/?apikey=secret"));
    const response = await GET(request()); const body = await response.text(); expect(body).not.toContain("apikey"); expect(body).toContain("provider_unavailable");
  });
});
