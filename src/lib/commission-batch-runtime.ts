import "server-only";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import { verifyBep20Commission } from "@/lib/bep20-commission-verifier";
import { resolveCommissionWalletForNetwork } from "@/lib/commission-config";
import { verifyBinanceInternalCommissionDeposit } from "@/lib/commission-deposit-discovery";
import { createCommissionBatchWorkflow, getPendingCommissionBatches, getCommissionBatchReceiptReservations } from "./commission-batch-workflow";
import { verifyCommissionBatchTronReceipt } from "./commission-batch-tron-verifier";

// Existing snapshot transaction uses pg_advisory_xact_lock(61422917), shared
// with the legacy single-commission settlement path. Never move network IO
// inside that lock and never replace users, sessions, listings or trade stages.
export async function getCommissionBatchRuntime() {
  if (process.env.ALPHA_EXCHANGE_COMMISSION_BATCH_V1 === "1") {
    const pool = getRuntimePostgresPool();
    if (!pool) throw new Error("Combined settlements require durable PostgreSQL receipt reservations");
    const guard = await pool.query<{ ready: boolean }>(`SELECT
      to_regclass('alpha_exchange.commission_batch_receipt_reservations') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'alpha_exchange.commissions'::regclass
        AND tgname = 'enforce_commission_batch_receipt_reservation' AND tgenabled = 'O')
      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'alpha_exchange.audit_logs'::regclass
        AND tgname = 'reserve_approved_commission_batch_receipt' AND tgenabled = 'O') AS ready`);
    if (guard.rows[0]?.ready !== true) throw new Error("Apply and verify the commission receipt-reservation migration before enabling batches");
  }
  const repository = await getAlphaExchangeRepository();
  const workflow = createCommissionBatchWorkflow({
    read: () => repository.loadSnapshot(),
    async atomic(mutation) {
      const snapshot = await repository.loadSnapshot();
      let result = mutation(snapshot);
      await repository.saveSnapshot(snapshot, {
        selectedTables: ["commissions", "audit_logs", "notifications"],
        rebaseOnLatest: (latest) => { result = mutation(latest); return latest; },
      });
      return result;
    },
    destination(network) {
      const destination = resolveCommissionWalletForNetwork(network);
      if (!destination.available) throw new Error("Commission destination unavailable");
      return destination.walletAddress;
    },
    async verify(receipt, earliestTimestamp) {
      const destination = resolveCommissionWalletForNetwork(receipt.network);
      if (!destination.available) return { verified: false, code: "destination_unavailable" };
      if (receipt.signature.startsWith("binance-deposit:")) {
        // Exact actual received amount is re-read from the receiving account.
        // The ±1 policy is only applied after this independent receipt proof.
        const result = await verifyBinanceInternalCommissionDeposit({ signature: receipt.signature,
          network: receipt.network, recipient: destination.walletAddress,
          amount: receipt.amountMicros / 1e6, earliestTimestamp });
        return { verified: result.verified, pending: result.pending,
          code: result.verified ? "binance_verified" : result.pending ? "binance_pending" : "binance_receipt_rejected" };
      }
      if (receipt.network === "BEP20") {
        const result = await verifyBep20Commission({ txHash: receipt.signature,
          recipientWalletAddress: destination.walletAddress, amountDueUsdt: receipt.amountMicros / 1e6,
          earliestPaymentTimestampMs: earliestTimestamp });
        return { verified: result.verified, pending: result.pending,
          code: result.verified ? "bep20_verified" : result.pending ? "bep20_pending" : "bep20_receipt_rejected" };
      }
      return verifyCommissionBatchTronReceipt(receipt, earliestTimestamp);
    },
    afterCommit: invalidateAlphaExchangeStoreCache,
  });
  return { ...workflow,
    async scanContext() {
      const snapshot = await repository.loadSnapshot();
      const pending = getPendingCommissionBatches(snapshot);
      return { pending, reserved: getCommissionBatchReceiptReservations(snapshot),
        earliestTimestamp: pending.length ? Math.min(...pending.flatMap((batch) => batch.expectedCommissions.map((item) => Date.parse(item.createdAt)))) : null };
    },
    async ownerState() {
      const snapshot = await repository.loadSnapshot();
      return { batches: getPendingCommissionBatches(snapshot),
        commissions: snapshot.commissionRecords.filter((record) => record.paymentStatus !== "paid").map((record) => ({
          id: record.id, displayNumber: record.displayNumber, sellerId: record.sellerId,
          commissionAmount: record.commissionAmount, paymentStatus: record.paymentStatus,
          hasPaymentInProgress: Boolean(record.paymentSignature || record.paymentVerificationStatus === "pending_verification"),
        })) };
    },
  };
}
