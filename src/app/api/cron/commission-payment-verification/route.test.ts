// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const SECRET = "test-cron-secret-that-is-at-least-32-characters";
const TX = "a".repeat(64);
const mocks = vi.hoisted(() => ({ records: vi.fn(), retry: vi.fn(), recoverEmails: vi.fn(), submit: vi.fn(), tron: vi.fn(), bsc: vi.fn(), binance: vi.fn() }));
vi.mock("@/lib/alpha-exchange-store", () => ({ getCommissionRecordsForAutomaticReconciliation: mocks.records,
  reverifyPendingCommissionPayments: mocks.retry, recoverPendingCommissionPaymentConfirmationEmails: mocks.recoverEmails,
  submitSellerCommissionWalletPayment: mocks.submit }));
vi.mock("@/lib/commission-deposit-discovery", () => ({ scanTronCommissionDeposits: mocks.tron,
  scanBep20CommissionDeposits: mocks.bsc, scanBinanceCommissionDeposits: mocks.binance }));
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
    mocks.recoverEmails.mockResolvedValue({ checked: 0, queued: 0, errors: 0, pending: 0, budgetExhausted: false });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects missing configuration and unauthorized calls before touching records", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short"); expect((await GET(request("short"))).status).toBe(503);
    expect(mocks.records).not.toHaveBeenCalled();
    expect(mocks.recoverEmails).not.toHaveBeenCalled();
  });
  it("recovers a paid commission's persisted confirmation even when no payment candidates remain", async () => {
    mocks.records.mockResolvedValue([]);
    mocks.recoverEmails.mockResolvedValue({ checked: 1, queued: 1, errors: 0, pending: 0, budgetExhausted: false });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.tron).not.toHaveBeenCalled();
    expect(mocks.recoverEmails).toHaveBeenCalledWith({ limit: 2, maxDurationMs: 8_000 });
    expect(body.emailRecovery).toMatchObject({ checked: 1, queued: 1, errors: 0 });
  });
  it("reports confirmation recovery failure while preserving the successful payment result", async () => {
    mocks.tron.mockResolvedValue(scan([deposit()]));
    mocks.recoverEmails.mockRejectedValue(new Error("private database connection detail"));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.autoReconciliation.verified).toBe(1);
    expect(body.emailRecovery.errors).toBe(1);
    expect(JSON.stringify(body)).not.toContain("private database");
  });
  it("leaves durable confirmations for the next run when verification has used the email budget", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.records.mockResolvedValue([]);
    mocks.retry.mockImplementation(async () => {
      clock.mockReturnValue(now + 50_000);
      return { checked: 0, verified: 0, stillPending: 0, failed: 0, errors: 0 };
    });
    try {
      const body = await (await GET(request())).json();
      expect(mocks.recoverEmails).not.toHaveBeenCalled();
      expect(body.emailRecovery).toMatchObject({ checked: 0, budgetExhausted: true });
    } finally {
      clock.mockRestore();
    }
  });
  it.each(["TRC20", "BEP20", "BINANCE_DEPOSITS"])("discovers and verifies %s without a seller or admin click", async (provider) => {
    const network = provider === "BEP20" ? "BEP20" : "TRC20";
    const signature = provider === "BINANCE_DEPOSITS" ? "binance-deposit:123456789" : provider === "BEP20" ? `0x${TX}` : TX;
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
  it("prioritizes a newer valid payment over the previously rejected proof for the same commission", async () => {
    mocks.records.mockResolvedValue([candidate({ paymentSignature: `0x${TX.toUpperCase()}`, paymentVerificationStatus: "failed" })]);
    const replacement = "b".repeat(64);
    mocks.tron.mockResolvedValue(scan([deposit({ timestamp: Date.now() - 1_000 }), deposit({ signature: replacement })]));

    const body = await (await GET(request())).json();

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ commissionId: "commission-1", paymentSignature: replacement }));
    expect(body.autoReconciliation).toMatchObject({ retriedRejected: 0, matched: 1, verified: 1 });
  });
  it("does not spend both batch slots on old rejected payments while a later healthy commission waits", async () => {
    const second = "b".repeat(64);
    const healthy = "c".repeat(64);
    mocks.records.mockResolvedValue([
      candidate({ paymentSignature: TX, paymentVerificationStatus: "failed" }),
      candidate({ id: "commission-2", paymentExpectedAmount: 6.250002, paymentSignature: second, paymentVerificationStatus: "failed" }),
      candidate({ id: "commission-3", paymentExpectedAmount: 6.250003 }),
    ]);
    mocks.tron.mockResolvedValue(scan([
      deposit({ timestamp: Date.now() - 2_000 }),
      deposit({ signature: second, amountMicros: 6250002, timestamp: Date.now() - 1_000 }),
      deposit({ signature: healthy, amountMicros: 6250003 }),
    ]));
    mocks.submit.mockImplementation(async ({ commissionId }: { commissionId: string }) => ({ verification: { verified: commissionId === "commission-3" } }));

    const body = await (await GET(request())).json();

    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ commissionId: "commission-3", paymentSignature: healthy }));
    expect(body.autoReconciliation).toMatchObject({ retriedRejected: 1, matched: 2, verified: 1, rejected: 1 });
  });
  it("keeps rejected candidates in the ambiguity check instead of crediting another equal-amount record", async () => {
    mocks.records.mockResolvedValue([
      candidate({ paymentSignature: TX, paymentVerificationStatus: "failed" }),
      candidate({ id: "commission-2", sellerId: "seller-2" }),
    ]);
    mocks.tron.mockResolvedValue(scan([deposit()]));

    const body = await (await GET(request())).json();

    expect(mocks.submit).not.toHaveBeenCalled();
    expect(body.autoReconciliation).toMatchObject({ ambiguous: 1, retriedRejected: 0 });
  });
  it("recovers the same previously rejected TxID when the genuine deposit becomes visible later", async () => {
    mocks.records.mockResolvedValue([candidate({ paymentSignature: TX, paymentVerificationStatus: "failed" })]);
    mocks.tron.mockResolvedValue(scan([deposit()]));

    const body = await (await GET(request())).json();

    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ commissionId: "commission-1", paymentSignature: TX }));
    expect(body.autoReconciliation).toMatchObject({ retriedRejected: 1, matched: 1, verified: 1 });
  });
  it("rotates repeated rejected proofs by the last attempt so later failed records also get rechecked", async () => {
    const second = "b".repeat(64);
    const third = "c".repeat(64);
    const now = Date.now();
    mocks.records.mockResolvedValue([
      candidate({ paymentSignature: TX, paymentVerificationStatus: "failed", updatedAt: new Date(now).toISOString() }),
      candidate({ id: "commission-2", paymentExpectedAmount: 6.250002, paymentSignature: second, paymentVerificationStatus: "failed", updatedAt: new Date(now - 60_000).toISOString() }),
      candidate({ id: "commission-3", paymentExpectedAmount: 6.250003, paymentSignature: third, paymentVerificationStatus: "failed", updatedAt: new Date(now - 120_000).toISOString() }),
    ]);
    mocks.tron.mockResolvedValue(scan([
      deposit({ timestamp: now - 3_000 }),
      deposit({ signature: second, amountMicros: 6250002, timestamp: now - 2_000 }),
      deposit({ signature: third, amountMicros: 6250003, timestamp: now - 1_000 }),
    ]));
    mocks.submit.mockResolvedValue({ verification: { verified: false } });

    const body = await (await GET(request())).json();

    expect(mocks.submit.mock.calls.map(([input]) => input.commissionId)).toEqual(["commission-3", "commission-2"]);
    expect(body.autoReconciliation).toMatchObject({ retriedRejected: 2, matched: 2, rejected: 2 });
  });
  it.each([
    [4 * 60_000, true],
    [5 * 60_000, true],
    [5 * 60_000 + 1, false],
  ])("uses the receipt verifier's intent-time boundary for a payment %i ms before assignment", async (age, shouldMatch) => {
    const assignedAt = Date.now() - 60_000;
    mocks.records.mockResolvedValue([candidate({ paymentExpectedAmountAssignedAt: new Date(assignedAt).toISOString() })]);
    mocks.tron.mockResolvedValue(scan([deposit({ timestamp: assignedAt - age })]));

    const body = await (await GET(request())).json();

    expect(mocks.tron).toHaveBeenCalledWith(assignedAt - 5 * 60_000);
    expect(mocks.submit).toHaveBeenCalledTimes(shouldMatch ? 1 : 0);
    expect(body.autoReconciliation).toMatchObject({ verified: shouldMatch ? 1 : 0, beforeIntent: shouldMatch ? 0 : 1 });
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
  it("uses complete Binance deposit history when the BEP20 explorer plan is unavailable", async () => {
    mocks.bsc.mockRejectedValue(new Error("bep20_index_plan_unsupported"));
    mocks.binance.mockResolvedValue(scan([deposit({ network: "BEP20", signature: `0x${TX}` })]));
    const response = await GET(request()); const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.autoReconciliation).toMatchObject({ verified: 1, errors: 0, providers: { BEP20: { error: "bep20_index_plan_unsupported", fallback: "BINANCE_DEPOSITS" } } });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ network: "BEP20", paymentSignature: `0x${TX}` }));
  });
  it("does not hide an unavailable BEP20 index behind incomplete Binance history", async () => {
    mocks.bsc.mockRejectedValue(new Error("bep20_index_plan_unsupported"));
    mocks.binance.mockResolvedValue(scan([], { complete: false, pages: 5 }));
    const response = await GET(request()); const body = await response.json();
    expect(response.status).toBe(503); expect(body.autoReconciliation.errors).toBe(2);
    expect(body.autoReconciliation.providers.BEP20.fallback).toBeUndefined();
  });
  it("deduplicates a public deposit found by both the chain index and Binance", async () => {
    mocks.tron.mockResolvedValue(scan([deposit()]));
    mocks.binance.mockResolvedValue(scan([deposit()]));
    await GET(request()); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("does not expose arbitrary provider exception messages", async () => {
    mocks.tron.mockRejectedValue(new Error("https://provider.invalid/?apikey=secret"));
    const response = await GET(request()); const body = await response.text(); expect(body).not.toContain("apikey"); expect(body).toContain("provider_unavailable");
  });
});
