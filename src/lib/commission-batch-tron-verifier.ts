import { createHash } from "node:crypto";
import { CANONICAL_TRC20_COMMISSION_WALLET, OFFICIAL_TRON_USDT_CONTRACT } from "./commission-config";
import type { BatchReceipt } from "./commission-batch-policy";

const TRANSFER = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** Base58Check decode the code-owned mainnet addresses, not a provider-supplied destination. */
function tronHex(address: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(0);
  for (const character of address) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid canonical TRON address");
    value = value * BigInt(58) + BigInt(digit);
  }
  const hex = value.toString(16).padStart(50, "0");
  const bytes = Buffer.from(hex, "hex");
  const payload = bytes.subarray(0, 21);
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  if (bytes.length !== 25 || payload[0] !== 0x41 || !checksum.equals(bytes.subarray(21))) throw new Error("Invalid canonical TRON checksum");
  return payload.subarray(1).toString("hex");
}
export async function verifyCommissionBatchTronReceipt(receipt: BatchReceipt, earliestTimestamp: number) {
  const result = (verified: boolean, code: string, pending = false) => ({ verified, code, pending });
  if (receipt.network !== "TRC20" || !/^[a-f0-9]{64}$/i.test(receipt.signature)
    || !Number.isSafeInteger(receipt.amountMicros) || receipt.amountMicros <= 0
    || !Number.isFinite(earliestTimestamp)) return result(false, "invalid_tron_receipt");
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    const key = process.env.ALPHA_EXCHANGE_TRONGRID_API_KEY?.trim();
    if (key) headers["TRON-PRO-API-KEY"] = key;
    const response = await fetch("https://api.trongrid.io/walletsolidity/gettransactioninfobyid", {
      method: "POST", headers, body: JSON.stringify({ value: receipt.signature }), cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return result(false, "tron_service_unavailable", true);
    const info = await response.json();
    if (!info || typeof info !== "object" || !info.id) return result(false, "tron_awaiting_finality", true);
    if (String(info.id).toLowerCase() !== receipt.signature.toLowerCase()) return result(false, "tron_receipt_mismatch");
    if (info.receipt?.result !== "SUCCESS") return result(false, "tron_receipt_not_successful");
    if (!Number.isSafeInteger(info.blockNumber) || info.blockNumber <= 0
      || !Number.isSafeInteger(info.blockTimeStamp) || info.blockTimeStamp <= 0) return result(false, "tron_invalid_block", true);
    if (info.blockTimeStamp < earliestTimestamp || info.blockTimeStamp > Date.now() + 300_000) return result(false, "tron_receipt_time_invalid");
    const token = tronHex(OFFICIAL_TRON_USDT_CONTRACT);
    const destination = "0".repeat(24) + tronHex(CANONICAL_TRC20_COMMISSION_WALLET);
    if (!Array.isArray(info.log)) return result(false, "tron_no_usdt_transfer");
    let received = BigInt(0);
    for (const log of info.log) {
      if (!log || typeof log.address !== "string" || !/^(?:41)?[a-f0-9]{40}$/i.test(log.address)
        || log.address.toLowerCase().replace(/^41(?=[a-f0-9]{40}$)/, "") !== token
        || !Array.isArray(log.topics) || log.topics.length !== 3
        || log.topics.some((topic: unknown) => typeof topic !== "string" || !/^[a-f0-9]{64}$/i.test(topic))
        || log.topics[0].toLowerCase() !== TRANSFER || log.topics[2].toLowerCase() !== destination
        || typeof log.data !== "string" || !/^[a-f0-9]{64}$/i.test(log.data)) continue;
      received += BigInt(`0x${log.data}`);
    }
    return received === BigInt(receipt.amountMicros)
      ? result(true, "tron_verified") : result(false, "tron_receipt_amount_mismatch");
  } catch {
    return result(false, "tron_service_unavailable", true);
  }
}
