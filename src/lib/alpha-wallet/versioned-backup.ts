import { z } from "zod";
import {
  exportWalletBackup,
  inspectWalletBackup,
  MAX_WALLET_BACKUP_BYTES,
  MAX_WALLET_BACKUP_COMMANDS,
  restoreWalletBackup,
  WALLET_BACKUP_FORMAT,
  WalletBackupError,
  type WalletBackupCheckpoint,
  type WalletBackupInspection,
  type WalletRestoreResult,
} from "./backup";
import { parseWalletCommand, walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet } from "./durable";
import type { WalletSql, WalletStore } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";
import { parseVersionedCommand, v2Command, versionedCommandKey, WALLET_V2_ENGINE_VERSION } from "./v2-commands";
import { createVersionedDurableWallet, upgradeDurableWalletV2, verifyVersionedHistory } from "./versioned-durable";

// Keep the original v1 module and its format unchanged. The new manifest adds
// one explicit continuation boundary; it is not permission to upgrade a v1 file.
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const storedTimestamp = z.string().regex(/^(?:0|[1-9]\d{0,15})$/)
  .refine(value => Number.isSafeInteger(Number(value)) && Number(value) >= 0, "Invalid command timestamp");
const recordSchema = z.strictObject({
  revision: z.number().int().positive().max(MAX_WALLET_BACKUP_COMMANDS),
  command_key: z.string().min(1).max(512),
  command_type: z.string().min(1).max(80),
  occurred_at_ms: storedTimestamp,
  command_json: z.unknown().refine(value => value !== undefined, "Missing command JSON"),
  input_hash: hex,
  result_json: z.unknown().refine(value => value !== undefined, "Missing result JSON"),
  result_hash: hex,
  state_hash: hex,
  previous_event_hash: hex,
  event_hash: hex,
});
const checkpointSchema = z.strictObject({
  revision: z.number().int().min(0).max(MAX_WALLET_BACKUP_COMMANDS),
  eventHash: hex,
  stateHash: hex,
  lastCommandAtMs: timestamp,
});
const continuationSchema = z.strictObject({
  checkpoint: checkpointSchema,
  commandRevision: z.number().int().positive().max(MAX_WALLET_BACKUP_COMMANDS),
  commandKey: z.string().min(1).max(512),
});
const envelopeSchema = z.strictObject({
  format: z.literal(WALLET_BACKUP_FORMAT),
  formatVersion: z.literal(2),
  mode: z.literal("simulation-only"),
  engineVersion: z.literal(WALLET_V2_ENGINE_VERSION),
  exportedAtMs: timestamp,
  checkpoint: checkpointSchema,
  continuation: continuationSchema,
  commands: z.array(recordSchema).min(1).max(MAX_WALLET_BACKUP_COMMANDS),
  checksum: hex,
});
type V2Envelope = z.infer<typeof envelopeSchema>;
export type WalletV2BackupInspection = Omit<V2Envelope, "commands"> & { commandCount: number };
export type VersionedWalletBackupInspection = WalletBackupInspection | WalletV2BackupInspection;
export type VersionedWalletRestoreResult = Omit<WalletRestoreResult, "backup"> & {
  backup: VersionedWalletBackupInspection;
};

function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletBackupError(message);
}
function checkedTime(clock: () => number) {
  const value = clock();
  verify(Number.isSafeInteger(value) && value >= 0, "Invalid backup/restore clock");
  return value;
}
function parsedDocument(serialized: string): unknown {
  assertSimulationRuntime("simulation-only");
  verify(typeof serialized === "string" && serialized.length > 0
    && serialized.length <= MAX_WALLET_BACKUP_BYTES && Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES,
  "Backup must be a nonempty JSON document within the development size limit");
  try { return JSON.parse(serialized); }
  catch { throw new WalletBackupError("Unsupported, malformed, truncated, or oversized wallet backup"); }
}
function isV1Document(document: unknown): boolean {
  return document !== null && typeof document === "object" && !Array.isArray(document)
    && "formatVersion" in document && document.formatVersion === 1;
}
function summary(envelope: V2Envelope): WalletV2BackupInspection {
  const { commands, ...metadata } = envelope;
  return { ...metadata, commandCount: commands.length };
}
function validatedV2(document: unknown, expectedChecksum?: string): V2Envelope {
  let envelope: V2Envelope;
  try { envelope = envelopeSchema.parse(document); }
  catch { throw new WalletBackupError("Unsupported, malformed, truncated, or oversized wallet backup"); }
  const { checksum, ...body } = envelope;
  verify(walletDigest(body) === checksum, "Wallet backup checksum mismatch");
  if (expectedChecksum !== undefined) {
    verify(hex.safeParse(expectedChecksum).success && expectedChecksum === checksum, "Wallet backup differs from the expected checksum");
  }
  const recovered = verifyVersionedHistory(envelope.commands);
  verify(recovered.engineVersion === WALLET_V2_ENGINE_VERSION
    && "engineVersion" in recovered.state && recovered.state.engineVersion === WALLET_V2_ENGINE_VERSION,
  "Mixed-history backup must terminate in the v2 engine");
  verify(envelope.commands.length === envelope.checkpoint.revision && recovered.revision === envelope.checkpoint.revision
    && recovered.eventHash === envelope.checkpoint.eventHash && recovered.occurredAtMs === envelope.checkpoint.lastCommandAtMs
    && walletDigest(recovered.state) === envelope.checkpoint.stateHash, "Wallet backup checkpoint disagrees with verified history");
  verify(walletDigest(recovered.state.continuation) === walletDigest(envelope.continuation)
    && envelope.continuation.commandRevision === envelope.continuation.checkpoint.revision + 1
    && envelope.continuation.commandRevision <= envelope.checkpoint.revision,
  "Wallet backup continuation disagrees with verified history");
  verify(envelope.exportedAtMs >= recovered.occurredAtMs, "Backup timestamp precedes its command history");
  return envelope;
}

/** Checks semantic replay as well as checksums; neither establishes authenticity. */
export function inspectVersionedWalletBackup(serialized: string, options: { expectedChecksum?: string } = {}): VersionedWalletBackupInspection {
  const document = parsedDocument(serialized);
  return isV1Document(document)
    ? inspectWalletBackup(serialized, options)
    : summary(validatedV2(document, options.expectedChecksum));
}

/** The caller's WalletStore remains the sole owner of BEGIN, retry and COMMIT. */
function transactionBoundStore(tx: WalletSql): WalletStore {
  return { transaction: work => work(tx), close: async () => { throw new WalletBackupError("The outer transaction owns this store"); } };
}

/** A pure-v1 source is exported by the unchanged v1 exporter, without upgrading it. */
export async function exportVersionedWalletBackup(options: {
  mode: "simulation-only"; store: WalletStore; clock?: () => number;
}): Promise<string> {
  assertSimulationRuntime(options.mode);
  return options.store.transaction(async tx => {
    const scoped = transactionBoundStore(tx);
    const head = await tx.query<{ format_version: number; mode: string }>(
      "SELECT format_version,mode FROM alpha_wallet_simulation.head WHERE singleton=true");
    verify(head.rows.length === 1 && head.rows[0].mode === "simulation-only", "Unsupported durable wallet store");
    if (head.rows[0].format_version === 1) return exportWalletBackup({ ...options, store: scoped });
    verify(head.rows[0].format_version === 2, "Unsupported durable wallet store");
    const snapshot = await createVersionedDurableWallet({ mode: "simulation-only", store: scoped }).snapshot();
    verify(snapshot.engineVersion === WALLET_V2_ENGINE_VERSION
      && "engineVersion" in snapshot.state && snapshot.state.engineVersion === WALLET_V2_ENGINE_VERSION,
    "Mixed-history backup must terminate in the v2 engine");
    verify(snapshot.revision <= MAX_WALLET_BACKUP_COMMANDS, "Development backup command limit exceeded; reviewed checkpointing is required");
    const rows = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const commands = z.array(recordSchema).min(1).max(MAX_WALLET_BACKUP_COMMANDS).parse(rows);
    verify(commands.length === snapshot.revision, "Wallet backup command count differs from verified state");
    const lastCommandAtMs = Number(commands[commands.length - 1]!.occurred_at_ms);
    const exportedAtMs = checkedTime(options.clock ?? Date.now);
    verify(exportedAtMs >= lastCommandAtMs, "Backup timestamp precedes its command history");
    const body = {
      format: WALLET_BACKUP_FORMAT, formatVersion: 2 as const, mode: "simulation-only" as const,
      engineVersion: WALLET_V2_ENGINE_VERSION, exportedAtMs,
      checkpoint: { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs },
      continuation: continuationSchema.parse(snapshot.state.continuation), commands,
    };
    const serialized = JSON.stringify({ ...body, checksum: walletDigest(body) }, null, 2);
    verify(Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES, "Development backup byte limit exceeded");
    return serialized;
  });
}

async function assertIsolatedFreshTarget(tx: WalletSql) {
  const otherSchemas = await tx.query(`SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog','information_schema','public','alpha_wallet_simulation') AND nspname NOT LIKE 'pg_%'`);
  const publicRelations = await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`);
  verify(otherSchemas.rows.length === 0 && publicRelations.rows[0]?.count === "0", "Restore requires a fresh isolated development database");
}

/**
 * Validate before accessing the target, then replay both engines, their explicit
 * migration and one final v2 pause in ONE transaction. The store must propagate
 * failure to its transaction owner. A returned checkpoint is already quarantined;
 * a lost COMMIT reply requires inspecting this same target, never overwriting it.
 */
export async function restoreVersionedWalletBackup(options: {
  mode: "simulation-only";
  store: WalletStore;
  backup: string;
  acknowledgeFreshTarget: true;
  clock?: () => number;
  expectedChecksum?: string;
}): Promise<VersionedWalletRestoreResult> {
  assertSimulationRuntime(options.mode);
  verify(options.acknowledgeFreshTarget === true, "Explicit acknowledgment of a fresh development target is required");
  const document = parsedDocument(options.backup);
  if (isV1Document(document)) return restoreWalletBackup(options);
  const envelope = validatedV2(document, options.expectedChecksum);
  const at = checkedTime(options.clock ?? Date.now);
  verify(at >= envelope.checkpoint.lastCommandAtMs, "Restore clock precedes backed-up history");
  const quarantine = v2Command("pause", { kind: "operator", id: "backup-recovery" }, `restore-${envelope.checksum}`, null);
  const quarantineCommandKey = versionedCommandKey(quarantine);
  verify(!envelope.commands.some(row => row.command_key === quarantineCommandKey), "Quarantine identity already exists in the backup");
  assertSimulationRuntime(options.mode);
  return options.store.transaction(async tx => {
    assertSimulationRuntime(options.mode);
    await assertIsolatedFreshTarget(tx);
    const scoped = transactionBoundStore(tx);
    await initializeDurableWallet(scoped);
    let replayClock = 0;
    const v1 = createDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
    const empty = await v1.snapshot();
    verify(empty.revision === 0, "Restore target must have no committed wallet commands; existing history is never overwritten");
    const wallet = createVersionedDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
    for (const row of envelope.commands) {
      replayClock = Number(row.occurred_at_ms);
      const command = parseVersionedCommand(row.command_json);
      const applied = command.version === 1
        ? await v1.execute(parseWalletCommand(command))
        : command.type === "continueFromV1"
          ? await upgradeDurableWalletV2({ mode: "simulation-only", store: scoped, command,
            acknowledgeVersionUpgrade: true, clock: () => replayClock })
          : await wallet.execute(command);
      verify(!applied.replayed && applied.revision === row.revision && applied.eventHash === row.event_hash,
        "Restored command differs from the original verified history");
    }
    const original = await wallet.snapshot();
    verify(original.engineVersion === WALLET_V2_ENGINE_VERSION && original.revision === envelope.checkpoint.revision
      && original.eventHash === envelope.checkpoint.eventHash && walletDigest(original.state) === envelope.checkpoint.stateHash,
    "Restored state differs before quarantine");
    replayClock = at;
    const paused = await wallet.execute(quarantine);
    const restored = await wallet.snapshot();
    verify(!paused.replayed && restored.revision === envelope.checkpoint.revision + 1 && Boolean(restored.state.haltReason),
      "Restore did not durably append its quarantine command");
    const restoredCheckpoint: WalletBackupCheckpoint = {
      revision: restored.revision, eventHash: restored.eventHash, stateHash: walletDigest(restored.state), lastCommandAtMs: at,
    };
    return { backup: summary(envelope), restored: restoredCheckpoint, quarantined: true, quarantineCommandKey };
  });
}
