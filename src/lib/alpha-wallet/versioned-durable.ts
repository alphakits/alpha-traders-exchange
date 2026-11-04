import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyWalletCommand, walletDigest, walletJson, WALLET_ENGINE_VERSION, type WalletCommand, type ResultOf } from "./commands";
import { WalletIntegrityError, type DurableExecution } from "./durable";
import type { WalletSql, WalletStore } from "./durable-store";
import { createAlphaWalletSandbox, type AlphaWalletSandbox } from "./sandbox";
import { assertSimulationRuntime } from "./runtime";
import type { Payout, State } from "./types";
import { parseVersionedCommand, parseV2Command, versionedCommandKey, WALLET_V2_ENGINE_VERSION,
  type V2Checkpoint, type V2Command, type V2CommandOf, type V2ResultOf, type VersionedCommand } from "./v2-commands";
import { applyV2Command, assertV2Invariants, findV2AcceptanceReplay, isV2State, type V2State } from "./v2-engine";
import { appendVersionedProjection, emptyVersionedProjection, verifyVersionedProjection, versionedProjectionDelta,
  writeVersionedProjection, type VersionedProjection } from "./versioned-projections";

const GENESIS = "0".repeat(64);
const MAX_COMMANDS = 100_000;
const SELECT_COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms,command_json,input_hash,result_json,
  result_hash,state_hash,previous_event_hash,event_hash FROM alpha_wallet_simulation.commands ORDER BY revision`;
type Row = Record<string, unknown>;
type Prior = { revision: number; inputHash: string; eventHash: string; result: unknown };
export type VersionedResultOf<C extends VersionedCommand> = C extends WalletCommand ? ResultOf<C["type"]>
  : C extends V2Command ? V2ResultOf<C["type"]> : never;
export type VersionedWalletSnapshot = {
  revision: number; eventHash: string; lastCommandAtMs: number; occurredAtMs: number;
  engineVersion: typeof WALLET_ENGINE_VERSION | typeof WALLET_V2_ENGINE_VERSION; state: State | V2State;
};

function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletIntegrityError(message);
}
function safeInteger(value: unknown) {
  const result = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  verify(Number.isSafeInteger(result) && result >= 0, "Invalid durable integer");
  return result;
}
// Deliberately identical to v1's event construction; no version namespace is added.
function eventDigest(row: { revision: number; commandKey: string; at: number; inputHash: string; resultHash: string; stateHash: string; previousHash: string }) {
  return walletDigest(row);
}

type TransactionContext = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
async function transactionContext(tx: WalletSql, expected?: string, full = true) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<TransactionContext>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema', true) AS development_mode`);
  assertSimulationRuntime("simulation-only");
  const current = result.rows[0];
  verify(result.rows.length === 1 && typeof current?.transaction_id === "string" && /^[1-9][0-9]*$/.test(current.transaction_id), "Versioned wallet requires a transaction identity");
  verify(expected === undefined || current.transaction_id === expected, "Versioned wallet transaction identity changed or ended");
  if (full) verify(current.isolation === "serializable" && current.read_only === "off" && current.development_mode === "simulation-only",
    "Versioned wallet requires an explicit writable SERIALIZABLE simulation transaction");
  return current.transaction_id;
}

/** One real owner supplies commit/retry. A bound adapter never starts a nested transaction. */
async function inOwnedTransaction<T>(store: WalletStore, work: (tx: WalletSql) => Promise<T>): Promise<T> {
  assertSimulationRuntime("simulation-only");
  return store.transaction(async tx => {
    let certified: string | undefined;
    try {
      const identity = await transactionContext(tx);
      await transactionContext(tx, identity); // An autocommit round trip cannot retain this identity.
      certified = identity;
      await tx.query("SELECT set_config('alpha_wallet.writer_protocol', 'simulation-v2', true)");
      const result = await work(tx);
      await transactionContext(tx, identity);
      return result;
    } catch (error) {
      if (certified !== undefined) {
        try {
          // A semantic rejection after DDL or projections must still roll back
          // when a transaction-bound caller mistakenly catches the exception.
          // Local guard changes do not make this already-certified tx foreign.
          await transactionContext(tx, certified, false);
          await tx.query("SELECT 1 / 0 /* abort failed versioned wallet participant */");
        } catch { /* Preserve the original failure; unknown identities are not touched. */ }
      }
      throw error;
    }
  });
}

type Replayed = {
  v1Wallet: AlphaWalletSandbox; state: State | V2State; revision: number; lastHash: string; clock: number;
  keys: Map<string, Prior>; expected: VersionedProjection; setClock(at: number): void;
};
function checkpoint(current: Pick<Replayed, "revision" | "lastHash" | "clock" | "state">): V2Checkpoint {
  return { revision: current.revision, eventHash: current.lastHash, stateHash: walletDigest(current.state), lastCommandAtMs: current.clock };
}

function applyNext(current: Replayed, command: VersionedCommand, at: number) {
  if (command.version === 1) {
    verify(!isV2State(current.state), "New v1 commands are fenced after the v2 continuation");
    current.setClock(at);
    const result = applyWalletCommand(current.v1Wallet, command);
    current.v1Wallet.assertInvariants();
    return { state: current.v1Wallet.snapshot(), result };
  }
  const applied = applyV2Command(current.state, command, { ...checkpoint(current), at });
  assertV2Invariants(applied.state);
  return applied;
}

/** Reconstruct the original v1 prefix with its original engine, then the strict v2 continuation. */
function replayHistory(records: ReadonlyArray<Row>): Replayed {
  verify(Array.isArray(records) && records.length <= MAX_COMMANDS, "Development replay limit reached or malformed history");
  let evaluationClock = 0;
  const v1Wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => evaluationClock });
  const current: Replayed = { v1Wallet, state: v1Wallet.snapshot(), revision: 0, lastHash: GENESIS, clock: 0,
    keys: new Map(), expected: emptyVersionedProjection(), setClock(at) { evaluationClock = at; } };
  for (const row of records) {
    const revision = safeInteger(row.revision);
    verify(revision === current.revision + 1, "Wallet command sequence has a gap");
    const at = safeInteger(row.occurred_at_ms);
    verify(at >= current.clock, "Wallet command time moved backwards");
    let command: VersionedCommand;
    try { command = parseVersionedCommand(row.command_json); }
    catch { throw new WalletIntegrityError("Unknown or malformed durable command version"); }
    const commandKey = versionedCommandKey(command), inputHash = walletDigest(command);
    verify(row.command_key === commandKey && row.command_type === command.type && row.input_hash === inputHash && !current.keys.has(commandKey),
      "Durable command identity mismatch");
    const before = current.state;
    let applied: { state: State | V2State; result: unknown };
    try {
      // Business replay is resolved without appending another transport command.
      if (isV2State(before) && command.version === 2) verify(!findV2AcceptanceReplay(before, command), "A proposal acceptance was appended twice");
      applied = applyNext(current, command, at);
    } catch { throw new WalletIntegrityError("A committed command no longer replays under its recorded engine"); }
    const resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
    verify(row.result_hash === resultHash && walletDigest(row.result_json) === resultHash && row.state_hash === stateHash,
      "Committed wallet result or state digest mismatch");
    const hash = eventDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: current.lastHash });
    verify(row.previous_event_hash === current.lastHash && row.event_hash === hash, "Wallet command hash chain mismatch");
    appendVersionedProjection(current.expected, versionedProjectionDelta(before, applied.state, revision));
    current.keys.set(commandKey, { revision, inputHash, eventHash: hash, result: structuredClone(applied.result) });
    current.state = applied.state; current.revision = revision; current.lastHash = hash; current.clock = at;
  }
  return current;
}

function publicSnapshot(current: Replayed): VersionedWalletSnapshot {
  return { revision: current.revision, eventHash: current.lastHash, lastCommandAtMs: current.clock, occurredAtMs: current.clock,
    engineVersion: isV2State(current.state) ? WALLET_V2_ENGINE_VERSION : WALLET_ENGINE_VERSION, state: structuredClone(current.state) };
}

/** Logical consistency validation only; not authentication or permission to restore/upgrade. */
export function verifyVersionedHistory(records: ReadonlyArray<Record<string, unknown>>): VersionedWalletSnapshot {
  assertSimulationRuntime("simulation-only");
  return publicSnapshot(replayHistory(records));
}

async function load(tx: WalletSql): Promise<Replayed> {
  const rows = await tx.query(`UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true
    RETURNING revision,last_event_hash,format_version,mode`);
  const head = rows.rows[0];
  verify(rows.rows.length === 1 && (head?.format_version === 1 || head?.format_version === 2) && head.mode === "simulation-only", "Unsupported versioned wallet head");
  const records = (await tx.query(SELECT_COMMANDS)).rows;
  const current = replayHistory(records);
  verify(safeInteger(head.revision) === current.revision && head.last_event_hash === current.lastHash, "Wallet head and immutable history disagree");
  verify(head.format_version === (isV2State(current.state) ? 2 : 1), "Wallet storage and engine version disagree");
  await verifyVersionedProjection(tx, current.expected, head.format_version);
  return current;
}

function originalResult(current: Replayed, command: VersionedCommand, commandKey: string, prior: Prior): DurableExecution {
  let result = structuredClone(prior.result);
  if (command.type === "beginDispatch") {
    const payout = current.state.payouts.get(command.input);
    verify(payout, "Historical dispatch payout is missing");
    result = { shouldDispatch: false, payout: structuredClone(payout) };
  }
  return { revision: prior.revision, commandKey, replayed: true, result, eventHash: prior.eventHash };
}

async function append(tx: WalletSql, current: Replayed, command: VersionedCommand, at: number,
  applied = applyNext(current, command, at)): Promise<DurableExecution> {
  verify(current.revision < MAX_COMMANDS, "Development command limit reached; reviewed checkpointing is required");
  verify(at >= current.clock, "Current clock precedes durable history");
  const commandKey = versionedCommandKey(command), inputHash = walletDigest(command);
  const revision = current.revision + 1, resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
  const hash = eventDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: current.lastHash });
  await tx.query(`INSERT INTO alpha_wallet_simulation.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,
    result_json,result_hash,state_hash,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
  [revision, commandKey, command.type, at, JSON.stringify(command), inputHash, JSON.stringify(walletJson(applied.result)), resultHash, stateHash, current.lastHash, hash]);
  const delta = versionedProjectionDelta(current.state, applied.state, revision);
  await writeVersionedProjection(tx, delta);
  await tx.query(`UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2,format_version=$3 WHERE singleton=true`,
    [revision, hash, isV2State(applied.state) ? 2 : 1]);
  appendVersionedProjection(current.expected, delta);
  await verifyVersionedProjection(tx, current.expected, isV2State(applied.state) ? 2 : 1);
  return { revision, commandKey, replayed: false, result: structuredClone(applied.result), eventHash: hash };
}

/** Does not initialize or upgrade stores. Only explicit guarded local WalletStores are supported. */
export function createVersionedDurableWallet(options: { mode: "simulation-only"; store: WalletStore; clock?: () => number }) {
  assertSimulationRuntime(options.mode);
  const { store } = options, clock = options.clock ?? Date.now;
  return Object.freeze({
    async execute<C extends VersionedCommand>(input: C): Promise<DurableExecution<VersionedResultOf<C>>> {
      assertSimulationRuntime(options.mode);
      const command = parseVersionedCommand(input);
      return inOwnedTransaction(store, async tx => {
        const current = await load(tx), commandKey = versionedCommandKey(command), inputHash = walletDigest(command);
        const prior = current.keys.get(commandKey);
        if (prior) {
          verify(prior.inputHash === inputHash, "Idempotency key reused with different payload or engine version");
          return originalResult(current, command, commandKey, prior) as DurableExecution<VersionedResultOf<C>>;
        }
        if (isV2State(current.state) && command.version === 2) {
          const receipt = findV2AcceptanceReplay(current.state, command);
          if (receipt) {
            const original = current.keys.get(receipt.commandKey);
            verify(original && original.revision === receipt.commandRevision && walletDigest(original.result) === walletDigest(receipt), "Acceptance receipt and original command disagree");
            return originalResult(current, command, receipt.commandKey, original) as DurableExecution<VersionedResultOf<C>>;
          }
        }
        verify(command.type !== "continueFromV1", "A new continuation requires explicit upgradeDurableWalletV2");
        const at = safeInteger(clock());
        verify(at >= current.clock, "Current clock precedes durable history");
        return await append(tx, current, command, at) as DurableExecution<VersionedResultOf<C>>;
      });
    },
    async snapshot(): Promise<VersionedWalletSnapshot> {
      assertSimulationRuntime(options.mode);
      return inOwnedTransaction(store, async tx => publicSnapshot(await load(tx)));
    },
    async recoverPayouts() {
      assertSimulationRuntime(options.mode);
      return inOwnedTransaction(store, async tx => {
        const state = (await load(tx)).state;
        return [...state.payouts.values()].map(payout => ({ payout: structuredClone(payout),
          action: payout.state === "confirmed" ? "already_confirmed" : payout.state === "failed_final" ? "manual_recovery_required"
            : ["submitting", "submission_unknown", "broadcast"].includes(payout.state) ? "lookup_original_reference"
            : state.haltReason || (payout.tradeId && state.trades.get(payout.tradeId)?.disputed) ? "held_by_policy" : "requires_current_policy_checks",
        } as { payout: Payout; action: "already_confirmed" | "manual_recovery_required" | "lookup_original_reference" | "held_by_policy" | "requires_current_policy_checks" }));
      });
    },
  });
}
export type VersionedDurableWallet = ReturnType<typeof createVersionedDurableWallet>;

/**
 * Explicit, one-way development migration AND continuation in ONE owned
 * transaction. Existing v1 initialization never calls this operation.
 * Binding this to an outer transaction is supported, but only that owner commits.
 */
export async function upgradeDurableWalletV2(options: {
  mode: "simulation-only"; store: WalletStore; command: V2CommandOf<"continueFromV1">;
  acknowledgeVersionUpgrade: true; clock?: () => number;
}): Promise<DurableExecution<V2ResultOf<"continueFromV1">>> {
  assertSimulationRuntime(options.mode);
  verify(options.acknowledgeVersionUpgrade === true, "Explicit acknowledgment of the one-way development upgrade is required");
  const command = parseV2Command(options.command);
  verify(command.type === "continueFromV1", "Only the exact continuation command may upgrade storage");
  const clock = options.clock ?? Date.now;
  return inOwnedTransaction(options.store, async tx => {
    const current = await load(tx), key = versionedCommandKey(command), inputHash = walletDigest(command);
    const prior = current.keys.get(key);
    if (prior) {
      verify(prior.inputHash === inputHash && isV2State(current.state), "Version upgrade identity changed or did not commit");
      return originalResult(current, command, key, prior) as DurableExecution<V2ResultOf<"continueFromV1">>;
    }
    verify(!isV2State(current.state), "The wallet already continued under a different upgrade identity");
    const at = safeInteger(clock());
    verify(at >= current.clock, "Upgrade clock precedes durable history");
    // Reject a wrong actor/checkpoint before executing any migration DDL.
    const applied = applyNext(current, command, at);
    // PostgreSQL cannot ALTER a table with pending constraint-trigger events.
    // Flush the already-verified v1 transaction, then restore deferred checks
    // before creating the registry with its forward continuation FK.
    await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
    await tx.exec("SET CONSTRAINTS ALL DEFERRED");
    await tx.query("SELECT set_config('alpha_wallet.schema_upgrade', 'v1-to-v2', true)");
    await tx.query("SELECT set_config('alpha_wallet.v2_upgrade_command', $1, true)", [JSON.stringify(command)]);
    await tx.query("SELECT set_config('alpha_wallet.v2_upgrade_key', $1, true)", [key]);
    const migration = readFileSync(resolve("docs/alpha-wallet/durable-v2-migration.sql"), "utf8");
    await tx.exec(migration);
    return await append(tx, current, command, at, applied) as DurableExecution<V2ResultOf<"continueFromV1">>;
  });
}
