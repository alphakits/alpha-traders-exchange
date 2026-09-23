import "server-only";
import { createHmac } from "node:crypto";
import {
  BSC_USDT_CONTRACT, CANONICAL_BEP20_COMMISSION_WALLET,
  CANONICAL_TRC20_COMMISSION_WALLET, OFFICIAL_TRON_USDT_CONTRACT,
  type CommissionNetworkId,
} from "@/lib/commission-config";

export interface CommissionDeposit {
  network: CommissionNetworkId;
  signature: string;
  payer: string;
  amountMicros: number;
  timestamp: number;
}

export interface DepositScan {
  deposits: CommissionDeposit[];
  pages: number;
  complete: boolean;
  configured: boolean;
}

const PAGE_SIZE = 200;
const MAX_PAGES = 5;
const SCAN_TIMEOUT_MS = 12_000;
const BINANCE_WINDOW_MS = 89 * 24 * 60 * 60_000;

function integerMicros(raw: unknown, decimals: number) {
  if (typeof raw !== "string" || !/^\d{1,80}$/.test(raw)) return null;
  const units = BigInt(raw);
  const divisor = BigInt(10) ** BigInt(decimals - 6);
  if (units % divisor !== BigInt(0)) return null;
  const micros = units / divisor;
  return micros > BigInt(0) && micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null;
}

function decimalMicros(raw: unknown) {
  if (typeof raw !== "string" || !/^\d{1,12}(?:\.\d{1,18})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  if (/[1-9]/.test(fraction.slice(6))) return null;
  return integerMicros(`${whole}${fraction.slice(0, 6).padEnd(6, "0")}`, 6);
}

function validTimestamp(value: number, min: number) {
  return Number.isSafeInteger(value) && value >= min && value <= Date.now() + 5 * 60_000;
}

export async function scanTronCommissionDeposits(minTimestamp: number): Promise<DepositScan> {
  const base = (process.env.ALPHA_EXCHANGE_TRONGRID_API_URL?.trim() || "https://api.trongrid.io").replace(/\/+$/, "");
  const url = new URL(`${base}/v1/accounts/${CANONICAL_TRC20_COMMISSION_WALLET}/transactions/trc20`);
  url.search = new URLSearchParams({ only_confirmed: "true", only_to: "true", limit: String(PAGE_SIZE),
    order_by: "block_timestamp,desc", contract_address: OFFICIAL_TRON_USDT_CONTRACT,
    min_timestamp: String(Math.max(0, Math.floor(minTimestamp))), max_timestamp: String(Date.now()),
  }).toString();
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.ALPHA_EXCHANGE_TRONGRID_API_KEY?.trim();
  if (key) headers["TRON-PRO-API-KEY"] = key;
  const signal = AbortSignal.timeout(SCAN_TIMEOUT_MS);
  const scan: DepositScan = { deposits: [], pages: 0, complete: false, configured: true };
  const fingerprints = new Set<string>();
  while (scan.pages < MAX_PAGES) {
    const response = await fetch(url, { headers, cache: "no-store", signal, redirect: "error" });
    if (!response.ok) throw new Error(`tron_http_${response.status}`);
    const payload = await response.json();
    if (payload.success === false || !Array.isArray(payload.data)) throw new Error("tron_invalid_response");
    scan.pages++;
    for (const row of payload.data) {
      if (!row || typeof row !== "object") continue;
      const amountMicros = row.token_info?.decimals === 6 ? integerMicros(row.value, 6) : null;
      const timestamp = Number(row.block_timestamp);
      if (row.to !== CANONICAL_TRC20_COMMISSION_WALLET || row.type !== "Transfer"
        || row.token_info?.address !== OFFICIAL_TRON_USDT_CONTRACT || amountMicros === null
        || !/^[a-f0-9]{64}$/i.test(row.transaction_id ?? "") || !validTimestamp(timestamp, minTimestamp)) continue;
      scan.deposits.push({ network: "TRC20", signature: row.transaction_id, payer: String(row.from ?? ""), amountMicros, timestamp });
    }
    const fingerprint = payload.meta?.fingerprint;
    if (typeof fingerprint !== "string" || !fingerprint) { scan.complete = true; break; }
    if (fingerprints.has(fingerprint)) throw new Error("tron_repeated_cursor");
    fingerprints.add(fingerprint);
    // Never follow a provider-supplied URL with our API key.
    url.searchParams.set("fingerprint", fingerprint);
  }
  return scan;
}

export async function scanBep20CommissionDeposits(minTimestamp: number): Promise<DepositScan> {
  const key = process.env.ALPHA_EXCHANGE_ETHERSCAN_API_KEY?.trim();
  const scan: DepositScan = { deposits: [], pages: 0, complete: false, configured: Boolean(key) };
  if (!key) return scan;
  const signal = AbortSignal.timeout(SCAN_TIMEOUT_MS);
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL("https://api.etherscan.io/v2/api");
    url.search = new URLSearchParams({ chainid: "56", module: "account", action: "tokentx",
      contractaddress: BSC_USDT_CONTRACT, address: CANONICAL_BEP20_COMMISSION_WALLET,
      page: String(page), offset: String(PAGE_SIZE), sort: "desc", apikey: key,
    }).toString();
    const response = await fetch(url, { cache: "no-store", signal, redirect: "error" });
    if (!response.ok) throw new Error(`bep20_index_http_${response.status}`);
    const payload = await response.json();
    if (payload.status === "0" && payload.message === "No transactions found" && Array.isArray(payload.result) && payload.result.length === 0) {
      scan.complete = true; scan.pages++; break;
    }
    if (payload.status !== "1" || !Array.isArray(payload.result)) throw new Error("bep20_index_unavailable");
    scan.pages++;
    let reachedLowerBound = false;
    for (const row of payload.result) {
      if (!row || typeof row !== "object") continue;
      const timestamp = Number(row.timeStamp) * 1000;
      if (Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp < minTimestamp) reachedLowerBound = true;
      const amountMicros = String(row.tokenDecimal) === "18" ? integerMicros(row.value, 18) : null;
      if (String(row.to).toLowerCase() !== CANONICAL_BEP20_COMMISSION_WALLET
        || String(row.contractAddress).toLowerCase() !== BSC_USDT_CONTRACT || amountMicros === null
        || !/^0x[a-f0-9]{64}$/i.test(row.hash ?? "") || !validTimestamp(timestamp, minTimestamp)) continue;
      scan.deposits.push({ network: "BEP20", signature: row.hash, payer: String(row.from ?? ""), amountMicros, timestamp });
    }
    if (reachedLowerBound || payload.result.length < PAGE_SIZE) { scan.complete = true; break; }
  }
  return scan;
}

export function isBinanceDepositReadConfigured() {
  return Boolean(process.env.ALPHA_EXCHANGE_BINANCE_READ_API_KEY?.trim() && process.env.ALPHA_EXCHANGE_BINANCE_READ_API_SECRET?.trim());
}

async function readBinanceDeposits(start: number, end: number, offset: number, signal: AbortSignal) {
  const key = process.env.ALPHA_EXCHANGE_BINANCE_READ_API_KEY?.trim();
  const secret = process.env.ALPHA_EXCHANGE_BINANCE_READ_API_SECRET?.trim();
  if (!key || !secret) throw new Error("binance_read_not_configured");
  const params = new URLSearchParams({ coin: "USDT", status: "1", startTime: String(Math.floor(start)),
    endTime: String(Math.floor(end)), offset: String(offset), limit: String(PAGE_SIZE),
    recvWindow: "5000", timestamp: String(Date.now()),
  });
  params.set("signature", createHmac("sha256", secret).update(params.toString()).digest("hex"));
  // Read-only, pinned official endpoint. Never log the URL or response body.
  const response = await fetch(`https://api.binance.com/sapi/v1/capital/deposit/hisrec?${params}`, {
    method: "GET", headers: { "X-MBX-APIKEY": key }, cache: "no-store", signal, redirect: "error",
  });
  if (!response.ok) throw new Error(`binance_read_http_${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("binance_read_invalid_response");
  return rows as Record<string, unknown>[];
}

function parseBinanceInternalDeposit(row: Record<string, unknown>, min: number): CommissionDeposit | null {
  if (!row || row.coin !== "USDT" || row.status !== 1 || row.transferType !== 1 || (typeof row.id !== "string" || !/^\d{1,64}$/.test(row.id))) return null;
  // Public blockchain deposits always retain their chain TxID and chain verification.
  if (/^(?:0x)?[a-f0-9]{64}$/i.test(String(row.txId ?? ""))) return null;
  if (row.travelRuleStatus !== undefined && row.travelRuleStatus !== 0) return null;
  const network = row.network === "TRX" ? "TRC20" : row.network === "BSC" ? "BEP20" : null;
  if (!network) return null;
  const recipient = network === "TRC20" ? CANONICAL_TRC20_COMMISSION_WALLET : CANONICAL_BEP20_COMMISSION_WALLET;
  const address = String(row.address ?? "");
  if ((network === "BEP20" ? address.toLowerCase() : address) !== recipient) return null;
  const amountMicros = decimalMicros(row.amount);
  const timestamp = Number(row.insertTime);
  if (amountMicros === null || !validTimestamp(timestamp, min)) return null;
  return { network, signature: `binance-deposit:${row.id}`, payer: "", amountMicros, timestamp };
}

export async function scanBinanceInternalCommissionDeposits(minTimestamp: number): Promise<DepositScan> {
  const scan: DepositScan = { deposits: [], pages: 0, complete: false, configured: isBinanceDepositReadConfigured() };
  if (!scan.configured) return scan;
  const signal = AbortSignal.timeout(SCAN_TIMEOUT_MS);
  let end = Date.now();
  while (end >= minTimestamp && scan.pages < MAX_PAGES) {
    const start = Math.max(minTimestamp, end - BINANCE_WINDOW_MS);
    for (let offset = 0; scan.pages < MAX_PAGES; offset += PAGE_SIZE) {
      const rows = await readBinanceDeposits(start, end, offset, signal);
      scan.pages++;
      for (const row of rows) {
        const deposit = parseBinanceInternalDeposit(row, minTimestamp);
        if (deposit) scan.deposits.push(deposit);
      }
      if (rows.length < PAGE_SIZE) { end = start - 1; break; }
    }
  }
  scan.complete = end < minTimestamp;
  return scan;
}

/** Re-read the credited deposit on the server; a caller-supplied ID is never proof. */
export async function verifyBinanceInternalCommissionDeposit(input: {
  signature: string; network: string; recipient: string; amount: number; earliestTimestamp: number;
}) {
  const result = (verified: boolean, notes: string, pending = false) => ({ verified, notes, pending, reference: input.signature });
  if (!/^binance-deposit:\d{1,64}$/.test(input.signature) || !Number.isFinite(input.earliestTimestamp)
    || !Number.isFinite(input.amount) || input.amount <= 0) return result(false, "Invalid Binance deposit reference or commission intent.");
  const recipient = input.network === "TRC20" ? CANONICAL_TRC20_COMMISSION_WALLET : input.network === "BEP20" ? CANONICAL_BEP20_COMMISSION_WALLET : null;
  if (!recipient || input.recipient !== recipient) return result(false, "Incorrect Binance commission destination.");
  try {
    const scan = await scanBinanceInternalCommissionDeposits(input.earliestTimestamp);
    if (!scan.configured) return result(false, "Binance deposit verification is not connected.", true);
    const matches = scan.deposits.filter((deposit) => deposit.signature === input.signature);
    if (matches.length !== 1) return result(false, "The credited Binance deposit could not be verified. Retrying automatically.", true);
    const deposit = matches[0];
    if (deposit.network !== input.network || deposit.amountMicros !== Math.round(input.amount * 1_000_000)) {
      return result(false, "The Binance deposit does not match this commission's exact amount and network.");
    }
    return result(true, `Verified: ${input.amount.toFixed(6)} USDT credited by Binance as an internal deposit.`);
  } catch {
    return result(false, "Binance deposit verification is temporarily unavailable. Retrying automatically.", true);
  }
}
