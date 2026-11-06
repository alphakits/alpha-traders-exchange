import { z } from "zod";
import { MAX_WALLET_BACKUP_BYTES, MAX_WALLET_BACKUP_COMMANDS, WALLET_BACKUP_FORMAT,
  WalletBackupError, type WalletBackupCheckpoint } from "./backup";
import { parseWalletCommand, walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet } from "./durable";
import type { WalletSql, WalletStore } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "./versioned-durable";
import { createV3DurableWallet, upgradeDurableWalletV3 } from "./v3-durable";
import { createV4DurableWallet, upgradeDurableWalletV4 } from "./v4-durable";
import { parseV5VersionedCommand, v5Command, v5CommandKey, WALLET_V5_ENGINE_VERSION } from "./v5-commands";
import { isV5State } from "./v5-engine";
import { createV5DurableWallet, upgradeDurableWalletV5, verifyV5History } from "./v5-durable";

/** This is a wallet-only development format, never a canonical marketplace bundle. */
export const WALLET_V5_BACKUP_SCOPE = "isolated-v5-ledger" as const;
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const storedTimestamp = z.string().regex(/^(?:0|[1-9]\d{0,15})$/)
  .refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= 0, "Invalid command timestamp");
const recordSchema = z.strictObject({
  revision: z.number().int().positive().max(MAX_WALLET_BACKUP_COMMANDS),
  command_key: z.string().min(1).max(512), command_type: z.string().min(1).max(80), occurred_at_ms: storedTimestamp,
  command_json: z.unknown().refine(value => value !== undefined, "Missing command JSON"), input_hash: hex,
  result_json: z.unknown().refine(value => value !== undefined, "Missing result JSON"),
  result_hash: hex, state_hash: hex, previous_event_hash: hex, event_hash: hex,
});
const checkpointSchema = z.strictObject({ revision: z.number().int().min(0).max(MAX_WALLET_BACKUP_COMMANDS),
  eventHash: hex, stateHash: hex, lastCommandAtMs: timestamp });
const continuationSchema = z.strictObject({ checkpoint: checkpointSchema,
  commandRevision: z.number().int().positive().max(MAX_WALLET_BACKUP_COMMANDS), commandKey: z.string().min(1).max(512) });
const cancellationContinuationSchema = continuationSchema.extend({ sourceHaltReason: z.string().min(1).nullable() });
const envelopeSchema = z.strictObject({
  format: z.literal(WALLET_BACKUP_FORMAT), formatVersion: z.literal(5), scope: z.literal(WALLET_V5_BACKUP_SCOPE),
  mode: z.literal("simulation-only"), engineVersion: z.literal(WALLET_V5_ENGINE_VERSION), sourcePaused: z.literal(true),
  exportedAtMs: timestamp, checkpoint: checkpointSchema, continuation: continuationSchema, initialContinuation: continuationSchema, cancellationContinuation: cancellationContinuationSchema, paymentContinuation: cancellationContinuationSchema,
  commands: z.array(recordSchema).min(1).max(MAX_WALLET_BACKUP_COMMANDS), checksum: hex,
});
type V5Envelope = z.infer<typeof envelopeSchema>;
export type WalletV5BackupInspection = Omit<V5Envelope, "commands"> & { commandCount: number; initialAcceptanceCount: number; initialCancellationCount: number; initialPaymentClaimCount: number; initialDisputeFreezeCount: number };
export type WalletV5RestoreResult = {
  backup: WalletV5BackupInspection; restored: WalletBackupCheckpoint; quarantined: true; quarantineCommandKey: string;
};

function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletBackupError(message);
}
function checkedTime(clock: () => number) {
  const at = clock();
  verify(Number.isSafeInteger(at) && at >= 0, "Invalid backup/restore clock");
  return at;
}
function parsedDocument(serialized: string): unknown {
  assertSimulationRuntime("simulation-only");
  verify(typeof serialized === "string" && serialized.length > 0 && serialized.length <= MAX_WALLET_BACKUP_BYTES
    && Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES,
  "Backup must be a nonempty JSON document within the development size limit");
  try { return JSON.parse(serialized); }
  catch { throw new WalletBackupError("Unsupported, malformed, truncated, or oversized v5 wallet backup"); }
}
function validated(document: unknown, expectedChecksum?: string) {
  let envelope: V5Envelope;
  try { envelope = envelopeSchema.parse(document); }
  catch { throw new WalletBackupError("Unsupported, malformed, truncated, or oversized v5 wallet backup"); }
  const { checksum, ...body } = envelope;
  verify(walletDigest(body) === checksum, "Wallet backup checksum mismatch");
  if (expectedChecksum !== undefined) verify(hex.safeParse(expectedChecksum).success && expectedChecksum === checksum,
    "Wallet backup differs from the expected checksum");
  const recovered = verifyV5History(envelope.commands);
  verify(recovered.engineVersion === WALLET_V5_ENGINE_VERSION && isV5State(recovered.state),
    "The isolated v5 backup must terminate in its explicit v5 engine");
  verify(recovered.state.haltReason !== null && typeof recovered.state.haltReason === "string" && recovered.state.haltReason.length > 0,
    "The v5 source must be durably paused before export");
  verify(envelope.commands.length === envelope.checkpoint.revision && recovered.revision === envelope.checkpoint.revision
    && recovered.eventHash === envelope.checkpoint.eventHash && recovered.lastCommandAtMs === envelope.checkpoint.lastCommandAtMs
    && walletDigest(recovered.state) === envelope.checkpoint.stateHash, "Wallet backup checkpoint disagrees with verified history");
  verify(walletDigest(recovered.state.continuation) === walletDigest(envelope.continuation)
    && walletDigest(recovered.state.initialContinuation) === walletDigest(envelope.initialContinuation)
    && envelope.continuation.commandRevision < envelope.initialContinuation.commandRevision
    && walletDigest(recovered.state.cancellationContinuation) === walletDigest(envelope.cancellationContinuation)
    && envelope.initialContinuation.commandRevision < envelope.cancellationContinuation.commandRevision
    && walletDigest(recovered.state.paymentContinuation) === walletDigest(envelope.paymentContinuation)
    && envelope.cancellationContinuation.commandRevision < envelope.paymentContinuation.commandRevision
    && envelope.paymentContinuation.commandRevision <= envelope.checkpoint.revision,
  "Wallet backup continuations disagree with verified history");
  verify(envelope.exportedAtMs >= recovered.lastCommandAtMs, "Backup timestamp precedes its command history");
  return { envelope, initialAcceptanceCount: recovered.state.initialAcceptanceReceipts.size,
    initialCancellationCount: recovered.state.initialCancellationReceipts.size,
    initialPaymentClaimCount: recovered.state.initialPaymentClaimReceipts.size, initialDisputeFreezeCount: recovered.state.initialDisputeFreezeReceipts.size };
}
function summary(value: ReturnType<typeof validated>): WalletV5BackupInspection {
  const { commands, ...metadata } = value.envelope;
  return { ...metadata, commandCount: commands.length, initialAcceptanceCount: value.initialAcceptanceCount,
    initialCancellationCount: value.initialCancellationCount,
    initialPaymentClaimCount: value.initialPaymentClaimCount, initialDisputeFreezeCount: value.initialDisputeFreezeCount };
}

/** Replay and checksums establish consistency, not a signature or marketplace consent. */
export function inspectV5WalletBackup(serialized: string, options: { expectedChecksum?: string } = {}): WalletV5BackupInspection {
  return summary(validated(parsedDocument(serialized), options.expectedChecksum));
}

type TransactionContext = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
async function context(tx: WalletSql, expected?: string) {
  assertSimulationRuntime("simulation-only");
  const rows = (await tx.query<TransactionContext>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema', true) AS development_mode`)).rows;
  assertSimulationRuntime("simulation-only");
  const current = rows[0];
  verify(rows.length === 1 && current && /^[1-9][0-9]*$/.test(current.transaction_id)
    && (expected === undefined || current.transaction_id === expected), "V5 backup requires a stable owned transaction identity");
  verify(current.isolation === "serializable" && current.read_only === "off" && current.development_mode === "simulation-only",
    "V5 backup requires a writable SERIALIZABLE simulation transaction");
  return current.transaction_id;
}
async function owned<T>(store: WalletStore, work: (tx: WalletSql) => Promise<T>): Promise<T> {
  assertSimulationRuntime("simulation-only");
  return store.transaction(async tx => {
    let certified: string | undefined;
    try {
      const identity = await context(tx);
      await context(tx, identity);
      certified = identity;
      const value = await work(tx);
      await context(tx, identity);
      return value;
    } catch (error) {
      if (certified !== undefined) {
        try {
          // Physical identity only: a swallowed runtime refusal must still mark
          // the original owner failed. Never poison a replaced/autocommit tx.
          const rows = (await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
          if (rows.length === 1 && rows[0]?.transaction_id === certified) {
            await tx.query("SELECT 1 / 0 /* abort failed isolated v5 recovery participant */");
          }
        } catch { /* Preserve the original rejection. The owner handles rollback. */ }
      }
      throw error;
    }
  });
}
function bound(tx: WalletSql): WalletStore {
  return { transaction: work => work(tx), close: async () => { throw new WalletBackupError("The outer transaction owns this store"); } };
}

/** Reject even empty companion schemas: their rows cannot be preserved by this format. */
async function isolated(tx: WalletSql) {
  const other = await tx.query(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public','alpha_wallet_simulation') AND nspname NOT LIKE 'pg_%'`);
  const publicRelations = await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`);
  verify(other.rows.length === 0 && publicRelations.rows[0]?.count === "0",
    "V5 wallet-only recovery requires an isolated development database without canonical or coordination schemas");
}

/** Requires a paused, isolated v5 ledger; never upgrades or exports companion marketplace rows. */
export async function exportV5WalletBackup(options: { mode: "simulation-only"; store: WalletStore; clock?: () => number }): Promise<string> {
  assertSimulationRuntime(options.mode);
  return owned(options.store, async tx => {
    await isolated(tx);
    const snapshot = await createV5DurableWallet({ mode: "simulation-only", store: bound(tx) }).snapshot();
    verify(isV5State(snapshot.state), "Only an explicitly continued v5 ledger can use this backup format");
    verify(Boolean(snapshot.state.haltReason), "The v5 source must be durably paused before export");
    verify(snapshot.revision < MAX_WALLET_BACKUP_COMMANDS,
      "V5 backup must retain capacity for its mandatory restore quarantine command");
    const rows = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const commands = z.array(recordSchema).min(1).max(MAX_WALLET_BACKUP_COMMANDS - 1).parse(rows);
    verify(commands.length === snapshot.revision, "Wallet backup command count differs from verified state");
    const exportedAtMs = checkedTime(options.clock ?? Date.now);
    verify(exportedAtMs >= snapshot.lastCommandAtMs, "Backup timestamp precedes its command history");
    const body = { format: WALLET_BACKUP_FORMAT, formatVersion: 5 as const, scope: WALLET_V5_BACKUP_SCOPE,
      mode: "simulation-only" as const, engineVersion: WALLET_V5_ENGINE_VERSION, sourcePaused: true as const, exportedAtMs,
      checkpoint: { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state),
        lastCommandAtMs: snapshot.lastCommandAtMs }, continuation: continuationSchema.parse(snapshot.state.continuation),
      initialContinuation: continuationSchema.parse(snapshot.state.initialContinuation),
      cancellationContinuation: cancellationContinuationSchema.parse(snapshot.state.cancellationContinuation),
      paymentContinuation: cancellationContinuationSchema.parse(snapshot.state.paymentContinuation), commands };
    const serialized = JSON.stringify({ ...body, checksum: walletDigest(body) }, null, 2);
    verify(Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES, "Development backup byte limit exceeded");
    validated(JSON.parse(serialized));
    await isolated(tx);
    return serialized;
  });
}

/**
 * Restore the original v1/v2/v3/v4/v5 history and append a v5 quarantine in one owner
 * transaction. A lost COMMIT reply requires inspection of this same target;
 * repeating this method never overwrites the already committed history.
 */
export async function restoreV5WalletBackup(options: {
  mode: "simulation-only"; store: WalletStore; backup: string; acknowledgeFreshTarget: true;
  clock?: () => number; expectedChecksum?: string;
}): Promise<WalletV5RestoreResult> {
  const { mode, store, backup, acknowledgeFreshTarget, expectedChecksum, clock = Date.now } = options;
  assertSimulationRuntime(mode);
  // Capture the entire caller-owned decision, including the evaluated clock,
  // before an asynchronous owner can mutate its options. Report any refusal
  // inside the certified transaction so a caller cannot catch it and commit
  // companion writes. No restore SQL runs until the captured decision is valid.
  const captured = (() => {
    try {
      verify(acknowledgeFreshTarget === true, "Explicit acknowledgment of a fresh development target is required");
      const checked = validated(parsedDocument(backup), expectedChecksum), envelope = checked.envelope;
      verify(envelope.commands.length < MAX_WALLET_BACKUP_COMMANDS, "Restore requires capacity for its quarantine command");
      const at = checkedTime(clock);
      verify(at >= envelope.checkpoint.lastCommandAtMs, "Restore clock precedes backed-up history");
      const quarantine = v5Command("pause", { kind: "operator", id: "backup-recovery" }, `restore-${envelope.checksum}`, null);
      const quarantineCommandKey = v5CommandKey(quarantine);
      verify(!envelope.commands.some(row => row.command_key === quarantineCommandKey), "Quarantine identity already exists in the backup");
      return { prepared: { checked, envelope, at, quarantine, quarantineCommandKey } };
    } catch (error) { return { error }; }
  })();
  return owned(store, async tx => {
    if (!captured.prepared) throw captured.error;
    const { checked, envelope, at, quarantine, quarantineCommandKey } = captured.prepared;
    // This gate coordinates competing fresh-target restores. The transaction
    // owner retries an old SERIALIZABLE snapshot after genuine conflicts.
    await tx.query("SELECT pg_advisory_xact_lock(61422924)");
    await isolated(tx);
    const scoped = bound(tx);
    await initializeDurableWallet(scoped);
    let replayClock = 0;
    const v1 = createDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
    verify((await v1.snapshot()).revision === 0, "Restore target must have no committed commands; existing history is never overwritten");
    const v2 = createVersionedDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
    const v3 = createV3DurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
    const v4 = createV4DurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
    const v5 = createV5DurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
    for (const row of envelope.commands) {
      replayClock = Number(row.occurred_at_ms);
      const command = parseV5VersionedCommand(row.command_json);
      const applied = command.version === 1 ? await v1.execute(parseWalletCommand(command))
        : command.version === 2 ? command.type === "continueFromV1"
          ? await upgradeDurableWalletV2({ mode: "simulation-only", store: scoped, command,
            acknowledgeVersionUpgrade: true, clock: () => replayClock }) : await v2.execute(command)
          : command.version === 3 ? command.type === "continueFromV2"
            ? await upgradeDurableWalletV3({ mode: "simulation-only", store: scoped, command,
              acknowledgeVersionUpgrade: true, clock: () => replayClock }) : await v3.execute(command)
            : command.version === 4 ? command.type === "continueFromV3"
              ? await upgradeDurableWalletV4({ mode: "simulation-only", store: scoped, command,
                acknowledgeVersionUpgrade: true, clock: () => replayClock }) : await v4.execute(command)
              : command.type === "continueFromV4"
              ? await upgradeDurableWalletV5({ mode: "simulation-only", store: scoped, command,
                acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: true, clock: () => replayClock }) : await v5.execute(command);
      verify(!applied.replayed && applied.revision === row.revision && applied.eventHash === row.event_hash,
        "Restored command differs from the original verified history");
    }
    const original = await v5.snapshot();
    verify(isV5State(original.state) && original.revision === envelope.checkpoint.revision
      && original.eventHash === envelope.checkpoint.eventHash && walletDigest(original.state) === envelope.checkpoint.stateHash,
    "Restored state differs before quarantine");
    replayClock = at;
    const paused = await v5.execute(quarantine), restored = await v5.snapshot();
    verify(!paused.replayed && restored.revision === envelope.checkpoint.revision + 1 && Boolean(restored.state.haltReason),
      "Restore did not durably append its quarantine command");
    await isolated(tx);
    return { backup: summary(checked), restored: { revision: restored.revision, eventHash: restored.eventHash,
      stateHash: walletDigest(restored.state), lastCommandAtMs: at }, quarantined: true, quarantineCommandKey };
  });
}
