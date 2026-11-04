/**
 * Versioned projection support. The five original projection derivations and
 * SQL statement contracts below are copied from verified v1 durable.ts at
 * 44ac6c4; that original file remains untouched. New projections are additive.
 */
import { walletDigest, walletJson } from "./commands";
import { WalletIntegrityError } from "./durable";
import type { WalletSql } from "./durable-store";
import type { State } from "./types";
import { isV2State } from "./v2-engine";

const SCHEMA = "alpha_wallet_simulation";
type Row = Record<string, unknown>;
type Projection = { journals: Row[]; entries: Row[]; intents: Row[]; events: Row[]; claims: Row[] };
function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletIntegrityError(message);
}
function claimPayload(direction: "incoming" | "outgoing", key: string, state: State) {
  if (direction === "incoming") {
    const deposit = state.deposits.get(key)!;
    return { intentId: deposit.intentId, assetId: deposit.assetId, destination: deposit.destination, amountRaw: deposit.amountRaw };
  }
  const payout = state.payouts.get(state.receipts.get(key)!)!;
  return { payoutId: payout.id, assetId: payout.assetId, destination: payout.destination, amountRaw: payout.amountRaw.toString() };
}

function baseProjectionDelta(before: State, after: State, revision: number): Projection {
  const journals = after.journal.slice(before.journal.length);
  const intents: Row[] = [], events: Row[] = [], claims: Row[] = [];
  for (const payout of after.payouts.values()) {
    const old = before.payouts.get(payout.id);
    if (!old) intents.push({ payout_id: payout.id, command_revision: revision, asset_id: payout.assetId, seller_id: payout.sellerId,
      kind: payout.kind, trade_id: payout.tradeId ?? null, amount_raw: payout.amountRaw.toString(), destination: payout.destination, provider_reference: payout.providerReference });
    if (!old || walletDigest(old) !== walletDigest(payout)) events.push({ payout_id: payout.id, command_revision: revision,
      state: payout.state, transaction_id: payout.transactionId ?? null, dispatch_count: payout.dispatchCount });
  }
  for (const key of after.deposits.keys()) if (!before.deposits.has(key)) claims.push({ event_key: key, direction: "incoming", command_revision: revision, payload: claimPayload("incoming", key, after) });
  for (const key of after.receipts.keys()) if (!before.receipts.has(key)) claims.push({ event_key: key, direction: "outgoing", command_revision: revision, payload: claimPayload("outgoing", key, after) });
  return {
    journals: journals.map(j => ({ journal_id: j.id, command_revision: revision, asset_id: j.assetId, operation: j.operation })),
    entries: journals.flatMap(j => j.entries.map(e => ({ journal_id: j.id, asset_id: j.assetId, account: e.account, delta_units: e.delta.toString() }))),
    intents, events, claims,
  };
}
const emptyBaseProjection = (): Projection => ({ journals: [], entries: [], intents: [], events: [], claims: [] });
function addBaseProjection(target: Projection, delta: Projection) { for (const key of Object.keys(target) as Array<keyof Projection>) target[key].push(...delta[key]); }
function sortedRows(rows: Row[]) { return rows.map(row => JSON.stringify(walletJson(row))).sort(); }
async function verifyBaseProjection(tx: WalletSql, expected: Projection) {
  const checks: Array<[keyof Projection, string]> = [
    ["journals", "SELECT journal_id,command_revision,asset_id,operation FROM alpha_wallet_simulation.journals"],
    ["entries", "SELECT journal_id,asset_id,account,delta_units::text AS delta_units FROM alpha_wallet_simulation.entries"],
    ["intents", "SELECT payout_id,command_revision,asset_id,seller_id,kind,trade_id,amount_raw::text AS amount_raw,destination,provider_reference FROM alpha_wallet_simulation.payout_intents"],
    ["events", "SELECT payout_id,command_revision,state,transaction_id,dispatch_count FROM alpha_wallet_simulation.payout_events"],
    ["claims", "SELECT event_key,direction,command_revision,payload FROM alpha_wallet_simulation.chain_event_claims"],
  ];
  for (const [key, sql] of checks) {
    const actual = await tx.query(sql);
    verify(walletDigest(sortedRows(actual.rows)) === walletDigest(sortedRows(expected[key])), `Durable ${key} disagree with verified command history`);
  }
}
async function writeBaseProjection(tx: WalletSql, delta: Projection) {
  for (const j of delta.journals) await tx.query(`INSERT INTO ${SCHEMA}.journals(journal_id,command_revision,asset_id,operation) VALUES($1,$2,$3,$4)`, [j.journal_id, j.command_revision, j.asset_id, j.operation]);
  for (const e of delta.entries) await tx.query(`INSERT INTO ${SCHEMA}.entries(journal_id,asset_id,account,delta_units) VALUES($1,$2,$3,$4)`, [e.journal_id, e.asset_id, e.account, e.delta_units]);
  for (const p of delta.intents) await tx.query(`INSERT INTO ${SCHEMA}.payout_intents(payout_id,command_revision,asset_id,seller_id,kind,trade_id,amount_raw,destination,provider_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [p.payout_id, p.command_revision, p.asset_id, p.seller_id, p.kind, p.trade_id, p.amount_raw, p.destination, p.provider_reference]);
  for (const e of delta.events) await tx.query(`INSERT INTO ${SCHEMA}.payout_events(payout_id,command_revision,state,transaction_id,dispatch_count) VALUES($1,$2,$3,$4,$5)`, [e.payout_id, e.command_revision, e.state, e.transaction_id, e.dispatch_count]);
  for (const c of delta.claims) await tx.query(`INSERT INTO ${SCHEMA}.chain_event_claims(event_key,direction,command_revision,payload) VALUES($1,$2,$3,$4::jsonb)`, [c.event_key, c.direction, c.command_revision, JSON.stringify(c.payload)]);
}

export type VersionedProjection = Projection & { continuations: Row[]; terms: Row[]; acceptances: Row[] };
export const emptyVersionedProjection = (): VersionedProjection => ({ ...emptyBaseProjection(), continuations: [], terms: [], acceptances: [] });

export function versionedProjectionDelta(before: State, after: State, revision: number): VersionedProjection {
  const delta: VersionedProjection = { ...baseProjectionDelta(before, after, revision), continuations: [], terms: [], acceptances: [] };
  if (!isV2State(after)) return delta;
  if (!isV2State(before)) {
    const continuation = after.continuation;
    delta.continuations.push({ command_revision: continuation.commandRevision, command_key: continuation.commandKey,
      source_revision: continuation.checkpoint.revision, source_event_hash: continuation.checkpoint.eventHash,
      source_state_hash: continuation.checkpoint.stateHash, source_occurred_at_ms: String(continuation.checkpoint.lastCommandAtMs) });
  }
  for (const [requestId, binding] of after.termsBindings) {
    const old = isV2State(before) ? before.termsBindings.get(requestId) : undefined;
    if (!old || walletDigest(old) !== walletDigest(binding)) delta.terms.push({ platform_request_id: requestId,
      wallet_trade_id: binding.walletTradeId, binding_revision: binding.revision, command_revision: revision, payload: walletJson(binding) });
  }
  for (const [key, receipt] of after.acceptanceReceipts) {
    if (isV2State(before) && before.acceptanceReceipts.has(key)) {
      verify(walletDigest(before.acceptanceReceipts.get(key)) === walletDigest(receipt), "Acceptance receipts cannot change");
      continue;
    }
    delta.acceptances.push({ acceptance_key: key, platform_request_id: receipt.platformRequestId, proposal_id: receipt.proposalId,
      binding_revision: receipt.bindingRevision, command_revision: revision, payload: walletJson(receipt) });
  }
  if (isV2State(before)) {
    verify([...before.termsBindings.keys()].every(key => after.termsBindings.has(key)), "Enrollment bindings cannot disappear");
    verify([...before.acceptanceReceipts.keys()].every(key => after.acceptanceReceipts.has(key)), "Acceptance receipts cannot disappear");
    verify(walletDigest(before.continuation) === walletDigest(after.continuation), "Continuation evidence cannot change");
  }
  return delta;
}

export function appendVersionedProjection(target: VersionedProjection, delta: VersionedProjection) {
  addBaseProjection({ journals: target.journals, entries: target.entries, intents: target.intents,
    events: target.events, claims: target.claims }, delta);
  target.continuations.push(...delta.continuations);
  target.terms.push(...delta.terms);
  target.acceptances.push(...delta.acceptances);
}

export async function verifyVersionedProjection(tx: WalletSql, expected: VersionedProjection, formatVersion: 1 | 2) {
  await verifyBaseProjection(tx, expected);
  if (formatVersion === 1) {
    verify(!expected.continuations.length && !expected.terms.length && !expected.acceptances.length, "Versioned projections in a v1 store");
    const tables = await tx.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relname IN ('engine_continuations','trade_terms_events','acceptance_receipts')`);
    verify(tables.rows.length === 0, "A v1 store has incomplete or unsupported versioned storage");
    return;
  }
  const checks: Array<["continuations" | "terms" | "acceptances", string]> = [
    ["continuations", `SELECT command_revision,command_key,source_revision,source_event_hash,source_state_hash,
      source_occurred_at_ms::text AS source_occurred_at_ms FROM alpha_wallet_simulation.engine_continuations`],
    ["terms", `SELECT platform_request_id,wallet_trade_id,binding_revision,command_revision,payload FROM alpha_wallet_simulation.trade_terms_events`],
    ["acceptances", `SELECT acceptance_key,platform_request_id,proposal_id,binding_revision,command_revision,payload FROM alpha_wallet_simulation.acceptance_receipts`],
  ];
  for (const [key, sql] of checks) {
    const actual = await tx.query(sql);
    verify(walletDigest(sortedRows(actual.rows)) === walletDigest(sortedRows(expected[key])), `Durable ${key} disagree with verified command history`);
  }
}

export async function writeVersionedProjection(tx: WalletSql, delta: VersionedProjection) {
  await writeBaseProjection(tx, delta);
  // The explicit migration inserts its immutable continuation registry before
  // the command, with a deferred FK/coherence check. Never duplicate that row.
  if (delta.continuations.length) {
    verify(delta.continuations.length === 1, "Only one continuation is permitted");
    const actual = await tx.query(`SELECT command_revision,command_key,source_revision,source_event_hash,source_state_hash,
      source_occurred_at_ms::text AS source_occurred_at_ms FROM alpha_wallet_simulation.engine_continuations`);
    verify(walletDigest(sortedRows(actual.rows)) === walletDigest(sortedRows(delta.continuations)), "Migration checkpoint differs from the applied continuation");
  }
  for (const row of delta.terms) await tx.query(`INSERT INTO alpha_wallet_simulation.trade_terms_events
    (platform_request_id,wallet_trade_id,binding_revision,command_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [row.platform_request_id, row.wallet_trade_id, row.binding_revision, row.command_revision, JSON.stringify(row.payload)]);
  for (const row of delta.acceptances) await tx.query(`INSERT INTO alpha_wallet_simulation.acceptance_receipts
    (acceptance_key,platform_request_id,proposal_id,binding_revision,command_revision,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
  [row.acceptance_key, row.platform_request_id, row.proposal_id, row.binding_revision, row.command_revision, JSON.stringify(row.payload)]);
}

