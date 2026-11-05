/**
 * V4 adds immutable cancellation evidence. Historical metadata is derived from
 * the verified frozen V3 source; actual accounting deltas use the current state.
 * The source view never authorizes a new command in an older engine.
 */
import { walletDigest, walletJson } from "./commands";
import { WalletIntegrityError } from "./durable";
import type { WalletSql } from "./durable-store";
import type { State } from "./types";
import { appendV3Projection, emptyV3Projection, v3ProjectionDelta, verifyV3Projection,
  writeV3Projection, type V3Projection } from "./v3-projections";
import { baseV3StateForV4, isV4State } from "./v4-engine";
import { versionedProjectionDelta } from "./versioned-projections";

type Row = Record<string, unknown>;
export type V4Projection = V3Projection & { cancellationContinuations: Row[]; initialCancellations: Row[] };
function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletIntegrityError(message);
}
const sortedRows = (rows: Row[]) => rows.map(row => JSON.stringify(walletJson(row))).sort();
export const emptyV4Projection = (): V4Projection => ({
  ...emptyV3Projection(), cancellationContinuations: [], initialCancellations: [],
});

export function v4ProjectionDelta(before: State, after: State, revision: number): V4Projection {
  if (!isV4State(after)) {
    verify(!isV4State(before), "A V4 projection cannot return to a historical engine");
    return { ...v3ProjectionDelta(before, after, revision), cancellationContinuations: [], initialCancellations: [] };
  }
  const retained = v3ProjectionDelta(isV4State(before) ? baseV3StateForV4(before) : before, baseV3StateForV4(after), revision);
  verify(Object.values(retained).every(rows => rows.length === 0), "V4 cannot change its frozen V3 source projections");
  const accounting = versionedProjectionDelta(before, after, revision);
  verify(accounting.continuations.length === 0 && accounting.terms.length === 0 && accounting.acceptances.length === 0,
    "V4 cannot create historical metadata");
  const delta: V4Projection = { ...retained, journals: accounting.journals, entries: accounting.entries,
    intents: accounting.intents, events: accounting.events, claims: accounting.claims,
    cancellationContinuations: [], initialCancellations: [] };
  verify(!delta.intents.length && !delta.events.length && !delta.claims.length,
    "V4 cancellation cannot create payouts or chain evidence");
  if (!isV4State(before)) {
    const continuation = after.cancellationContinuation;
    delta.cancellationContinuations.push({ command_revision: continuation.commandRevision, command_key: continuation.commandKey,
      source_revision: continuation.checkpoint.revision, source_event_hash: continuation.checkpoint.eventHash,
      source_state_hash: continuation.checkpoint.stateHash, source_occurred_at_ms: String(continuation.checkpoint.lastCommandAtMs),
      source_halt_reason: continuation.sourceHaltReason });
  } else {
    verify(walletDigest(before.cancellationContinuation) === walletDigest(after.cancellationContinuation),
      "V4 continuation evidence cannot change");
    verify([...before.initialCancellationReceipts.keys()].every(key => after.initialCancellationReceipts.has(key)),
      "Initial cancellation receipts cannot disappear");
  }
  for (const [key, receipt] of after.initialCancellationReceipts) {
    if (isV4State(before) && before.initialCancellationReceipts.has(key)) {
      verify(walletDigest(before.initialCancellationReceipts.get(key)) === walletDigest(receipt),
        "Initial cancellation receipts cannot change");
      continue;
    }
    delta.initialCancellations.push({ cancellation_key: key, platform_request_id: receipt.platformRequestId,
      wallet_trade_id: receipt.walletTradeId, command_revision: receipt.commandRevision, payload: walletJson(receipt) });
  }
  return delta;
}

export function appendV4Projection(target: V4Projection, delta: V4Projection) {
  appendV3Projection(target, delta);
  target.cancellationContinuations.push(...delta.cancellationContinuations);
  target.initialCancellations.push(...delta.initialCancellations);
}
const checks: Array<["cancellationContinuations" | "initialCancellations", string]> = [
  ["cancellationContinuations", `SELECT command_revision,command_key,source_revision,source_event_hash,source_state_hash,
    source_occurred_at_ms::text AS source_occurred_at_ms,source_halt_reason FROM alpha_wallet_simulation.cancellation_engine_continuations`],
  ["initialCancellations", `SELECT cancellation_key,platform_request_id,wallet_trade_id,command_revision,payload
    FROM alpha_wallet_simulation.initial_cancellation_receipts`],
];
export async function verifyV4Projection(tx: WalletSql, expected: V4Projection, formatVersion: 1 | 2 | 3 | 4) {
  await verifyV3Projection(tx, expected, formatVersion === 4 ? 3 : formatVersion);
  if (formatVersion !== 4) {
    verify(!expected.cancellationContinuations.length && !expected.initialCancellations.length,
      "Cancellation projections cannot exist before V4");
    const found = await tx.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relname IN ('cancellation_engine_continuations','initial_cancellation_receipts')`);
    verify(found.rows.length === 0, "A historical wallet has incomplete or unsupported V4 storage");
    return;
  }
  for (const [key, sql] of checks) {
    const actual = await tx.query(sql);
    verify(walletDigest(sortedRows(actual.rows)) === walletDigest(sortedRows(expected[key])),
      `Durable ${key} disagree with verified command history`);
  }
}
export async function writeV4Projection(tx: WalletSql, delta: V4Projection) {
  await writeV3Projection(tx, delta);
  if (delta.cancellationContinuations.length) {
    verify(delta.cancellationContinuations.length === 1, "Only one V4 continuation is permitted");
    const actual = await tx.query(checks[0]![1]);
    verify(walletDigest(sortedRows(actual.rows)) === walletDigest(sortedRows(delta.cancellationContinuations)),
      "V4 migration checkpoint differs from the applied continuation");
  }
  for (const row of delta.initialCancellations) await tx.query(`INSERT INTO alpha_wallet_simulation.initial_cancellation_receipts
    (cancellation_key,platform_request_id,wallet_trade_id,command_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.cancellation_key, row.platform_request_id, row.wallet_trade_id, row.command_revision, JSON.stringify(row.payload)]);
}
