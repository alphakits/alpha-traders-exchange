import { CANONICAL_BEP20_COMMISSION_WALLET, BSC_USDT_CONTRACT } from "@/lib/commission-config";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MIN_CONFIRMATIONS = 15;
const HEX = /^0x[0-9a-f]+$/i;
type Receipt = { status?: string; transactionHash?: string; blockHash?: string; blockNumber?: string; logs?: Array<{ address?: string; topics?: string[]; data?: string; removed?: boolean }> };

/** Exact-amount BEP20 verification. Provider failures remain pending, never paid. */
export async function verifyBep20Commission(input: {
  txHash: string;
  recipientWalletAddress: string;
  amountDueUsdt: number;
  earliestPaymentTimestampMs?: number;
}) {
  const result = (verified: boolean, notes: string, pending = false) => ({ verified, notes, pending, reference: input.txHash });
  if (!/^0x[0-9a-f]{64}$/i.test(input.txHash)) return result(false, "Paste the full BEP20 transaction hash (0x and 64 hexadecimal characters).");
  if (input.recipientWalletAddress.toLowerCase() !== CANONICAL_BEP20_COMMISSION_WALLET) return result(false, "Incorrect BEP20 commission destination.");
  if (!Number.isFinite(input.amountDueUsdt) || input.amountDueUsdt <= 0 || !Number.isFinite(input.earliestPaymentTimestampMs)) return result(false, "A valid commission payment intent is required.");
  const rpcUrl = process.env.ALPHA_EXCHANGE_BSC_RPC_URL?.trim() || "https://bsc-dataseed.bnbchain.org";
  // A shared deadline bounds the entire lookup, including response bodies.
  const signal = AbortSignal.timeout(12_000);
  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal, cache: "no-store" });
    if (!response.ok) throw new Error("BSC RPC unavailable");
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error || !("result" in payload)) throw new Error("BSC RPC invalid response");
    return payload.result;
  };
  try {
    const [chain, rawReceipt, head] = await Promise.all([
      rpc("eth_chainId", []), rpc("eth_getTransactionReceipt", [input.txHash]), rpc("eth_blockNumber", []),
    ]);
    if (chain !== "0x38") return result(false, "BEP20 verification service is not on BNB Smart Chain. Retrying automatically.", true);
    if (!rawReceipt) return result(false, "BEP20 transaction is not confirmed yet. Verification will retry automatically.", true);
    const receipt = rawReceipt as Receipt;
    if (receipt.transactionHash?.toLowerCase() !== input.txHash.toLowerCase() || !receipt.blockNumber || !HEX.test(receipt.blockNumber) || typeof head !== "string" || !HEX.test(head)) throw new Error("Invalid receipt");
    if (receipt.status === "0x0") return result(false, "The BEP20 transaction reverted; no payment was received.");
    if (receipt.status !== "0x1") throw new Error("Unconfirmed receipt status");
    if (BigInt(head) - BigInt(receipt.blockNumber) + BigInt(1) < BigInt(MIN_CONFIRMATIONS)) return result(false, "BEP20 transaction is awaiting final confirmations. Verification will retry automatically.", true);
    const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]) as { hash?: string; timestamp?: string } | null;
    if (!block?.hash || block.hash !== receipt.blockHash || !block.timestamp || !HEX.test(block.timestamp)) throw new Error("Canonical block unavailable");
    if (Number(BigInt(block.timestamp)) * 1000 < input.earliestPaymentTimestampMs!) return result(false, "This BEP20 transfer predates the commission payment request.");
    const recipient = `0x${"0".repeat(24)}${CANONICAL_BEP20_COMMISSION_WALLET.slice(2)}`;
    const matching = (receipt.logs ?? []).filter((log) => !log.removed && log.address?.toLowerCase() === BSC_USDT_CONTRACT && log.topics?.length === 3 && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC && log.topics[2]?.toLowerCase() === recipient && /^0x[0-9a-f]{64}$/i.test(log.data ?? ""));
    const received = matching.reduce((sum, log) => sum + BigInt(log.data!), BigInt(0));
    // BSC USDT uses 18 decimals. Commission intents use six exact decimals.
    const expected = BigInt(Math.round(input.amountDueUsdt * 1_000_000)) * BigInt(1_000_000_000_000);
    if (received !== expected) return result(false, "No exact USDT BEP20 payment to the commission wallet was found. Check the token, destination, network, and six-decimal amount.");
    return result(true, `Verified: ${input.amountDueUsdt.toFixed(6)} USDT received on BEP20 (BNB Smart Chain).`);
  } catch {
    return result(false, "BNB Smart Chain verification is temporarily unavailable. The payment will be checked again automatically.", true);
  }
}
