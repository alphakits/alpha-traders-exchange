import { z } from "zod";
import { parseWalletCommand, walletCommandKey, walletDigest, WALLET_ENGINE_VERSION } from "./commands";
import { createDurableWallet, initializeDurableWallet, verifyDurableHistory, walletCommand } from "./durable";
import type { WalletSql, WalletStore } from "./durable-store";
import { assertSimulationRuntime } from "./runtime";

/** Logical development backup only: no SQL, credentials, signer, or provider state. */
export const WALLET_BACKUP_FORMAT = "alpha-wallet-simulation-command-backup" as const;
export const MAX_WALLET_BACKUP_BYTES = 16 * 1024 * 1024;
export const MAX_WALLET_BACKUP_COMMANDS = 1_000;
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
const envelopeSchema = z.strictObject({
  format: z.literal(WALLET_BACKUP_FORMAT),
  formatVersion: z.literal(1),
  mode: z.literal("simulation-only"),
  engineVersion: z.literal(WALLET_ENGINE_VERSION),
  exportedAtMs: timestamp,
  checkpoint: checkpointSchema,
  commands: z.array(recordSchema).max(MAX_WALLET_BACKUP_COMMANDS),
  checksum: hex,
});
type Envelope = z.infer<typeof envelopeSchema>;
export type WalletBackupCheckpoint = z.infer<typeof checkpointSchema>;
export type WalletBackupInspection = {
  format: typeof WALLET_BACKUP_FORMAT;
  formatVersion: 1;
  mode: "simulation-only";
  engineVersion: typeof WALLET_ENGINE_VERSION;
  exportedAtMs: number;
  checksum: string;
  commandCount: number;
  checkpoint: WalletBackupCheckpoint;
};
export type WalletRestoreResult = {
  backup: WalletBackupInspection;
  restored: WalletBackupCheckpoint;
  quarantined: true;
  quarantineCommandKey: string;
};

export class WalletBackupError extends Error {
  readonly code = "ALPHA_WALLET_BACKUP_FAILURE";
  constructor(message: string) { super(message); this.name = "WalletBackupError"; }
}
function verify(value: unknown, message: string): asserts value {
  if (!value) throw new WalletBackupError(message);
}
function checkedTime(clock: () => number) {
  const value = clock();
  verify(Number.isSafeInteger(value) && value >= 0, "Invalid backup/restore clock");
  return value;
}
function summary(envelope: Envelope): WalletBackupInspection {
  const { commands, ...metadata } = envelope;
  return { ...metadata, commandCount: commands.length };
}
function validated(serialized: string, expectedChecksum?: string) {
  assertSimulationRuntime("simulation-only");
  verify(typeof serialized === "string" && serialized.length > 0
    && serialized.length <= MAX_WALLET_BACKUP_BYTES && Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES,
  "Backup must be a nonempty JSON document within the development size limit");
  let envelope: Envelope;
  try { envelope = envelopeSchema.parse(JSON.parse(serialized)); }
  catch { throw new WalletBackupError("Unsupported, malformed, truncated, or oversized wallet backup"); }
  const { checksum, ...body } = envelope;
  verify(walletDigest(body) === checksum, "Wallet backup checksum mismatch");
  if (expectedChecksum !== undefined) {
    verify(hex.safeParse(expectedChecksum).success && expectedChecksum === checksum, "Wallet backup differs from the expected checksum");
  }
  const recovered = verifyDurableHistory(envelope.commands);
  verify(envelope.commands.length === envelope.checkpoint.revision && recovered.revision === envelope.checkpoint.revision
    && recovered.eventHash === envelope.checkpoint.eventHash && recovered.occurredAtMs === envelope.checkpoint.lastCommandAtMs
    && walletDigest(recovered.state) === envelope.checkpoint.stateHash, "Wallet backup checkpoint disagrees with verified history");
  verify(envelope.exportedAtMs >= recovered.occurredAtMs, "Backup timestamp precedes its command history");
  return envelope;
}

/** Validates checksums AND semantic replay; consistency is not authentication. */
export function inspectWalletBackup(serialized: string, options: { expectedChecksum?: string } = {}): WalletBackupInspection {
  return summary(validated(serialized, options.expectedChecksum));
}

// These repository calls share the caller's existing SERIALIZABLE transaction.
// No nested BEGIN/COMMIT, external SQL, or provider operation is accepted here.
function transactionBoundStore(tx: WalletSql): WalletStore {
  return {
    transaction: work => work(tx),
    close: async () => { throw new WalletBackupError("The outer transaction owns this store"); },
  };
}

/** Takes one verified transaction snapshot, including every immutable projection. */
export async function exportWalletBackup(options: {
  mode: "simulation-only"; store: WalletStore; clock?: () => number;
}): Promise<string> {
  assertSimulationRuntime(options.mode);
  return options.store.transaction(async tx => {
    const scoped = transactionBoundStore(tx);
    const snapshot = await createDurableWallet({ mode: "simulation-only", store: scoped }).snapshot();
    verify(snapshot.revision <= MAX_WALLET_BACKUP_COMMANDS, "Development backup command limit exceeded; reviewed checkpointing is required");
    const rows = (await tx.query(`SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
      command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
      FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows;
    const commands = z.array(recordSchema).max(MAX_WALLET_BACKUP_COMMANDS).parse(rows);
    const lastCommandAtMs = commands.length ? Number(commands[commands.length - 1]!.occurred_at_ms) : 0;
    const exportedAtMs = checkedTime(options.clock ?? Date.now);
    verify(exportedAtMs >= lastCommandAtMs, "Backup timestamp precedes its command history");
    const body = {
      format: WALLET_BACKUP_FORMAT, formatVersion: 1 as const, mode: "simulation-only" as const,
      engineVersion: WALLET_ENGINE_VERSION, exportedAtMs,
      checkpoint: { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs },
      commands,
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
 * Replays original commands into a fresh development store, then appends pause
 * BEFORE the same transaction commits. An old backup cannot establish that a
 * later provider submission never happened. No restored wallet is auto-enabled.
 */
export async function restoreWalletBackup(options: {
  mode: "simulation-only";
  store: WalletStore;
  backup: string;
  acknowledgeFreshTarget: true;
  clock?: () => number;
  expectedChecksum?: string;
}): Promise<WalletRestoreResult> {
  assertSimulationRuntime(options.mode);
  verify(options.acknowledgeFreshTarget === true, "Explicit acknowledgment of a fresh development target is required");
  // Validate everything before invoking target.transaction or creating a schema.
  const envelope = validated(options.backup, options.expectedChecksum);
  const at = checkedTime(options.clock ?? Date.now);
  verify(at >= envelope.checkpoint.lastCommandAtMs, "Restore clock precedes backed-up history");
  const quarantine = walletCommand("pause", { kind: "operator", id: "backup-recovery" }, `restore-${envelope.checksum}`, null);
  const quarantineCommandKey = walletCommandKey(quarantine);
  verify(!envelope.commands.some(row => row.command_key === quarantineCommandKey), "Quarantine identity already exists in the backup");
  return options.store.transaction(async tx => {
    assertSimulationRuntime(options.mode);
    await assertIsolatedFreshTarget(tx);
    const scoped = transactionBoundStore(tx);
    await initializeDurableWallet(scoped);
    let replayClock = 0;
    const wallet = createDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
    const empty = await wallet.snapshot();
    verify(empty.revision === 0, "Restore target must have no committed wallet commands; existing history is never overwritten");
    for (const row of envelope.commands) {
      replayClock = Number(row.occurred_at_ms);
      const applied = await wallet.execute(parseWalletCommand(row.command_json));
      verify(!applied.replayed && applied.revision === row.revision && applied.eventHash === row.event_hash,
        "Restored command differs from the original verified history");
    }
    const original = await wallet.snapshot();
    verify(original.revision === envelope.checkpoint.revision && original.eventHash === envelope.checkpoint.eventHash
      && walletDigest(original.state) === envelope.checkpoint.stateHash, "Restored state differs before quarantine");
    replayClock = at;
    const paused = await wallet.execute(quarantine);
    const restored = await wallet.snapshot();
    verify(!paused.replayed && restored.revision === envelope.checkpoint.revision + 1 && Boolean(restored.state.haltReason),
      "Restore did not durably append its quarantine command");
    return {
      backup: summary(envelope),
      restored: { revision: restored.revision, eventHash: restored.eventHash, stateHash: walletDigest(restored.state), lastCommandAtMs: at },
      quarantined: true,
      quarantineCommandKey,
    };
  });
}
