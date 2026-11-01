// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), tron: vi.fn(), bsc: vi.fn(), binance: vi.fn() }));
vi.mock("@/lib/alpha-exchange-repository", () => ({ getAlphaExchangeRepository: async () => ({ loadSnapshot: mocks.read }) }));
vi.mock("@/lib/commission-deposit-discovery", () => ({ scanTronCommissionDeposits: mocks.tron, scanBep20CommissionDeposits: mocks.bsc, scanBinanceCommissionDeposits: mocks.binance }));
import { readOwnerCommissionReceipts } from "./commission-receipt-review";
const signature = `0x${"a".repeat(64)}`;
function scan(deposits: unknown[] = []) { return { configured: true, complete: true, pages: 1, deposits }; }
function receipt(extra = {}) { return { network: "BEP20", signature, amountMicros: 39_000_000, timestamp: Date.now() - 1000, payer: "private-source", rawSecret: "must-not-return", ...extra }; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.read.mockResolvedValue({ commissionRecords: [], auditLogs: [] });
  for (const provider of [mocks.tron, mocks.bsc, mocks.binance]) provider.mockResolvedValue(scan());
});
describe("owner receipt discovery", () => {
  it("does not return provider payloads, payer addresses or invented verification", async () => {
    mocks.binance.mockResolvedValue(scan([receipt()])); const result = await readOwnerCommissionReceipts();
    expect(result.discoveryOnly).toBe(true); expect(result.receipts).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/private-source|must-not-return/);
    expect(result.receipts[0].amountMicros).toBe(39_000_000);
  });
  it("deduplicates original chain references across providers", async () => {
    mocks.bsc.mockResolvedValue(scan([receipt()])); mocks.binance.mockResolvedValue(scan([receipt({ signature: "A".repeat(64) })]));
    expect((await readOwnerCommissionReceipts()).receipts).toHaveLength(1);
  });
  it("exposes conflicting amounts instead of choosing by provider order", async () => {
    mocks.bsc.mockResolvedValue(scan([receipt()])); mocks.binance.mockResolvedValue(scan([receipt({ amountMicros: 40_000_000 })]));
    expect((await readOwnerCommissionReceipts()).receipts[0].conflicting).toBe(true);
  });
  it("marks previously used references unavailable even after a manual reset", async () => {
    mocks.read.mockResolvedValue({ commissionRecords: [{ paymentSignature: signature, paymentStatus: "pending" }], auditLogs: [] });
    mocks.binance.mockResolvedValue(scan([receipt()])); expect((await readOwnerCommissionReceipts()).receipts[0].reserved).toBe(true);
  });
  it("does not leak arbitrary provider exception strings", async () => {
    mocks.binance.mockRejectedValue(new Error("secret-api-token-here")); const result = await readOwnerCommissionReceipts();
    expect(result.complete).toBe(false); expect(JSON.stringify(result)).not.toContain("secret-api-token-here");
  });
  it("reports incomplete history and genuine empty scans differently", async () => {
    expect((await readOwnerCommissionReceipts()).complete).toBe(true);
    mocks.binance.mockResolvedValue({ ...scan(), complete: false }); expect((await readOwnerCommissionReceipts()).complete).toBe(false);
  });
  it("keeps explorer degradation explicit when Binance is a complete fallback", async () => {
    mocks.bsc.mockRejectedValue(new Error("bep20_index_plan_unsupported")); const result = await readOwnerCommissionReceipts();
    expect(result.complete).toBe(true); expect(result.providers[1]).toMatchObject({ error: "bep20_index_plan_unsupported", fallback: "BINANCE_DEPOSITS", complete: false });
  });
  it("rejects invalid/future/old amounts and timestamps", async () => {
    mocks.binance.mockResolvedValue(scan([receipt({ amountMicros: 0 }), receipt({ timestamp: Date.now() + 600_000 }), receipt({ timestamp: 1 })]));
    expect((await readOwnerCommissionReceipts()).receipts).toEqual([]);
  });
});
