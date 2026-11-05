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
import { WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { applyV3Command, assertV3Invariants, baseV2StateForV3, findV3InitialAcceptanceReplay, isV3State, type V3State } from "./v3-engine";
import { parseV4Command, parseV4VersionedCommand, v4CommandKey, WALLET_V4_ENGINE_VERSION,
  type V4CommandOf, type V4ResultOf, type V4VersionedCommand, type V4VersionedResultOf } from "./v4-commands";
import { applyV4Command, assertV4Invariants, baseV3StateForV4, findV4InitialCancellationReplay, isV4State, type V4State } from "./v4-engine";
import { appendV4Projection, emptyV4Projection, v4ProjectionDelta, verifyV4Projection,
  writeV4Projection, type V4Projection } from "./v4-projections";

const GENESIS = "0".repeat(64);
const MAX_COMMANDS = 100_000;
const SELECT_COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms,command_json,input_hash,result_json,
  result_hash,state_hash,previous_event_hash,event_hash FROM alpha_wallet_simulation.commands ORDER BY revision LIMIT 100001`;
type Row = Record<string, unknown>;
type Prior = { revision: number; inputHash: string; eventHash: string; result: unknown };
export type V4WalletSnapshot = {
  revision: number; eventHash: string; lastCommandAtMs: number; occurredAtMs: number;
  engineVersion: typeof WALLET_ENGINE_VERSION | typeof WALLET_V2_ENGINE_VERSION | typeof WALLET_V3_ENGINE_VERSION | typeof WALLET_V4_ENGINE_VERSION;
  state: State | V2State | V3State | V4State;
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
function formatFor(state: State): 1 | 2 | 3 | 4 { return isV4State(state) ? 4 : isV3State(state) ? 3 : isV2State(state) ? 2 : 1; }

type TransactionContext = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
async function transactionContext(tx: WalletSql, expected?: string) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<TransactionContext>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema', true) AS development_mode`);
  assertSimulationRuntime("simulation-only");
  const context = result.rows[0];
  verify(result.rows.length === 1 && typeof context?.transaction_id === "string" && /^[1-9][0-9]*$/.test(context.transaction_id),
    "V4 wallet requires a transaction identity");
  verify(expected === undefined || context.transaction_id === expected, "V4 wallet transaction identity changed or ended");
  verify(context.isolation === "serializable" && context.read_only === "off" && context.development_mode === "simulation-only",
    "V4 wallet requires an explicit writable SERIALIZABLE simulation transaction");
  return context.transaction_id;
}
async function assertNoCanonicalCohort(tx: WalletSql) {
  const found = await tx.query(`SELECT nspname FROM pg_namespace WHERE nspname IN ('alpha_wallet_marketplace_simulation','alpha_wallet_initial_marketplace_simulation')`);
  verify(found.rows.length === 0, "V4 financial development refuses every existing canonical coordination namespace");
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
            await tx.query("SELECT 1 / 0 /* abort failed v4 wallet participant */");
          }
        } catch { /* Preserve the original rejection; foreign identities are never aborted. */ }
      }
      throw error;
    }
  });
}

type Replayed = {
  v1Wallet: AlphaWalletSandbox; state: State | V2State | V3State | V4State; revision: number; lastHash: string; clock: number;
  keys: Map<string, Prior>; expected: V4Projection; setClock(at: number): void;
};
function checkpoint(current: Pick<Replayed, "revision" | "lastHash" | "clock" | "state">): V2Checkpoint {
  return { revision: current.revision, eventHash: current.lastHash, stateHash: walletDigest(current.state), lastCommandAtMs: current.clock };
}
function applyNext(current: Replayed, command: V4VersionedCommand, at: number): { state: State | V2State | V3State | V4State; result: unknown } {
  if (command.version === 1) {
    verify(formatFor(current.state) === 1, "New v1 commands are fenced after their continuation");
    current.setClock(at);
    const result = applyWalletCommand(current.v1Wallet, command);
    current.v1Wallet.assertInvariants();
    return { state: current.v1Wallet.snapshot(), result };
  }
  if (command.version === 2) {
    verify(!isV3State(current.state) && !isV4State(current.state), "New v2 commands are fenced after their continuation");
    const applied = applyV2Command(current.state, command, { ...checkpoint(current), at });
    assertV2Invariants(applied.state);
    return applied;
  }
  if (command.version === 3) {
    verify(!isV4State(current.state), "New v3 commands are fenced after the v4 continuation");
    const applied = applyV3Command(current.state, command, { ...checkpoint(current), at });
    assertV3Invariants(applied.state);
    return applied;
  }
  const applied = applyV4Command(current.state, command, { ...checkpoint(current), at });
  assertV4Invariants(applied.state);
  return applied;
}

/** Each old prefix runs through its original reducer and strict envelope. */
function replayHistory(records: ReadonlyArray<Row>): Replayed {
  verify(Array.isArray(records) && records.length <= MAX_COMMANDS, "Development replay limit reached or malformed history");
  let evaluationClock = 0;
  const v1Wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => evaluationClock });
  const current: Replayed = { v1Wallet, state: v1Wallet.snapshot(), revision: 0, lastHash: GENESIS, clock: 0,
    keys: new Map(), expected: emptyV4Projection(), setClock(at) { evaluationClock = at; } };
  for (const row of records) {
    const revision = safeInteger(row.revision), at = safeInteger(row.occurred_at_ms);
    verify(revision === current.revision + 1, "Wallet command sequence has a gap");
    verify(at >= current.clock, "Wallet command time moved backwards");
    let command: V4VersionedCommand;
    try { command = parseV4VersionedCommand(row.command_json); }
    catch { throw new WalletIntegrityError("Unknown or malformed durable command version"); }
    const commandKey = v4CommandKey(command), inputHash = walletDigest(command);
    verify(row.command_key === commandKey && row.command_type === command.type && row.input_hash === inputHash && !current.keys.has(commandKey),
      "Durable command identity mismatch");
    const before = current.state;
    let applied: { state: State | V2State | V3State | V4State; result: unknown };
    try {
      if (isV2State(before) && command.version === 2) verify(!findV2AcceptanceReplay(before, command), "A proposal acceptance was appended twice");
      if (isV3State(before) && command.version === 3) verify(!findV3InitialAcceptanceReplay(before, command), "An initial acceptance was appended twice");
      if (isV4State(before) && command.version === 4) verify(!findV4InitialCancellationReplay(before, command), "An initial cancellation was appended twice");
      applied = applyNext(current, command, at);
    } catch { throw new WalletIntegrityError("A committed command no longer replays under its recorded engine"); }
    const resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
    verify(row.result_hash === resultHash && walletDigest(row.result_json) === resultHash && row.state_hash === stateHash,
      "Committed wallet result or state digest mismatch");
    const hash = eventDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: current.lastHash });
    verify(row.previous_event_hash === current.lastHash && row.event_hash === hash, "Wallet command hash chain mismatch");
    appendV4Projection(current.expected, v4ProjectionDelta(before, applied.state, revision));
    current.keys.set(commandKey, { revision, inputHash, eventHash: hash, result: structuredClone(applied.result) });
    current.state = applied.state; current.revision = revision; current.lastHash = hash; current.clock = at;
  }
  return current;
}
function publicSnapshot(current: Replayed): V4WalletSnapshot {
  return { revision: current.revision, eventHash: current.lastHash, lastCommandAtMs: current.clock, occurredAtMs: current.clock,
    engineVersion: isV4State(current.state) ? WALLET_V4_ENGINE_VERSION : isV3State(current.state) ? WALLET_V3_ENGINE_VERSION : isV2State(current.state) ? WALLET_V2_ENGINE_VERSION : WALLET_ENGINE_VERSION,
    state: structuredClone(current.state) };
}

/** Logical validation, not canonical truth, authentication or restoration authority. */
export function verifyV4History(records: ReadonlyArray<Record<string, unknown>>): V4WalletSnapshot {
  assertSimulationRuntime("simulation-only");
  return publicSnapshot(replayHistory(records));
}

async function load(tx: WalletSql): Promise<Replayed> {
  const header = (await tx.query("SELECT format_version,mode FROM alpha_wallet_simulation.head WHERE singleton=true")).rows;
  verify(header.length === 1 && [1, 2, 3, 4].includes(header[0]?.format_version as number) && header[0]?.mode === "simulation-only",
    "Unsupported v4 wallet head");
  // Before the explicit DDL transition, each original protocol gate remains intact.
  await tx.query("SELECT set_config('alpha_wallet.writer_protocol', $1, true)",
    [header[0]!.format_version === 4 ? "simulation-v4" : header[0]!.format_version === 3 ? "simulation-v3" : "simulation-v2"]);
  const rows = await tx.query(`UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true
    RETURNING revision,last_event_hash,format_version,mode`);
  const head = rows.rows[0];
  verify(rows.rows.length === 1 && head?.format_version === header[0]!.format_version && head.mode === "simulation-only",
    "V4 wallet storage identity changed");
  const current = replayHistory((await tx.query(SELECT_COMMANDS)).rows);
  verify(safeInteger(head.revision) === current.revision && head.last_event_hash === current.lastHash, "Wallet head and immutable history disagree");
  verify(head.format_version === formatFor(current.state), "Wallet storage and engine version disagree");
  await verifyV4Projection(tx, current.expected, head.format_version as 1 | 2 | 3 | 4);
  return current;
}

function originalResult(current: Replayed, command: V4VersionedCommand, commandKey: string, prior: Prior): DurableExecution {
  let result = structuredClone(prior.result);
  if (command.type === "beginDispatch") {
    const payout = current.state.payouts.get(command.input);
    verify(payout, "Historical dispatch payout is missing");
    result = { shouldDispatch: false, payout: structuredClone(payout) };
  }
  return { revision: prior.revision, commandKey, replayed: true, result, eventHash: prior.eventHash };
}
async function append(tx: WalletSql, current: Replayed, command: V4VersionedCommand, at: number,
  applied = applyNext(current, command, at)): Promise<DurableExecution> {
  verify(current.revision < MAX_COMMANDS, "Development command limit reached; reviewed checkpointing is required");
  verify(at >= current.clock, "Current clock precedes durable history");
  const commandKey = v4CommandKey(command), inputHash = walletDigest(command);
  const revision = current.revision + 1, resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
  const hash = eventDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: current.lastHash });
  await tx.query(`INSERT INTO alpha_wallet_simulation.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,
    result_json,result_hash,state_hash,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
  [revision, commandKey, command.type, at, JSON.stringify(command), inputHash, JSON.stringify(walletJson(applied.result)), resultHash, stateHash, current.lastHash, hash]);
  const delta = v4ProjectionDelta(current.state, applied.state, revision);
  await writeV4Projection(tx, delta);
  await tx.query(`UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2,format_version=$3 WHERE singleton=true`,
    [revision, hash, formatFor(applied.state)]);
  appendV4Projection(current.expected, delta);
  await verifyV4Projection(tx, current.expected, formatFor(applied.state));
  return { revision, commandKey, replayed: false, result: structuredClone(applied.result), eventHash: hash };
}

/**
 * Private financial simulation only. It does not initialize, upgrade, activate a
 * canonical cohort, authenticate a seller, or create canonical marketplace rows.
 */
export function createV4DurableWallet(options: { mode: "simulation-only"; store: WalletStore; clock?: () => number }) {
  assertSimulationRuntime(options.mode);
  const { store } = options, clock = options.clock ?? Date.now;
  return Object.freeze({
    async execute<C extends V4VersionedCommand>(input: C): Promise<DurableExecution<V4VersionedResultOf<C>>> {
      assertSimulationRuntime(options.mode);
      // Capture caller-owned input synchronously. Defer a parse refusal until
      // the supplied transaction has been certified, so a caller cannot catch
      // it and commit a companion write from that same physical transaction.
      const captured = (() => {
        try { return { command: parseV4VersionedCommand(input) }; }
        catch (error) { return { error }; }
      })();
      return inOwnedTransaction(store, async tx => {
        if (!captured.command) throw captured.error;
        const command = captured.command;
        const current = await load(tx), commandKey = v4CommandKey(command), inputHash = walletDigest(command);
        const prior = current.keys.get(commandKey);
        if (prior) {
          verify(prior.inputHash === inputHash, "Idempotency key reused with different payload or engine version");
          return originalResult(current, command, commandKey, prior) as DurableExecution<V4VersionedResultOf<C>>;
        }
        // Frozen source views recover immutable receipts only. They are never
        // submitted to an older reducer for new work.
        const historical3 = isV4State(current.state) ? baseV3StateForV4(current.state) : current.state;
        if (command.version === 2 && (isV2State(historical3) || isV3State(historical3))) {
          const receipt = findV2AcceptanceReplay(isV3State(historical3) ? baseV2StateForV3(historical3) : historical3, command);
          if (receipt) {
            const original = current.keys.get(receipt.commandKey);
            verify(original && original.revision === receipt.commandRevision && walletDigest(original.result) === walletDigest(receipt),
              "Historical acceptance receipt and original command disagree");
            return originalResult(current, command, receipt.commandKey, original) as DurableExecution<V4VersionedResultOf<C>>;
          }
        }
        if (command.version === 3 && isV3State(historical3)) {
          const receipt = findV3InitialAcceptanceReplay(historical3, command);
          if (receipt) {
            const original = current.keys.get(receipt.commandKey);
            verify(original && original.revision === receipt.commandRevision && walletDigest(original.result) === walletDigest(receipt),
              "Initial acceptance receipt and original command disagree");
            return originalResult(current, command, receipt.commandKey, original) as DurableExecution<V4VersionedResultOf<C>>;
          }
        }
        verify(command.version === 4 && isV4State(current.state), "New commands require the explicit v4 continuation and v4 envelope");
        const receipt = findV4InitialCancellationReplay(current.state, command);
        if (receipt) {
          const original = current.keys.get(receipt.commandKey);
          verify(original && original.revision === receipt.commandRevision && walletDigest(original.result) === walletDigest(receipt),
            "Initial cancellation receipt and original command disagree");
          return originalResult(current, command, receipt.commandKey, original) as DurableExecution<V4VersionedResultOf<C>>;
        }
        verify(command.type !== "continueFromV3", "A new continuation requires explicit upgradeDurableWalletV4");
        const at = safeInteger(clock());
        return await append(tx, current, command, at) as DurableExecution<V4VersionedResultOf<C>>;
      });
    },
    async snapshot(): Promise<V4WalletSnapshot> {
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
export type V4DurableWallet = ReturnType<typeof createV4DurableWallet>;

/** The exact source-bound migration and v4 continuation share one real owner. */
export async function upgradeDurableWalletV4(options: {
  mode: "simulation-only"; store: WalletStore; command: V4CommandOf<"continueFromV3">;
  acknowledgeVersionUpgrade: true; clock?: () => number;
}): Promise<DurableExecution<V4ResultOf<"continueFromV3">>> {
  assertSimulationRuntime(options.mode);
  const { store, acknowledgeVersionUpgrade, clock = Date.now } = options;
  const captured = (() => {
    try { return { command: parseV4Command(options.command) }; }
    catch (error) { return { error }; }
  })();
  return inOwnedTransaction(store, async tx => {
    verify(acknowledgeVersionUpgrade === true, "Explicit acknowledgment of the one-way development upgrade is required");
    if (!captured.command) throw captured.error;
    const command = captured.command;
    verify(command.type === "continueFromV3", "Only the exact v4 continuation command may upgrade storage");
    const current = await load(tx), key = v4CommandKey(command), inputHash = walletDigest(command);
    const prior = current.keys.get(key);
    if (prior) {
      verify(prior.inputHash === inputHash && isV4State(current.state), "V4 upgrade identity changed or did not commit");
      return originalResult(current, command, key, prior) as DurableExecution<V4ResultOf<"continueFromV3">>;
    }
    verify(isV3State(current.state), "A v4 upgrade requires intact v3 history without a prior v4 continuation");
    const at = safeInteger(clock());
    verify(at >= current.clock, "Upgrade clock precedes durable history");
    const applied = applyNext(current, command, at);
    // Flush the retained constraints under their original protocol before
    // ALTER TABLE. The v4 migration bounds historical interval validation without
    // changing any historical command, projection or hash.
    await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
    await tx.exec("SET CONSTRAINTS ALL DEFERRED");
    await tx.query("SELECT set_config('alpha_wallet.schema_upgrade', 'v3-to-v4', true)");
    await tx.query("SELECT set_config('alpha_wallet.v4_upgrade_command', $1, true)", [JSON.stringify(command)]);
    await tx.query("SELECT set_config('alpha_wallet.v4_upgrade_key', $1, true)", [key]);
    await tx.query("SELECT set_config('alpha_wallet.v4_source_halt_reason', $1, true)", [JSON.stringify(current.state.haltReason)]);
    await tx.exec(readFileSync(resolve("docs/alpha-wallet/durable-v4-migration.sql"), "utf8"));
    return await append(tx, current, command, at, applied) as DurableExecution<V4ResultOf<"continueFromV3">>;
  });
}
