import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyWalletCommand, walletDigest, walletJson, WALLET_ENGINE_VERSION } from "./commands";
import { WalletIntegrityError, type DurableExecution } from "./durable";
import type { WalletSql, WalletStore } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";
import { createAlphaWalletSandbox, type AlphaWalletSandbox } from "./sandbox";
import type { Payout, State } from "./types";
import { WALLET_V2_ENGINE_VERSION, type V2Checkpoint } from "./v2-commands";
import { applyV2Command, assertV2Invariants, findV2AcceptanceReplay, isV2State, type V2State } from "./v2-engine";
import { parseV3Command, parseV3VersionedCommand, v3CommandKey, WALLET_V3_ENGINE_VERSION,
  type V3CommandOf, type V3ResultOf, type V3VersionedCommand, type V3VersionedResultOf } from "./v3-commands";
import { applyV3Command, assertV3Invariants, baseV2StateForV3, findV3InitialAcceptanceReplay, isV3State, type V3State } from "./v3-engine";
import { appendV3Projection, emptyV3Projection, v3ProjectionDelta, verifyV3Projection,
  writeV3Projection, type V3Projection } from "./v3-projections";

const GENESIS = "0".repeat(64);
const MAX_COMMANDS = 100_000;
const SELECT_COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms,command_json,input_hash,result_json,
  result_hash,state_hash,previous_event_hash,event_hash FROM alpha_wallet_simulation.commands ORDER BY revision LIMIT 100001`;
type Row = Record<string, unknown>;
type Prior = { revision: number; inputHash: string; eventHash: string; result: unknown };
export type V3WalletSnapshot = {
  revision: number; eventHash: string; lastCommandAtMs: number; occurredAtMs: number;
  engineVersion: typeof WALLET_ENGINE_VERSION | typeof WALLET_V2_ENGINE_VERSION | typeof WALLET_V3_ENGINE_VERSION;
  state: State | V2State | V3State;
};

function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletIntegrityError(message);
}
function safeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value) ? Number(value) : NaN;
  verify(Number.isSafeInteger(parsed) && parsed >= 0, "Invalid durable integer");
  return parsed;
}
// Exactly the historical event construction. An engine version never creates a
// second command-identity namespace or rewrites an old event hash.
function eventDigest(row: { revision: number; commandKey: string; at: number; inputHash: string; resultHash: string; stateHash: string; previousHash: string }) {
  return walletDigest(row);
}
function formatFor(state: State): 1 | 2 | 3 { return isV3State(state) ? 3 : isV2State(state) ? 2 : 1; }

type TransactionContext = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
async function transactionContext(tx: WalletSql, expected?: string) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<TransactionContext>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema', true) AS development_mode`);
  assertSimulationRuntime("simulation-only");
  const context = result.rows[0];
  verify(result.rows.length === 1 && typeof context?.transaction_id === "string" && /^[1-9][0-9]*$/.test(context.transaction_id),
    "V3 wallet requires a transaction identity");
  verify(expected === undefined || context.transaction_id === expected, "V3 wallet transaction identity changed or ended");
  verify(context.isolation === "serializable" && context.read_only === "off" && context.development_mode === "simulation-only",
    "V3 wallet requires an explicit writable SERIALIZABLE simulation transaction");
  return context.transaction_id;
}
async function assertNoCanonicalCohort(tx: WalletSql) {
  const found = await tx.query(`SELECT nspname FROM pg_namespace WHERE nspname='alpha_wallet_marketplace_simulation'`);
  verify(found.rows.length === 0, "V3 financial development refuses every existing canonical coordination namespace");
}

/** One real owner supplies BEGIN, whole-decision retry and COMMIT. */
async function inOwnedTransaction<T>(store: WalletStore, work: (tx: WalletSql) => Promise<T>): Promise<T> {
  assertSimulationRuntime("simulation-only");
  return store.transaction(async tx => {
    let certified: string | undefined;
    try {
      const identity = await transactionContext(tx);
      await transactionContext(tx, identity);
      certified = identity;
      await assertNoCanonicalCohort(tx);
      const result = await work(tx);
      await assertNoCanonicalCohort(tx);
      await transactionContext(tx, identity);
      return result;
    } catch (error) {
      if (certified !== undefined) {
        try {
          // A runtime guard may itself be the failure. Certify only the physical
          // identity here; a semantic refusal after a companion write must not
          // become committable when the caller catches and restores the runtime.
          const actual = await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id");
          if (actual.rows.length === 1 && actual.rows[0]?.transaction_id === certified) {
            await tx.query("SELECT 1 / 0 /* abort failed v3 wallet participant */");
          }
        } catch { /* Preserve the original rejection; foreign identities are never aborted. */ }
      }
      throw error;
    }
  });
}

type Replayed = {
  v1Wallet: AlphaWalletSandbox; state: State | V2State | V3State; revision: number; lastHash: string; clock: number;
  keys: Map<string, Prior>; expected: V3Projection; setClock(at: number): void;
};
function checkpoint(current: Pick<Replayed, "revision" | "lastHash" | "clock" | "state">): V2Checkpoint {
  return { revision: current.revision, eventHash: current.lastHash, stateHash: walletDigest(current.state), lastCommandAtMs: current.clock };
}
function applyNext(current: Replayed, command: V3VersionedCommand, at: number): { state: State | V2State | V3State; result: unknown } {
  if (command.version === 1) {
    verify(formatFor(current.state) === 1, "New v1 commands are fenced after their continuation");
    current.setClock(at);
    const result = applyWalletCommand(current.v1Wallet, command);
    current.v1Wallet.assertInvariants();
    return { state: current.v1Wallet.snapshot(), result };
  }
  if (command.version === 2) {
    verify(!isV3State(current.state), "New v2 commands are fenced after the v3 continuation");
    const applied = applyV2Command(current.state, command, { ...checkpoint(current), at });
    assertV2Invariants(applied.state);
    return applied;
  }
  const applied = applyV3Command(current.state, command, { ...checkpoint(current), at });
  assertV3Invariants(applied.state);
  return applied;
}

/** Each old prefix runs through its original reducer and strict envelope. */
function replayHistory(records: ReadonlyArray<Row>): Replayed {
  verify(Array.isArray(records) && records.length <= MAX_COMMANDS, "Development replay limit reached or malformed history");
  let evaluationClock = 0;
  const v1Wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => evaluationClock });
  const current: Replayed = { v1Wallet, state: v1Wallet.snapshot(), revision: 0, lastHash: GENESIS, clock: 0,
    keys: new Map(), expected: emptyV3Projection(), setClock(at) { evaluationClock = at; } };
  for (const row of records) {
    const revision = safeInteger(row.revision), at = safeInteger(row.occurred_at_ms);
    verify(revision === current.revision + 1, "Wallet command sequence has a gap");
    verify(at >= current.clock, "Wallet command time moved backwards");
    let command: V3VersionedCommand;
    try { command = parseV3VersionedCommand(row.command_json); }
    catch { throw new WalletIntegrityError("Unknown or malformed durable command version"); }
    const commandKey = v3CommandKey(command), inputHash = walletDigest(command);
    verify(row.command_key === commandKey && row.command_type === command.type && row.input_hash === inputHash && !current.keys.has(commandKey),
      "Durable command identity mismatch");
    const before = current.state;
    let applied: { state: State | V2State | V3State; result: unknown };
    try {
      if (isV2State(before) && command.version === 2) verify(!findV2AcceptanceReplay(before, command), "A proposal acceptance was appended twice");
      if (isV3State(before) && command.version === 3) verify(!findV3InitialAcceptanceReplay(before, command), "An initial acceptance was appended twice");
      applied = applyNext(current, command, at);
    } catch { throw new WalletIntegrityError("A committed command no longer replays under its recorded engine"); }
    const resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
    verify(row.result_hash === resultHash && walletDigest(row.result_json) === resultHash && row.state_hash === stateHash,
      "Committed wallet result or state digest mismatch");
    const hash = eventDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: current.lastHash });
    verify(row.previous_event_hash === current.lastHash && row.event_hash === hash, "Wallet command hash chain mismatch");
    appendV3Projection(current.expected, v3ProjectionDelta(before, applied.state, revision));
    current.keys.set(commandKey, { revision, inputHash, eventHash: hash, result: structuredClone(applied.result) });
    current.state = applied.state; current.revision = revision; current.lastHash = hash; current.clock = at;
  }
  return current;
}
function publicSnapshot(current: Replayed): V3WalletSnapshot {
  return { revision: current.revision, eventHash: current.lastHash, lastCommandAtMs: current.clock, occurredAtMs: current.clock,
    engineVersion: isV3State(current.state) ? WALLET_V3_ENGINE_VERSION : isV2State(current.state) ? WALLET_V2_ENGINE_VERSION : WALLET_ENGINE_VERSION,
    state: structuredClone(current.state) };
}

/** Logical validation, not canonical truth, authentication or restoration authority. */
export function verifyV3History(records: ReadonlyArray<Record<string, unknown>>): V3WalletSnapshot {
  assertSimulationRuntime("simulation-only");
  return publicSnapshot(replayHistory(records));
}

async function load(tx: WalletSql): Promise<Replayed> {
  const header = (await tx.query("SELECT format_version,mode FROM alpha_wallet_simulation.head WHERE singleton=true")).rows;
  verify(header.length === 1 && [1, 2, 3].includes(header[0]?.format_version as number) && header[0]?.mode === "simulation-only",
    "Unsupported v3 wallet head");
  // Before the explicit DDL transition, the original v2 gate remains intact.
  await tx.query("SELECT set_config('alpha_wallet.writer_protocol', $1, true)",
    [header[0]!.format_version === 3 ? "simulation-v3" : "simulation-v2"]);
  const rows = await tx.query(`UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true
    RETURNING revision,last_event_hash,format_version,mode`);
  const head = rows.rows[0];
  verify(rows.rows.length === 1 && head?.format_version === header[0]!.format_version && head.mode === "simulation-only",
    "V3 wallet storage identity changed");
  const current = replayHistory((await tx.query(SELECT_COMMANDS)).rows);
  verify(safeInteger(head.revision) === current.revision && head.last_event_hash === current.lastHash, "Wallet head and immutable history disagree");
  verify(head.format_version === formatFor(current.state), "Wallet storage and engine version disagree");
  await verifyV3Projection(tx, current.expected, head.format_version as 1 | 2 | 3);
  return current;
}

function originalResult(current: Replayed, command: V3VersionedCommand, commandKey: string, prior: Prior): DurableExecution {
  let result = structuredClone(prior.result);
  if (command.type === "beginDispatch") {
    const payout = current.state.payouts.get(command.input);
    verify(payout, "Historical dispatch payout is missing");
    result = { shouldDispatch: false, payout: structuredClone(payout) };
  }
  return { revision: prior.revision, commandKey, replayed: true, result, eventHash: prior.eventHash };
}
async function append(tx: WalletSql, current: Replayed, command: V3VersionedCommand, at: number,
  applied = applyNext(current, command, at)): Promise<DurableExecution> {
  verify(current.revision < MAX_COMMANDS, "Development command limit reached; reviewed checkpointing is required");
  verify(at >= current.clock, "Current clock precedes durable history");
  const commandKey = v3CommandKey(command), inputHash = walletDigest(command);
  const revision = current.revision + 1, resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
  const hash = eventDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: current.lastHash });
  await tx.query(`INSERT INTO alpha_wallet_simulation.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,
    result_json,result_hash,state_hash,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
  [revision, commandKey, command.type, at, JSON.stringify(command), inputHash, JSON.stringify(walletJson(applied.result)), resultHash, stateHash, current.lastHash, hash]);
  const delta = v3ProjectionDelta(current.state, applied.state, revision);
  await writeV3Projection(tx, delta);
  await tx.query(`UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2,format_version=$3 WHERE singleton=true`,
    [revision, hash, formatFor(applied.state)]);
  appendV3Projection(current.expected, delta);
  await verifyV3Projection(tx, current.expected, formatFor(applied.state));
  return { revision, commandKey, replayed: false, result: structuredClone(applied.result), eventHash: hash };
}

/**
 * Private financial simulation only. It does not initialize, upgrade, activate a
 * canonical cohort, authenticate a seller, or create canonical marketplace rows.
 */
export function createV3DurableWallet(options: { mode: "simulation-only"; store: WalletStore; clock?: () => number }) {
  assertSimulationRuntime(options.mode);
  const { store } = options, clock = options.clock ?? Date.now;
  return Object.freeze({
    async execute<C extends V3VersionedCommand>(input: C): Promise<DurableExecution<V3VersionedResultOf<C>>> {
      assertSimulationRuntime(options.mode);
      const command = parseV3VersionedCommand(input);
      return inOwnedTransaction(store, async tx => {
        const current = await load(tx), commandKey = v3CommandKey(command), inputHash = walletDigest(command);
        const prior = current.keys.get(commandKey);
        if (prior) {
          verify(prior.inputHash === inputHash, "Idempotency key reused with different payload or engine version");
          return originalResult(current, command, commandKey, prior) as DurableExecution<V3VersionedResultOf<C>>;
        }
        if (command.version === 2 && (isV2State(current.state) || isV3State(current.state))) {
          // Preserve read-only business recovery of a historical buyer receipt;
          // this view is never submitted to the old reducer for a new action.
          const historical = isV3State(current.state) ? baseV2StateForV3(current.state) : current.state;
          const receipt = findV2AcceptanceReplay(historical, command);
          if (receipt) {
            const original = current.keys.get(receipt.commandKey);
            verify(original && original.revision === receipt.commandRevision && walletDigest(original.result) === walletDigest(receipt),
              "Historical acceptance receipt and original command disagree");
            return originalResult(current, command, receipt.commandKey, original) as DurableExecution<V3VersionedResultOf<C>>;
          }
        }
        verify(command.version === 3 && isV3State(current.state), "New commands require the explicit v3 continuation and v3 envelope");
        const receipt = findV3InitialAcceptanceReplay(current.state, command);
        if (receipt) {
          const original = current.keys.get(receipt.commandKey);
          verify(original && original.revision === receipt.commandRevision && walletDigest(original.result) === walletDigest(receipt),
            "Initial acceptance receipt and original command disagree");
          return originalResult(current, command, receipt.commandKey, original) as DurableExecution<V3VersionedResultOf<C>>;
        }
        verify(command.type !== "continueFromV2", "A new continuation requires explicit upgradeDurableWalletV3");
        const at = safeInteger(clock());
        return await append(tx, current, command, at) as DurableExecution<V3VersionedResultOf<C>>;
      });
    },
    async snapshot(): Promise<V3WalletSnapshot> {
      assertSimulationRuntime(options.mode);
      return inOwnedTransaction(store, async tx => publicSnapshot(await load(tx)));
    },
    async recoverPayouts() {
      assertSimulationRuntime(options.mode);
      return inOwnedTransaction(store, async tx => {
        const state = (await load(tx)).state;
        return [...state.payouts.values()].map(payout => ({ payout: structuredClone(payout),
          action: payout.state === "confirmed" ? "already_confirmed" : payout.state === "failed_final" ? "manual_recovery_required"
            : ["submitting", "submission_unknown", "broadcast"].includes(payout.state) ? "lookup_original_reference" : "held_by_policy",
        } as { payout: Payout; action: "already_confirmed" | "manual_recovery_required" | "lookup_original_reference" | "held_by_policy" }));
      });
    },
  });
}
export type V3DurableWallet = ReturnType<typeof createV3DurableWallet>;

/** The exact source-bound migration and v3 continuation share one real owner. */
export async function upgradeDurableWalletV3(options: {
  mode: "simulation-only"; store: WalletStore; command: V3CommandOf<"continueFromV2">;
  acknowledgeVersionUpgrade: true; clock?: () => number;
}): Promise<DurableExecution<V3ResultOf<"continueFromV2">>> {
  assertSimulationRuntime(options.mode);
  verify(options.acknowledgeVersionUpgrade === true, "Explicit acknowledgment of the one-way development upgrade is required");
  const command = parseV3Command(options.command);
  verify(command.type === "continueFromV2", "Only the exact v3 continuation command may upgrade storage");
  const clock = options.clock ?? Date.now;
  return inOwnedTransaction(options.store, async tx => {
    const current = await load(tx), key = v3CommandKey(command), inputHash = walletDigest(command);
    const prior = current.keys.get(key);
    if (prior) {
      verify(prior.inputHash === inputHash && isV3State(current.state), "V3 upgrade identity changed or did not commit");
      return originalResult(current, command, key, prior) as DurableExecution<V3ResultOf<"continueFromV2">>;
    }
    verify(isV2State(current.state), "A v3 upgrade requires intact v2 history without a prior v3 continuation");
    const at = safeInteger(clock());
    verify(at >= current.clock, "Upgrade clock precedes durable history");
    const applied = applyNext(current, command, at);
    // Flush the retained v2 constraints under their original protocol before
    // ALTER TABLE. The v3 migration replaces their interval validation without
    // changing any historical command, projection or hash.
    await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
    await tx.exec("SET CONSTRAINTS ALL DEFERRED");
    await tx.query("SELECT set_config('alpha_wallet.schema_upgrade', 'v2-to-v3', true)");
    await tx.query("SELECT set_config('alpha_wallet.v3_upgrade_command', $1, true)", [JSON.stringify(command)]);
    await tx.query("SELECT set_config('alpha_wallet.v3_upgrade_key', $1, true)", [key]);
    await tx.exec(readFileSync(resolve("docs/alpha-wallet/durable-v3-migration.sql"), "utf8"));
    return await append(tx, current, command, at, applied) as DurableExecution<V3ResultOf<"continueFromV2">>;
  });
}
