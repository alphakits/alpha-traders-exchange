import "server-only";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { verifyBep20Commission } from "@/lib/bep20-commission-verifier";
import { resolveCommissionWalletForNetwork } from "@/lib/commission-config";
import { verifyBinanceInternalCommissionDeposit, scanTronCommissionDeposits, scanBep20CommissionDeposits, scanBinanceCommissionDeposits } from "@/lib/commission-deposit-discovery";
import { verifyCommissionBatchTronReceipt } from "@/lib/commission-batch-tron-verifier";
import { createCommissionCheckoutWorkflow, pendingCommissionCheckouts, type CheckoutDeposit } from "./commission-checkout-workflow";

export async function getCommissionCheckoutRuntime() {
  if (process.env.ALPHA_EXCHANGE_COMMISSION_CHECKOUT_V1 !== "1") throw new Error("Automatic checkout is not enabled");
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Durable checkout storage is required");
  const guard = await pool.query<{ ready: boolean }>(`SELECT
    to_regclass('alpha_exchange.commission_checkouts') IS NOT NULL
    AND to_regclass('alpha_exchange.commission_batch_receipt_reservations') IS NOT NULL
    AND (SELECT count(*)=4 FROM pg_trigger WHERE tgenabled='O' AND
      (tgrelid='alpha_exchange.audit_logs'::regclass AND tgname IN ('reserve_commission_checkout','reserve_approved_commission_batch_receipt')
      OR tgrelid='alpha_exchange.commissions'::regclass AND tgname IN ('protect_commission_checkout_amount','enforce_commission_batch_receipt_reservation'))) AS ready`);
  if (!guard.rows[0]?.ready) throw new Error("Automatic checkout storage guards are unavailable");
  const repository = await getAlphaExchangeRepository();
  const workflow = createCommissionCheckoutWorkflow({
    read: () => repository.loadSnapshot(),
    async atomic(mutation) {
      const snapshot = await repository.loadSnapshot();
      let result = mutation(snapshot);
      await repository.saveSnapshot(snapshot, { selectedTables: ["commissions", "audit_logs", "notifications"],
        rebaseOnLatest: (latest) => { result = mutation(latest); return latest; } });
      return result;
    },
    destination(network) {
      const resolved = resolveCommissionWalletForNetwork(network);
      if (!resolved.available) throw new Error("Commission destination unavailable");
      return resolved.walletAddress;
    },
    async verify(receipt, earliestTimestamp) {
      const resolved = resolveCommissionWalletForNetwork(receipt.network);
      if (!resolved.available) return { verified: false };
      if (receipt.signature.startsWith("binance-deposit:")) return verifyBinanceInternalCommissionDeposit({
        signature: receipt.signature, network: receipt.network, recipient: resolved.walletAddress,
        amount: receipt.amountMicros / 1e6, earliestTimestamp });
      if (receipt.network === "BEP20") return verifyBep20Commission({ txHash: receipt.signature,
        recipientWalletAddress: resolved.walletAddress, amountDueUsdt: receipt.amountMicros / 1e6,
        earliestPaymentTimestampMs: earliestTimestamp });
      return verifyCommissionBatchTronReceipt(receipt, earliestTimestamp);
    },
    afterCommit: invalidateAlphaExchangeStoreCache,
  });
  return { ...workflow,
    async scan(deadline: number) {
      const snapshot = await repository.loadSnapshot();
      const pending = pendingCommissionCheckouts(snapshot);
      if (!pending.length) return { enabled: true, pendingCheckouts: 0, scanned: 0, verified: 0, errors: 0, complete: true };
      const since = Math.min(...pending.map((checkout) => Date.parse(checkout.createdAt)));
      const providers = [scanTronCommissionDeposits, scanBep20CommissionDeposits, scanBinanceCommissionDeposits];
      const scans = await Promise.allSettled(providers.map((scan) => scan(since)));
      const binance = scans[2];
      const fallback = binance.status === "fulfilled" && binance.value.configured && binance.value.complete;
      const deposits: CheckoutDeposit[] = [];
      let complete = true;
      for (let i = 0; i < scans.length; i++) {
        const scan = scans[i];
        if (scan.status === "fulfilled") deposits.push(...scan.value.deposits);
        if (scan.status === "rejected" || !scan.value.configured || !scan.value.complete) {
          // Binance is optional for public on-chain payments; BSC discovery can
          // use the authenticated receiving history without an explorer upgrade.
          if (!(i === 1 && fallback) && !(i === 2 && scan.status === "fulfilled" && !scan.value.configured)) complete = false;
        }
      }
      const result = await workflow.reconcile({ deposits, deadline, limit: 2 });
      return { enabled: true, pendingCheckouts: pending.length, scanned: deposits.length, complete, ...result };
    },
  };
}
