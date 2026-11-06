/** V5 adds only immutable claim/freeze evidence; every financial and historical projection stays unchanged. */
import { walletDigest, walletJson } from "./commands";
import { WalletIntegrityError } from "./durable";
import type { WalletSql } from "./durable-store";
import type { State } from "./types";
import { appendV4Projection, emptyV4Projection, v4ProjectionDelta, verifyV4Projection, writeV4Projection, type V4Projection } from "./v4-projections";
import { baseV4StateForV5, isV5State } from "./v5-engine";
import { versionedProjectionDelta } from "./versioned-projections";

type Row = Record<string, unknown>;
export type V5Projection = V4Projection & { paymentContinuations: Row[]; initialPaymentClaims: Row[]; initialDisputeFreezes: Row[] };
function verify(value: unknown, message: string): asserts value { if (!value) throw new WalletIntegrityError(message); }
const sorted = (rows: Row[]) => rows.map(row => JSON.stringify(walletJson(row))).sort();
export const emptyV5Projection = (): V5Projection => ({ ...emptyV4Projection(), paymentContinuations: [], initialPaymentClaims: [], initialDisputeFreezes: [] });
export function v5ProjectionDelta(before: State, after: State, revision: number): V5Projection {
  if (!isV5State(after)) {
    verify(!isV5State(before), "V5 cannot return to a historical engine");
    return { ...v4ProjectionDelta(before, after, revision), paymentContinuations: [], initialPaymentClaims: [], initialDisputeFreezes: [] };
  }
  const retained = v4ProjectionDelta(isV5State(before) ? baseV4StateForV5(before) : before, baseV4StateForV5(after), revision);
  verify(Object.values(retained).every(rows => rows.length === 0), "V5 cannot change its frozen V4 source projections");
  verify(Object.values(versionedProjectionDelta(before, after, revision)).every(rows => rows.length === 0)
    && walletDigest(before.accounts) === walletDigest(after.accounts) && walletDigest(before.journal) === walletDigest(after.journal),
  "V5 claims and disputes cannot move principal or produce any financial projection");
  const delta: V5Projection = { ...retained, paymentContinuations: [], initialPaymentClaims: [], initialDisputeFreezes: [] };
  if (!isV5State(before)) {
    const continuation = after.paymentContinuation;
    delta.paymentContinuations.push({ command_revision: continuation.commandRevision, command_key: continuation.commandKey,
      source_revision: continuation.checkpoint.revision, source_event_hash: continuation.checkpoint.eventHash,
      source_state_hash: continuation.checkpoint.stateHash, source_occurred_at_ms: String(continuation.checkpoint.lastCommandAtMs),
      source_halt_reason: continuation.sourceHaltReason });
  } else {
    verify(walletDigest(before.paymentContinuation) === walletDigest(after.paymentContinuation), "V5 continuation cannot change");
    verify([...before.initialPaymentClaimReceipts.keys()].every(key => after.initialPaymentClaimReceipts.has(key))
      && [...before.initialDisputeFreezeReceipts.keys()].every(key => after.initialDisputeFreezeReceipts.has(key)), "V5 immutable receipts cannot disappear");
  }
  for (const [key, receipt] of after.initialPaymentClaimReceipts) {
    if (isV5State(before) && before.initialPaymentClaimReceipts.has(key)) {
      verify(walletDigest(before.initialPaymentClaimReceipts.get(key)) === walletDigest(receipt), "Payment claim receipts cannot change"); continue;
    }
    delta.initialPaymentClaims.push({ claim_key: key, platform_request_id: receipt.platformRequestId, wallet_trade_id: receipt.walletTradeId,
      command_revision: receipt.commandRevision, payload: walletJson(receipt) });
  }
  for (const [key, receipt] of after.initialDisputeFreezeReceipts) {
    if (isV5State(before) && before.initialDisputeFreezeReceipts.has(key)) {
      verify(walletDigest(before.initialDisputeFreezeReceipts.get(key)) === walletDigest(receipt), "Dispute freeze receipts cannot change"); continue;
    }
    delta.initialDisputeFreezes.push({ dispute_key: key, platform_request_id: receipt.platformRequestId, wallet_trade_id: receipt.walletTradeId,
      command_revision: receipt.commandRevision, payload: walletJson(receipt) });
  }
  return delta;
}
export function appendV5Projection(target: V5Projection, delta: V5Projection) {
  appendV4Projection(target, delta); target.paymentContinuations.push(...delta.paymentContinuations);
  target.initialPaymentClaims.push(...delta.initialPaymentClaims); target.initialDisputeFreezes.push(...delta.initialDisputeFreezes);
}
const checks: Array<["paymentContinuations" | "initialPaymentClaims" | "initialDisputeFreezes", string]> = [
  ["paymentContinuations", `SELECT command_revision,command_key,source_revision,source_event_hash,source_state_hash,
    source_occurred_at_ms::text AS source_occurred_at_ms,source_halt_reason FROM alpha_wallet_simulation.payment_engine_continuations`],
  ["initialPaymentClaims", `SELECT claim_key,platform_request_id,wallet_trade_id,command_revision,payload FROM alpha_wallet_simulation.initial_payment_claim_receipts`],
  ["initialDisputeFreezes", `SELECT dispute_key,platform_request_id,wallet_trade_id,command_revision,payload FROM alpha_wallet_simulation.initial_dispute_freeze_receipts`],
];
export async function verifyV5Projection(tx: WalletSql, expected: V5Projection, formatVersion: 1 | 2 | 3 | 4 | 5) {
  await verifyV4Projection(tx, expected, formatVersion === 5 ? 4 : formatVersion);
  if (formatVersion !== 5) {
    verify(!expected.paymentContinuations.length && !expected.initialPaymentClaims.length && !expected.initialDisputeFreezes.length,
      "Payment lifecycle projections cannot exist before V5");
    const found = await tx.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relname IN ('payment_engine_continuations','initial_payment_claim_receipts','initial_dispute_freeze_receipts')`);
    verify(found.rows.length === 0, "Historical wallet has incomplete or unsupported V5 storage"); return;
  }
  for (const [key, sql] of checks) {
    const actual = await tx.query(sql);
    verify(walletDigest(sorted(actual.rows)) === walletDigest(sorted(expected[key])), `Durable ${key} disagree with verified command history`);
  }
}
export async function writeV5Projection(tx: WalletSql, delta: V5Projection) {
  await writeV4Projection(tx, delta);
  if (delta.paymentContinuations.length) {
    verify(delta.paymentContinuations.length === 1, "Only one V5 continuation is permitted");
    verify(walletDigest(sorted((await tx.query(checks[0]![1])).rows)) === walletDigest(sorted(delta.paymentContinuations)),
      "V5 migration checkpoint differs from the continuation");
  }
  for (const row of delta.initialPaymentClaims) await tx.query(`INSERT INTO alpha_wallet_simulation.initial_payment_claim_receipts
    (claim_key,platform_request_id,wallet_trade_id,command_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.claim_key, row.platform_request_id, row.wallet_trade_id, row.command_revision, JSON.stringify(row.payload)]);
  for (const row of delta.initialDisputeFreezes) await tx.query(`INSERT INTO alpha_wallet_simulation.initial_dispute_freeze_receipts
    (dispute_key,platform_request_id,wallet_trade_id,command_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.dispute_key, row.platform_request_id, row.wallet_trade_id, row.command_revision, JSON.stringify(row.payload)]);
}
