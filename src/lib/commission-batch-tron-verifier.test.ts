import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { verifyCommissionBatchTronReceipt } from "./commission-batch-tron-verifier";
import { CANONICAL_TRC20_COMMISSION_WALLET, OFFICIAL_TRON_USDT_CONTRACT } from "./commission-config";
import { tronAddressToHex } from "./wallet-address";
const tx = "a".repeat(64);
const receipt = { signature: tx, network: "TRC20" as const, amountMicros: 38_000_000, timestamp: Date.now() - 30_000 };
const earliest = receipt.timestamp - 120_000;
const transfer = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
function payload() { return { id: tx, blockNumber: 1234, blockTimeStamp: receipt.timestamp, receipt: { result: "SUCCESS" }, log: [{
  address: tronAddressToHex(OFFICIAL_TRON_USDT_CONTRACT)!.slice(2),
  topics: [transfer, "0".repeat(64), "0".repeat(24) + tronAddressToHex(CANONICAL_TRC20_COMMISSION_WALLET)!.slice(2)],
  data: BigInt(receipt.amountMicros).toString(16).padStart(64, "0"),
}] }; }
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockResolvedValue({ ok: true, json: async () => payload() }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("independent solidified TRON proof for combined settlements", () => {
  it("verifies the actual 38 received, not a fictitious 38.30", async () => {
    expect(await verifyCommissionBatchTronReceipt(receipt, earliest)).toMatchObject({ verified: true });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.trongrid.io/walletsolidity/gettransactioninfobyid");
  });
  it("rejects incorrect exact received amount", async () => {
    expect(await verifyCommissionBatchTronReceipt({ ...receipt, amountMicros: 38_300_000 }, earliest)).toMatchObject({ verified: false, code: "tron_receipt_amount_mismatch" });
  });
  it("rejects a receipt for another transaction", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...payload(), id: "b".repeat(64) }) });
    expect((await verifyCommissionBatchTronReceipt(receipt, earliest)).verified).toBe(false);
  });
  it("refuses wrong token, destination and transfer topic", async () => {
    for (const kind of ["token", "destination", "topic"]) {
      const data = payload();
      if (kind === "token") data.log[0].address = "b".repeat(40);
      if (kind === "destination") data.log[0].topics[2] = "0".repeat(64);
      if (kind === "topic") data.log[0].topics[0] = "b".repeat(64);
      fetchMock.mockResolvedValue({ ok: true, json: async () => data });
      expect((await verifyCommissionBatchTronReceipt(receipt, earliest)).verified).toBe(false);
    }
  });
  it("does not mistake a non-final lookup for a solidified receipt", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await verifyCommissionBatchTronReceipt(receipt, earliest)).toMatchObject({ verified: false, pending: true });
  });
  it("rejects failed contract execution", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...payload(), receipt: { result: "REVERT" } }) });
    expect((await verifyCommissionBatchTronReceipt(receipt, earliest)).verified).toBe(false);
  });
  it("rejects old and future block timestamps", async () => {
    for (const blockTimeStamp of [earliest - 1, Date.now() + 600_000]) {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...payload(), blockTimeStamp }) });
      expect((await verifyCommissionBatchTronReceipt(receipt, earliest)).verified).toBe(false);
    }
  });
  it("sums multiple canonical contract Transfer logs", async () => {
    const data = payload(); data.log[0].data = BigInt(19_000_000).toString(16).padStart(64, "0"); data.log.push({ ...data.log[0] });
    fetchMock.mockResolvedValue({ ok: true, json: async () => data });
    expect((await verifyCommissionBatchTronReceipt(receipt, earliest)).verified).toBe(true);
  });
  it("provider failure stays pending and leaks no provider body", async () => {
    fetchMock.mockRejectedValue(new Error("sensitive-provider-response"));
    const result = await verifyCommissionBatchTronReceipt(receipt, earliest);
    expect(result).toMatchObject({ verified: false, pending: true }); expect(JSON.stringify(result)).not.toContain("sensitive");
  });
});
