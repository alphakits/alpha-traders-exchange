/**
 * The v3 storage projection extends the unchanged v1/v2 derivation. The explicit
 * v2-shaped view is used only to validate retained metadata and derive existing
 * accounting rows; it is never passed to a historical reducer for a new action.
 */
import { walletDigest, walletJson } from "./commands";
import { WalletIntegrityError } from "./durable";
import type { WalletSql } from "./durable-store";
import type { State } from "./types";
import { baseV2StateForV3, isV3State } from "./v3-engine";
import { appendVersionedProjection, emptyVersionedProjection, verifyVersionedProjection,
  versionedProjectionDelta, writeVersionedProjection, type VersionedProjection } from "./versioned-projections";

type Row = Record<string, unknown>;
export type V3Projection = VersionedProjection & {
  initialContinuations: Row[]; initialBindings: Row[]; initialAcceptances: Row[];
};
function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletIntegrityError(message);
}
const sortedRows = (rows: Row[]) => rows.map(row => JSON.stringify(walletJson(row))).sort();
export const emptyV3Projection = (): V3Projection => ({
  ...emptyVersionedProjection(), initialContinuations: [], initialBindings: [], initialAcceptances: [],
});

export function v3ProjectionDelta(before: State, after: State, revision: number): V3Projection {
  const beforeBase = isV3State(before) ? baseV2StateForV3(before) : before;
  const afterBase = isV3State(after) ? baseV2StateForV3(after) : after;
  const delta: V3Projection = { ...versionedProjectionDelta(beforeBase, afterBase, revision),
    initialContinuations: [], initialBindings: [], initialAcceptances: [] };
  if (!isV3State(after)) {
    verify(!isV3State(before), "A v3 projection cannot return to a historical engine");
    return delta;
  }
  // These remain the original v2 projections. No initial acceptance may turn
  // into an enrollment or a buyer amount-correction receipt.
  verify(delta.continuations.length === 0 && delta.terms.length === 0 && delta.acceptances.length === 0,
    "V3 actions cannot change retained v2 continuation, bindings or receipts");
  if (!isV3State(before)) {
    const continuation = after.initialContinuation;
    delta.initialContinuations.push({ command_revision: continuation.commandRevision, command_key: continuation.commandKey,
      source_revision: continuation.checkpoint.revision, source_event_hash: continuation.checkpoint.eventHash,
      source_state_hash: continuation.checkpoint.stateHash, source_occurred_at_ms: String(continuation.checkpoint.lastCommandAtMs) });
  }
  for (const [requestId, binding] of after.initialBindings) {
    if (isV3State(before) && before.initialBindings.has(requestId)) {
      verify(walletDigest(before.initialBindings.get(requestId)) === walletDigest(binding), "Initial terms bindings cannot change");
      continue;
    }
    delta.initialBindings.push({ platform_request_id: requestId, platform_trade_id: binding.platformTradeId,
      wallet_trade_id: binding.walletTradeId, command_revision: binding.commandRevision, payload: walletJson(binding) });
  }
  for (const [key, receipt] of after.initialAcceptanceReceipts) {
    if (isV3State(before) && before.initialAcceptanceReceipts.has(key)) {
      verify(walletDigest(before.initialAcceptanceReceipts.get(key)) === walletDigest(receipt), "Initial acceptance receipts cannot change");
      continue;
    }
    delta.initialAcceptances.push({ acceptance_key: key, platform_request_id: receipt.platformRequestId,
      wallet_trade_id: receipt.walletTradeId, command_revision: receipt.commandRevision, payload: walletJson(receipt) });
  }
  if (isV3State(before)) {
    verify([...before.initialBindings.keys()].every(key => after.initialBindings.has(key)), "Initial terms bindings cannot disappear");
    verify([...before.initialAcceptanceReceipts.keys()].every(key => after.initialAcceptanceReceipts.has(key)), "Initial acceptance receipts cannot disappear");
    verify(walletDigest(before.initialContinuation) === walletDigest(after.initialContinuation), "V3 continuation evidence cannot change");
  }
  return delta;
}

export function appendV3Projection(target: V3Projection, delta: V3Projection) {
  appendVersionedProjection(target, delta);
  target.initialContinuations.push(...delta.initialContinuations);
  target.initialBindings.push(...delta.initialBindings);
  target.initialAcceptances.push(...delta.initialAcceptances);
}

const checks: Array<["initialContinuations" | "initialBindings" | "initialAcceptances", string]> = [
  ["initialContinuations", `SELECT command_revision,command_key,source_revision,source_event_hash,source_state_hash,
    source_occurred_at_ms::text AS source_occurred_at_ms FROM alpha_wallet_simulation.initial_engine_continuations`],
  ["initialBindings", `SELECT platform_request_id,platform_trade_id,wallet_trade_id,command_revision,payload
    FROM alpha_wallet_simulation.initial_trade_bindings`],
  ["initialAcceptances", `SELECT acceptance_key,platform_request_id,wallet_trade_id,command_revision,payload
    FROM alpha_wallet_simulation.initial_acceptance_receipts`],
];

export async function verifyV3Projection(tx: WalletSql, expected: V3Projection, formatVersion: 1 | 2 | 3) {
  await verifyVersionedProjection(tx, expected, formatVersion === 1 ? 1 : 2);
  if (formatVersion !== 3) {
    verify(!expected.initialContinuations.length && !expected.initialBindings.length && !expected.initialAcceptances.length,
      "Initial acceptance projections cannot exist before v3");
    const found = await tx.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relname IN
        ('initial_engine_continuations','initial_trade_bindings','initial_acceptance_receipts')`);
    verify(found.rows.length === 0, "A historical wallet has incomplete or unsupported v3 storage");
    return;
  }
  for (const [key, sql] of checks) {
    const actual = await tx.query(sql);
    verify(walletDigest(sortedRows(actual.rows)) === walletDigest(sortedRows(expected[key])),
      `Durable ${key} disagree with verified command history`);
  }
}

export async function writeV3Projection(tx: WalletSql, delta: V3Projection) {
  await writeVersionedProjection(tx, delta);
  // The one-way migration appends this source registry before its command. Its
  // deferred FK and coherence guard require both to commit in the same owner.
  if (delta.initialContinuations.length) {
    verify(delta.initialContinuations.length === 1, "Only one v3 continuation is permitted");
    const actual = await tx.query(checks[0]![1]);
    verify(walletDigest(sortedRows(actual.rows)) === walletDigest(sortedRows(delta.initialContinuations)),
      "V3 migration checkpoint differs from the applied continuation");
  }
  for (const row of delta.initialBindings) await tx.query(`INSERT INTO alpha_wallet_simulation.initial_trade_bindings
    (platform_request_id,platform_trade_id,wallet_trade_id,command_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.platform_request_id, row.platform_trade_id, row.wallet_trade_id, row.command_revision, JSON.stringify(row.payload)]);
  for (const row of delta.initialAcceptances) await tx.query(`INSERT INTO alpha_wallet_simulation.initial_acceptance_receipts
    (acceptance_key,platform_request_id,wallet_trade_id,command_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.acceptance_key, row.platform_request_id, row.wallet_trade_id, row.command_revision, JSON.stringify(row.payload)]);
}
