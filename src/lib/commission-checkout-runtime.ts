import "server-only";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { verifyBep20Commission } from "@/lib/bep20-commission-verifier";
import { resolveCommissionWalletForNetwork } from "@/lib/commission-config";
import { verifyBinanceInternalCommissionDeposit, scanTronCommissionDeposits, scanBep20CommissionDeposits, scanBinanceCommissionDeposits, type DepositScan } from "@/lib/commission-deposit-discovery";
import { verifyCommissionBatchTronReceipt } from "@/lib/commission-batch-tron-verifier";
import { createCommissionCheckoutWorkflow, pendingCommissionCheckouts, type CheckoutDeposit, type CheckoutNetwork } from "./commission-checkout-workflow";

export async function getCommissionCheckoutRuntime() {
  if (process.env.ALPHA_EXCHANGE_COMMISSION_CHECKOUT_V1 !== "1") throw new Error("Automatic checkout is not enabled");
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Durable checkout storage is required");
  const guard = await pool.query<{ ready: boolean }>(`SELECT
    to_regclass('alpha_exchange.commission_checkouts') IS NOT NULL
    AND to_regclass('alpha_exchange.commission_checkout_amount_reservations') IS NOT NULL
    AND to_regclass('alpha_exchange.commission_checkout_receipt_recoveries') IS NOT NULL
    AND to_regclass('alpha_exchange.commission_batch_receipt_reservations') IS NOT NULL
    AND to_regprocedure('alpha_exchange.commission_checkout_tolerance_matches(jsonb,jsonb)') IS NOT NULL
    AND to_regprocedure('alpha_exchange.is_earlier_checkout_received_amount(text,bigint,numeric)') IS NOT NULL
    AND to_regprocedure('alpha_exchange.is_closed_checkout_rounded_reference(text,bigint,numeric)') IS NOT NULL
    AND alpha_exchange.commission_checkout_tolerance_micros() = 2000000
    AND (SELECT count(*)=4 FROM pg_trigger WHERE tgenabled='O' AND
      (tgrelid='alpha_exchange.audit_logs'::regclass AND tgname IN ('reserve_commission_checkout','reserve_approved_commission_batch_receipt')
      OR tgrelid='alpha_exchange.commissions'::regclass AND tgname IN ('protect_commission_checkout_amount','enforce_commission_batch_receipt_reservation'))) AS ready`);
  if (!guard.rows[0]?.ready) throw new Error("Automatic checkout storage guards are unavailable");
  const repository = await getAlphaExchangeRepository();
  const workflow = createCommissionCheckoutWorkflow({
    // Read-only checkout state needs no trade history, attachments or sessions.
    // Keep the complete canonical snapshot for mutations and their rebase below.
    read: () => repository.loadSelectedSnapshot(["users", "commissions", "audit_logs"]),
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
      const snapshot = await repository.loadSelectedSnapshot(["commissions", "audit_logs"]);
      const pending = pendingCommissionCheckouts(snapshot);
      if (!pending.length) return { enabled: true, pendingCheckouts: 0, scanned: 0, verified: 0, errors: 0, complete: true };
      const since = Math.min(...pending.map((checkout) => Date.parse(checkout.createdAt)));
      const providers = [scanTronCommissionDeposits, scanBep20CommissionDeposits, scanBinanceCommissionDeposits];
      const scans = await Promise.allSettled(providers.map((scan) => scan(since)));
      const hasCompleteHistory = (scan: PromiseSettledResult<DepositScan>) =>
        scan.status === "fulfilled" && scan.value.configured && scan.value.complete;
      const binance = scans[2];
      const binanceComplete = hasCompleteHistory(binance);
      // An absent optional Binance integration cannot contain internal payments.
      // A configured but failed/truncated scan can: chain history alone cannot
      // rule out another payment option for the same commission instructions.
      const binanceCovered = binanceComplete || (binance.status === "fulfilled" && !binance.value.configured);
      const historyComplete: Record<CheckoutNetwork, boolean> = {
        TRC20: hasCompleteHistory(scans[0]) && binanceCovered,
        BEP20: (hasCompleteHistory(scans[1]) || binanceComplete) && binanceCovered,
      };
      const incompleteNetworks = [...new Set(pending.map((checkout) => checkout.network))]
        .filter((network) => !historyComplete[network]);
      const deposits: CheckoutDeposit[] = [];
      for (const scan of scans) {
        if (scan.status === "fulfilled") deposits.push(...scan.value.deposits);
      }
      // Reconciliation relies on the full receiving history to reject competing
      // payment options. Never let a page cap or provider outage manufacture
      // uniqueness. Complete networks can still progress; others retry next run.
      const result = await workflow.reconcile({ deposits: deposits.filter((deposit) => historyComplete[deposit.network]), deadline, limit: 2 });
      return { enabled: true, pendingCheckouts: pending.length, scanned: deposits.length,
        complete: incompleteNetworks.length === 0, incompleteNetworks, ...result };
    },
  };
}
