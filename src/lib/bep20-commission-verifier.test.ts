import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyBep20Commission } from "./bep20-commission-verifier";
import { BSC_USDT_CONTRACT, CANONICAL_BEP20_COMMISSION_WALLET } from "./commission-config";

const hash = `0x${"a".repeat(64)}`;
const recipientTopic = `0x${"0".repeat(24)}${CANONICAL_BEP20_COMMISSION_WALLET.slice(2)}`;
const input = { txHash: hash, recipientWalletAddress: CANONICAL_BEP20_COMMISSION_WALLET, amountDueUsdt: 2.500001, earliestPaymentTimestampMs: 1_700_000_000_000 };
function mockChain(options: { chain?: string; status?: string; amount?: bigint; token?: string; recipient?: string; head?: string; timestamp?: string; missing?: boolean; wrongBlock?: boolean } = {}) {
  const receipt = { status: options.status ?? "0x1", transactionHash: hash, blockNumber: "0x64", blockHash: `0x${"b".repeat(64)}`, logs: [{ address: options.token ?? BSC_USDT_CONTRACT, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${"0".repeat(64)}`, options.recipient ?? recipientTopic], data: `0x${(options.amount ?? BigInt("2500001000000000000")).toString(16).padStart(64, "0")}` }] };
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const { method } = JSON.parse(init.body);
    const result = method === "eth_chainId" ? options.chain ?? "0x38"
      : method === "eth_getTransactionReceipt" ? options.missing ? null : receipt
      : method === "eth_blockNumber" ? options.head ?? "0x80"
      : { hash: options.wrongBlock ? "0xwrong" : receipt.blockHash, timestamp: options.timestamp ?? "0x6553f101" };
    return { ok: true, json: async () => ({ result }) };
  }));
}
afterEach(() => vi.unstubAllGlobals());
describe("BEP20 commission settlement", () => {
  it("verifies the exact 18-decimal USDT transfer to the owner's wallet", async () => {
    mockChain(); expect(await verifyBep20Commission(input)).toMatchObject({ verified: true, pending: false });
  });
  it.each([
    { status: "0x0" }, { amount: BigInt("2500000000000000000") }, { amount: BigInt("2500002000000000000") },
    { token: `0x${"1".repeat(40)}` }, { recipient: `0x${"0".repeat(64)}` }, { timestamp: "0x1" },
  ])("never credits a failed, mismatched, or old payment (%#)", async (options) => {
    mockChain(options); expect(await verifyBep20Commission(input)).toMatchObject({ verified: false, pending: false });
  });
  it.each([{ chain: "0x1" }, { head: "0x65" }, { missing: true }, { wrongBlock: true }])("keeps unconfirmed or unavailable proof pending (%#)", async (options) => {
    mockChain(options); expect(await verifyBep20Commission(input)).toMatchObject({ verified: false, pending: true });
  });
  it("never treats provider failures as payment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await verifyBep20Commission(input)).toMatchObject({ verified: false, pending: true });
  });
});
