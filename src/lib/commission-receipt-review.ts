import "server-only";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { scanTronCommissionDeposits, scanBep20CommissionDeposits, scanBinanceCommissionDeposits } from "@/lib/commission-deposit-discovery";
import { commissionReceiptKey } from "@/lib/commission-batch-policy";
import { getCommissionBatchReceiptReservations } from "@/lib/commission-batch-workflow";

/** Owner-only read model. Discovery is NOT proof of payer identity or final settlement. */
export async function readOwnerCommissionReceipts() {
  const checkedAt = Date.now();
  const since = checkedAt - 30 * 24 * 60 * 60_000;
  const repository = await getAlphaExchangeRepository();
  const snapshot = await repository.loadSnapshot();
  const reserved = getCommissionBatchReceiptReservations(snapshot);
  for (const record of snapshot.commissionRecords) {
    const key = record.paymentSignature ? commissionReceiptKey(record.paymentSignature) : null;
    if (key) reserved.add(key);
  }
  const providers = [
    ["TRC20", scanTronCommissionDeposits],
    ["BEP20", scanBep20CommissionDeposits],
    ["BINANCE_DEPOSITS", scanBinanceCommissionDeposits],
  ] as const;
  const scans = await Promise.allSettled(providers.map(([, scan]) => scan(since)));
  const health: Array<{ provider: string; configured: boolean; complete: boolean; error?: string; fallback?: string }> = [];
  const found = new Map<string, { signature: string; network: "TRC20" | "BEP20"; amountMicros: number; timestamp: number; conflicting: boolean; reserved: boolean }>();
  const binance = scans[2];
  const fallbackAvailable = binance.status === "fulfilled" && binance.value.configured && binance.value.complete;
  for (let i = 0; i < scans.length; i++) {
    const scan = scans[i];
    const provider = providers[i][0];
    if (scan.status === "rejected") {
      const label = scan.reason instanceof Error && /^(?:tron|bep20|binance)_[a-z0-9_]+$/.test(scan.reason.message)
        ? scan.reason.message : "provider_unavailable";
      health.push({ provider, configured: true, complete: false, error: label,
        ...(provider === "BEP20" && fallbackAvailable ? { fallback: "BINANCE_DEPOSITS" } : {}) });
      continue;
    }
    health.push({ provider, configured: scan.value.configured, complete: scan.value.complete,
      ...(provider === "BEP20" && fallbackAvailable && (!scan.value.configured || !scan.value.complete) ? { fallback: "BINANCE_DEPOSITS" } : {}) });
    for (const deposit of scan.value.deposits) {
      const key = commissionReceiptKey(deposit.signature);
      if (!key || !Number.isSafeInteger(deposit.amountMicros) || deposit.amountMicros <= 0
        || !Number.isSafeInteger(deposit.timestamp) || deposit.timestamp < since || deposit.timestamp > checkedAt + 5 * 60_000) continue;
      const previous = found.get(key);
      if (previous) {
        previous.conflicting ||= previous.network !== deposit.network || previous.amountMicros !== deposit.amountMicros;
        previous.timestamp = Math.min(previous.timestamp, deposit.timestamp);
      } else {
        found.set(key, { signature: deposit.signature, network: deposit.network,
          amountMicros: deposit.amountMicros, timestamp: deposit.timestamp, conflicting: false, reserved: reserved.has(key) });
      }
    }
  }
  // All raw receiving-account fields, payer addresses and provider bodies stay on the server.
  const receipts = [...found.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 200);
  return { checkedAt: new Date(checkedAt).toISOString(), since: new Date(since).toISOString(),
    receipts, providers: health, truncated: found.size > receipts.length,
    complete: health.every((provider) => provider.complete || Boolean(provider.fallback)),
    discoveryOnly: true };
}
