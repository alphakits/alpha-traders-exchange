import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyWalletCommand, parseWalletCommand, walletCommandKey, walletDigest, walletJson, type WalletCommand, type WalletCommandType, type CommandOf, type ResultOf } from "./commands";
import { createAlphaWalletSandbox } from "./sandbox";
import { assertSimulationRuntime } from "./runtime";
import type { State, Payout } from "./types";
import type { WalletSql, WalletStore } from "./durable-store";

const GENESIS = "0".repeat(64);
const SCHEMA = "alpha_wallet_simulation";
type Row = Record<string, unknown>;
type Projection = { journals: Row[]; entries: Row[]; intents: Row[]; events: Row[]; claims: Row[] };
export class WalletIntegrityError extends Error {
  readonly code = "ALPHA_WALLET_INTEGRITY_FAILURE";
  constructor(message: string) { super(message); this.name = "WalletIntegrityError"; }
}
function verify(value: unknown, message: string): asserts value { if (!value) throw new WalletIntegrityError(message); }
function safeInteger(value: unknown) {
  const result = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  verify(Number.isSafeInteger(result) && result >= 0, "Invalid durable integer"); return result;
}
function eventDigest(row: { revision: number; commandKey: string; at: number; inputHash: string; resultHash: string; stateHash: string; previousHash: string }) { return walletDigest(row); }
function claimPayload(direction: "incoming" | "outgoing", key: string, state: State) {
  if (direction === "incoming") {
    const deposit = state.deposits.get(key)!;
    return { intentId: deposit.intentId, assetId: deposit.assetId, destination: deposit.destination, amountRaw: deposit.amountRaw };
  }
  const payout = state.payouts.get(state.receipts.get(key)!)!;
  return { payoutId: payout.id, assetId: payout.assetId, destination: payout.destination, amountRaw: payout.amountRaw.toString() };
}

function projectionDelta(before: State, after: State, revision: number): Projection {
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
const emptyProjection = (): Projection => ({ journals: [], entries: [], intents: [], events: [], claims: [] });
function addProjection(target: Projection, delta: Projection) { for (const key of Object.keys(target) as Array<keyof Projection>) target[key].push(...delta[key]); }
function sortedRows(rows: Row[]) { return rows.map(row => JSON.stringify(walletJson(row))).sort(); }
async function verifyProjection(tx: WalletSql, expected: Projection) {
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
async function writeProjection(tx: WalletSql, delta: Projection) {
  for (const j of delta.journals) await tx.query(`INSERT INTO ${SCHEMA}.journals(journal_id,command_revision,asset_id,operation) VALUES($1,$2,$3,$4)`, [j.journal_id, j.command_revision, j.asset_id, j.operation]);
  for (const e of delta.entries) await tx.query(`INSERT INTO ${SCHEMA}.entries(journal_id,asset_id,account,delta_units) VALUES($1,$2,$3,$4)`, [e.journal_id, e.asset_id, e.account, e.delta_units]);
  for (const p of delta.intents) await tx.query(`INSERT INTO ${SCHEMA}.payout_intents(payout_id,command_revision,asset_id,seller_id,kind,trade_id,amount_raw,destination,provider_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [p.payout_id, p.command_revision, p.asset_id, p.seller_id, p.kind, p.trade_id, p.amount_raw, p.destination, p.provider_reference]);
  for (const e of delta.events) await tx.query(`INSERT INTO ${SCHEMA}.payout_events(payout_id,command_revision,state,transaction_id,dispatch_count) VALUES($1,$2,$3,$4,$5)`, [e.payout_id, e.command_revision, e.state, e.transaction_id, e.dispatch_count]);
  for (const c of delta.claims) await tx.query(`INSERT INTO ${SCHEMA}.chain_event_claims(event_key,direction,command_revision,payload) VALUES($1,$2,$3,$4::jsonb)`, [c.event_key, c.direction, c.command_revision, JSON.stringify(c.payload)]);
}

/** Source-code-owned bootstrap for an explicitly isolated store; never a production migration. */
export async function initializeDurableWallet(store: WalletStore) {
  assertSimulationRuntime("simulation-only");
  const schema = readFileSync(resolve("docs/alpha-wallet/durable-schema.sql"), "utf8");
  await store.transaction(async tx => {
    const existing = await tx.query("SELECT to_regnamespace('alpha_wallet_simulation')::text AS name");
    if (!existing.rows[0]?.name) await tx.exec(schema);
    const head = await tx.query(`SELECT format_version,mode FROM ${SCHEMA}.head WHERE singleton=true`);
    verify(head.rows.length === 1 && head.rows[0]!.format_version === 1 && head.rows[0]!.mode === "simulation-only", "Unsupported durable wallet store");
  });
}

/** Replayed results are evidence, NEVER provider instructions. No side effects execute. */
function replayHistory(records: ReadonlyArray<Row>) {
  verify(Array.isArray(records), "Wallet history must be an array");
  verify(records.length <= 100_000, "Development replay limit reached; reviewed checkpointing is required");
  let clock = 0, revision = 0, lastHash = GENESIS;
  const wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => clock });
  const keys = new Map<string, { revision: number; inputHash: string; eventHash: string }>();
  const expected = emptyProjection();
  for (const row of records) {
    const next = safeInteger(row.revision); verify(next === revision + 1, "Wallet command sequence has a gap");
    const at = safeInteger(row.occurred_at_ms); verify(at >= clock, "Wallet command time moved backwards"); clock = at;
    let command: WalletCommand;
    try { command = parseWalletCommand(row.command_json); } catch { throw new WalletIntegrityError("Unknown or malformed durable command version"); }
    const commandKey = walletCommandKey(command), inputHash = walletDigest(command);
    verify(row.command_key === commandKey && row.command_type === command.type && row.input_hash === inputHash && !keys.has(commandKey), "Durable command identity mismatch");
    const before = wallet.snapshot();
    let result: unknown;
    try { result = applyWalletCommand(wallet, command); } catch { throw new WalletIntegrityError("A committed command no longer replays under its recorded engine"); }
    const resultHash = walletDigest(result), stateHash = walletDigest(wallet.snapshot());
    verify(row.result_hash === resultHash && walletDigest(row.result_json) === resultHash && row.state_hash === stateHash, "Committed wallet result or state digest mismatch");
    const hash = eventDigest({ revision: next, commandKey, at, inputHash, resultHash, stateHash, previousHash: lastHash });
    verify(row.previous_event_hash === lastHash && row.event_hash === hash, "Wallet command hash chain mismatch");
    addProjection(expected, projectionDelta(before, wallet.snapshot(), next));
    keys.set(commandKey, { revision: next, inputHash, eventHash: hash }); revision = next; lastHash = hash;
  }
  return { wallet, revision, lastHash, clock, keys, expected, setClock(at: number) { clock = at; } };
}

/** Validates logical backup evidence using the same versioned replay as the repository. */
export function verifyDurableHistory(records: ReadonlyArray<Record<string, unknown>>) {
  assertSimulationRuntime("simulation-only");
  const verified = replayHistory(records);
  return { revision: verified.revision, eventHash: verified.lastHash, occurredAtMs: verified.clock, state: verified.wallet.snapshot() };
}

async function load(tx: WalletSql) {
  const headRows = await tx.query(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1 WHERE singleton=true RETURNING revision,last_event_hash,format_version,mode`);
  const head = headRows.rows[0];
  verify(headRows.rows.length === 1 && head?.format_version === 1 && head.mode === "simulation-only", "Unsupported wallet state head");
  const records = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash FROM ${SCHEMA}.commands ORDER BY revision`)).rows;
  const verified = replayHistory(records);
  verify(safeInteger(head.revision) === verified.revision && head.last_event_hash === verified.lastHash, "Wallet head and immutable history disagree");
  await verifyProjection(tx, verified.expected);
  return verified;
}

export type DurableExecution<T = unknown> = { revision: number; commandKey: string; replayed: boolean; result: T; eventHash: string };
export function createDurableWallet(options: { store: WalletStore; mode: "simulation-only"; clock?: () => number }) {
  assertSimulationRuntime(options.mode);
  const clock = options.clock ?? Date.now;
  return Object.freeze({
    async execute<C extends WalletCommand>(input: C): Promise<DurableExecution<ResultOf<C["type"]>>> {
      assertSimulationRuntime(options.mode);
      const command = parseWalletCommand(input);
      const commandKey = walletCommandKey(command), inputHash = walletDigest(command);
      return options.store.transaction(async tx => {
        const current = await load(tx);
        const prior = current.keys.get(commandKey);
        if (prior) {
          verify(prior.inputHash === inputHash, "Idempotency key reused with different payload");
          // Apply to rebuilt idempotency state, not cached historical result: beginDispatch returns false.
          const result = applyWalletCommand(current.wallet, command);
          return { revision: prior.revision, commandKey, replayed: true, result: result as ResultOf<C["type"]>, eventHash: prior.eventHash };
        }
        const at = safeInteger(clock()); verify(at >= current.clock, "Current clock precedes durable history"); current.setClock(at);
        const before = current.wallet.snapshot();
        const result = applyWalletCommand(current.wallet, command);
        const after = current.wallet.snapshot(); current.wallet.assertInvariants();
        const revision = current.revision + 1, resultHash = walletDigest(result), stateHash = walletDigest(after);
        const hash = eventDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: current.lastHash });
        await tx.query(`INSERT INTO ${SCHEMA}.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
        [revision, commandKey, command.type, at, JSON.stringify(command), inputHash, JSON.stringify(walletJson(result)), resultHash, stateHash, current.lastHash, hash]);
        const delta = projectionDelta(before, after, revision);
        await writeProjection(tx, delta);
        await tx.query(`UPDATE ${SCHEMA}.head SET revision=$1,last_event_hash=$2 WHERE singleton=true`, [revision, hash]);
        addProjection(current.expected, delta); await verifyProjection(tx, current.expected);
        return { revision, commandKey, replayed: false, result: result as ResultOf<C["type"]>, eventHash: hash };
      });
    },
    async snapshot() {
      assertSimulationRuntime(options.mode);
      return options.store.transaction(async tx => { const current = await load(tx); return { revision: current.revision, eventHash: current.lastHash, state: current.wallet.snapshot() }; });
    },
    async recoverPayouts() {
      assertSimulationRuntime(options.mode);
      return options.store.transaction(async tx => {
        const current = await load(tx), state = current.wallet.snapshot();
        return [...state.payouts.values()].map(payout => ({ payout: structuredClone(payout),
          action: payout.state === "confirmed" ? "already_confirmed" : payout.state === "failed_final" ? "manual_recovery_required"
            : ["submitting", "submission_unknown", "broadcast"].includes(payout.state) ? "lookup_original_reference"
            : state.haltReason || (payout.tradeId && state.trades.get(payout.tradeId)?.disputed) ? "held_by_policy" : "requires_current_policy_checks",
        } as { payout: Payout; action: "already_confirmed" | "manual_recovery_required" | "lookup_original_reference" | "held_by_policy" | "requires_current_policy_checks" }));
      });
    },
  });
}

export type DurableWallet = ReturnType<typeof createDurableWallet>;
export function walletCommand<T extends WalletCommandType>(type: T, actor: CommandOf<T>["actor"], requestId: string, input: CommandOf<T>["input"]): CommandOf<T> {
  return parseWalletCommand({ version: 1, engineVersion: "alpha-wallet-simulation-v1", type, actor, requestId, input }) as CommandOf<T>;
}
