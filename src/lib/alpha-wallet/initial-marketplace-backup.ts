import "server-only";

import { z } from "zod";
import { withDevelopmentInitialAcceptanceInTransaction } from "@/lib/alpha-exchange-repository";
import { WalletAccessError } from "./access";
import { MAX_WALLET_BACKUP_BYTES, MAX_WALLET_BACKUP_COMMANDS, WALLET_BACKUP_FORMAT,
  WalletBackupError, type WalletBackupCheckpoint } from "./backup";
import { parseWalletCommand, walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet, WalletIntegrityError } from "./durable";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import {
  inspectInitialMarketplaceWalletBackup, parseInitialMarketplaceWalletBackup,
  type InitialMarketplaceWalletBackupEnvelope, type InitialMarketplaceWalletBackupInspection,
} from "./initial-marketplace-backup-manifest";
import {
  assertInitialMarketplaceCoherence, registerInitialMarketplaceContext, type InitialMarketplaceContext,
} from "./initial-marketplace-coordination-store";
import {
  assertFreshInitialMarketplaceRecoveryTarget, assertInitialMarketplaceRecoveryIdentityQuarantine,
  installInitialMarketplaceRecoveryRows, readInitialMarketplaceRecoveryReceipt, readInitialMarketplaceRecoveryRows,
  writeInitialMarketplaceRecoveryReceipt, type InitialMarketplaceRecoveryReceipt,
} from "./initial-marketplace-recovery-store";
import { resolveDevelopmentMarketplaceWebPrincipal, type DevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";
import { developmentMarketplaceMobileCredentialsSchema, resolveDevelopmentMarketplaceMobilePrincipal,
  type DevelopmentMarketplaceMobileCredentials } from "./marketplace-mobile-auth";
import { assertSimulationRuntime } from "./runtime";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "./versioned-durable";
import { parseV3VersionedCommand, v3Command, v3CommandKey, WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { createV3DurableWallet, upgradeDurableWalletV3, verifyV3History, type V3WalletSnapshot } from "./v3-durable";
import { isV3State } from "./v3-engine";

export { inspectInitialMarketplaceWalletBackup } from "./initial-marketplace-backup-manifest";
export type { InitialMarketplaceWalletBackupEnvelope, InitialMarketplaceWalletBackupInspection } from "./initial-marketplace-backup-manifest";

const identity = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const exportInput = z.strictObject({ sessionToken: z.string().min(1).max(512), requestId: identity });
const mobileExportInput = z.strictObject({ ...developmentMarketplaceMobileCredentialsSchema.shape, requestId: identity });
type ExportOptions = { mode: "simulation-only"; store: WalletStore; requestId: string; clock?: () => number };
const COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;

export class InitialMarketplaceWalletRecoveryError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "OWNER_REQUIRED" | "SOURCE_NOT_PAUSED" | "INTEGRITY"
    | "STORAGE_UNAVAILABLE" | "40001" | "40P01", message: string) {
    super(message); this.name = "InitialMarketplaceWalletRecoveryError";
  }
}
function check(value: unknown, code: InitialMarketplaceWalletRecoveryError["code"], message: string): asserts value {
  if (!value) throw new InitialMarketplaceWalletRecoveryError(code, message);
}
function safeFailure(error: unknown): Error {
  if (error instanceof CommitOutcomeUnknownError) {
    return new CommitOutcomeUnknownError(new Error("Development initial recovery transaction acknowledgement unavailable"));
  }
  if (error instanceof InitialMarketplaceWalletRecoveryError || error instanceof WalletBackupError
    || error instanceof WalletAccessError || error instanceof WalletIntegrityError) return error;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "40001" || code === "40P01") {
    return new InitialMarketplaceWalletRecoveryError(code, "Development initial recovery transaction retries were exhausted");
  }
  return new InitialMarketplaceWalletRecoveryError("STORAGE_UNAVAILABLE", "Development initial marketplace recovery could not complete the operation");
}
function checkedTime(clock: () => number): number {
  const at = clock();
  check(Number.isSafeInteger(at) && at >= 0 && Number.isFinite(new Date(at).getTime()), "INVALID_INPUT", "Invalid development initial recovery clock");
  return at;
}
function expectedChecksum(value: unknown): string {
  const parsed = checksumSchema.safeParse(value);
  check(parsed.success, "INVALID_INPUT", "A separately retained expected backup checksum is required");
  return parsed.data;
}
const scopedStore = (tx: WalletSql): WalletStore => ({
  transaction: work => work(tx), close: async () => { throw new WalletBackupError("The outer recovery transaction owns this store"); },
});
function checkpoint(snapshot: V3WalletSnapshot): WalletBackupCheckpoint {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state),
    lastCommandAtMs: snapshot.lastCommandAtMs };
}
type TransactionIdentity = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null; timezone: string };
async function transactionIdentity(tx: WalletSql, expected?: string) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<TransactionIdentity>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema', true) AS development_mode, current_setting('TimeZone') AS timezone`);
  assertSimulationRuntime("simulation-only");
  const row = result.rows[0];
  check(result.rows.length === 1 && row && /^[1-9][0-9]*$/.test(row.transaction_id)
    && (expected === undefined || expected === row.transaction_id), "INTEGRITY", "Development initial recovery transaction identity changed or ended");
  check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only",
    "INTEGRITY", "Development initial recovery requires one writable SERIALIZABLE simulation transaction");
  check(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"].includes(row.timezone),
    "INTEGRITY", "Initial recovery requires UTC to preserve original canonical timestamp representations");
  return row.transaction_id;
}
async function owned<T>(store: WalletStore, work: (tx: WalletSql) => Promise<T>): Promise<T> {
  return store.transaction(async tx => {
    let certified: string | undefined;
    try {
      const current = await transactionIdentity(tx);
      await transactionIdentity(tx, current);
      certified = current;
      const result = await work(tx);
      await transactionIdentity(tx, current);
      return result;
    } catch (error) {
      if (certified !== undefined) {
        try {
          // Runtime refusal is a failure to roll back, too. Cleanup checks only
          // raw physical identity so a caught refusal cannot leave writes alive.
          const rows = (await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
          if (rows.length === 1 && rows[0]?.transaction_id === certified) {
            await tx.query("SELECT 1 / 0 /* abort failed initial combined marketplace recovery */");
          }
        } catch { /* Preserve the original failure; never poison a changed transaction. */ }
      }
      throw error;
    }
  }).catch(error => { throw safeFailure(error); });
}

/** Current stored owner authority and a durably paused source are mandatory. */
export async function exportInitialMarketplaceWalletBackup(options: ExportOptions & { sessionToken: string }): Promise<string> {
  assertSimulationRuntime(options.mode);
  const parsed = exportInput.safeParse({ sessionToken: options.sessionToken, requestId: options.requestId });
  check(parsed.success, "INVALID_INPUT", "Invalid development initial marketplace recovery export input");
  return exportAuthenticatedInitialMarketplaceWalletBackup(options, parsed.data);
}

/** Same format, with the fixed current stored mobile/device authority reader. */
export async function exportMobileInitialMarketplaceWalletBackup(options: ExportOptions & DevelopmentMarketplaceMobileCredentials): Promise<string> {
  assertSimulationRuntime(options.mode);
  const parsed = mobileExportInput.safeParse({ accessToken: options.accessToken, metadata: options.metadata, requestId: options.requestId });
  check(parsed.success, "INVALID_INPUT", "Invalid development mobile initial marketplace recovery export input");
  return exportAuthenticatedInitialMarketplaceWalletBackup(options, parsed.data);
}

async function exportAuthenticatedInitialMarketplaceWalletBackup(options: ExportOptions,
  input: z.infer<typeof exportInput> | z.infer<typeof mobileExportInput>): Promise<string> {
  const clock = () => checkedTime(options.clock ?? Date.now);
  return owned(options.store, async tx => {
    let principal: DevelopmentMarketplaceWebPrincipal | undefined;
    let context: InitialMarketplaceContext | undefined;
    let serialized: string | undefined;
    await withDevelopmentInitialAcceptanceInTransaction({ mode: options.mode, tx, requestId: input.requestId }, async participant => {
      check(participant.marketplace.purchaseRequests.some(request => request.id === input.requestId),
        "INTEGRITY", "Initial recovery requires the exact canonical activated request identity");
      principal = "sessionToken" in input
        ? await resolveDevelopmentMarketplaceWebPrincipal({ mode: options.mode, tx, token: input.sessionToken, clock })
        : await resolveDevelopmentMarketplaceMobilePrincipal({ mode: options.mode, tx, accessToken: input.accessToken, metadata: input.metadata, clock });
      check(principal.isOwner, "OWNER_REQUIRED", "Combined initial marketplace export requires the authenticated owner");
      context = await registerInitialMarketplaceContext({ mode: options.mode, tx, requestId: input.requestId,
        operation: "inspect", actorUserId: principal.userId });
      const snapshot = await createV3DurableWallet({ mode: options.mode, store: scopedStore(tx) }).snapshot();
      check(isV3State(snapshot.state) && snapshot.state.haltReason !== null, "SOURCE_NOT_PAUSED",
        "Pause the activated source through the owner coordinator before combined initial export");
      check(snapshot.revision < MAX_WALLET_BACKUP_COMMANDS, "INVALID_INPUT", "Initial backup must retain capacity for its restore quarantine command");
      await assertInitialMarketplaceCoherence(context);
      const rows = await readInitialMarketplaceRecoveryRows(tx);
      const exportedAtMs = clock();
      check(exportedAtMs >= snapshot.lastCommandAtMs, "INVALID_INPUT", "Export clock precedes the initial wallet history");
      const commands = (await tx.query(COMMANDS)).rows;
      // This is a distinct embedded scope. The original isolated-v3 API must
      // continue refusing canonical namespaces and is never called or widened.
      const walletBody = { format: WALLET_BACKUP_FORMAT, formatVersion: 3, scope: "initial-marketplace-v3-ledger",
        mode: options.mode, engineVersion: WALLET_V3_ENGINE_VERSION, sourcePaused: true, exportedAtMs,
        checkpoint: checkpoint(snapshot), continuation: snapshot.state.continuation,
        initialContinuation: snapshot.state.initialContinuation, commands };
      const wallet = { ...walletBody, checksum: walletDigest(walletBody) };
      const body = { format: "alpha-wallet-initial-marketplace-simulation-backup", formatVersion: 1,
        mode: options.mode, schemaVersion: "canonical-initial-cohort-v1", exportedAtMs,
        requestId: input.requestId, ownerId: principal.userId, wallet, ...rows };
      const candidate = JSON.stringify({ ...body, checksum: walletDigest(body) }, null, 2);
      check(Buffer.byteLength(candidate, "utf8") <= MAX_WALLET_BACKUP_BYTES, "INVALID_INPUT", "Combined initial development backup byte limit exceeded");
      parseInitialMarketplaceWalletBackup(candidate);
      serialized = candidate;
      await principal.assertFresh();
    });
    check(principal && context && serialized, "INTEGRITY", "Combined initial export did not finish its owned transaction");
    await assertInitialMarketplaceCoherence(context);
    await principal.assertFresh();
    return serialized;
  });
}

export type InitialMarketplaceWalletRestoreResult = {
  backup: InitialMarketplaceWalletBackupInspection; restored: WalletBackupCheckpoint;
  quarantined: true; quarantineCommandKey: string;
};

async function replayAndPause(tx: WalletSql, envelope: InitialMarketplaceWalletBackupEnvelope, at: number) {
  const scoped = scopedStore(tx);
  await initializeDurableWallet(scoped);
  let replayClock = 0;
  const v1 = createDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
  const v2 = createVersionedDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
  const v3 = createV3DurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
  for (const row of envelope.wallet.commands) {
    replayClock = Number(row.occurred_at_ms);
    const command = parseV3VersionedCommand(row.command_json);
    const execution = command.version === 1 ? await v1.execute(parseWalletCommand(command))
      : command.version === 2 ? command.type === "continueFromV1"
        ? await upgradeDurableWalletV2({ mode: "simulation-only", store: scoped, command,
          acknowledgeVersionUpgrade: true, clock: () => replayClock }) : await v2.execute(command)
        : command.type === "continueFromV2"
          ? await upgradeDurableWalletV3({ mode: "simulation-only", store: scoped, command,
            acknowledgeVersionUpgrade: true, clock: () => replayClock }) : await v3.execute(command);
    check(!execution.replayed && execution.revision === row.revision && execution.eventHash === row.event_hash,
      "INTEGRITY", "Restored initial wallet command differs from original verified history");
  }
  const original = await v3.snapshot();
  check(walletDigest(checkpoint(original)) === walletDigest(envelope.wallet.checkpoint),
    "INTEGRITY", "Restored initial wallet differs from its source checkpoint before quarantine");
  const quarantine = v3Command("pause", { kind: "operator", id: "initial-marketplace-backup-recovery" }, `restore-${envelope.checksum}`, null);
  const quarantineCommandKey = v3CommandKey(quarantine);
  check(!envelope.wallet.commands.some(row => row.command_key === quarantineCommandKey), "INTEGRITY", "Initial recovery quarantine identity already exists");
  replayClock = at;
  const pause = await v3.execute(quarantine);
  const restored = await v3.snapshot();
  check(!pause.replayed && restored.revision === envelope.wallet.checkpoint.revision + 1
    && isV3State(restored.state) && restored.state.haltReason !== null,
  "INTEGRITY", "Initial recovery must append a new durable pause before installing canonical records");
  return { restored: checkpoint(restored), quarantineCommandKey };
}

/**
 * Fresh, isolated DEVELOPMENT target only. Byte and semantic validation precede
 * its transaction. Original records, guards, quarantine and receipt are atomic.
 * No provider, credential re-entry, resume or external delivery is installed.
 */
export async function restoreInitialMarketplaceWalletBackup(options: {
  mode: "simulation-only"; store: WalletStore; backup: string; acknowledgeFreshTarget: true;
  expectedChecksum: string; clock?: () => number;
}): Promise<InitialMarketplaceWalletRestoreResult> {
  assertSimulationRuntime(options.mode);
  check(options.acknowledgeFreshTarget === true, "INVALID_INPUT", "Explicit acknowledgment of a fresh isolated development target is required");
  const expected = expectedChecksum(options.expectedChecksum);
  const envelope = parseInitialMarketplaceWalletBackup(options.backup, expected);
  const backup = inspectInitialMarketplaceWalletBackup(options.backup, { expectedChecksum: expected });
  const at = checkedTime(options.clock ?? Date.now);
  check(at >= envelope.exportedAtMs && at >= envelope.wallet.checkpoint.lastCommandAtMs,
    "INVALID_INPUT", "Restore clock precedes the exported initial source checkpoint");
  return owned(options.store, async tx => {
    await assertFreshInitialMarketplaceRecoveryTarget(tx);
    const { restored, quarantineCommandKey } = await replayAndPause(tx, envelope, at);
    await installInitialMarketplaceRecoveryRows(tx, { canonical: envelope.canonical, coordination: envelope.coordination });
    const context = await registerInitialMarketplaceContext({ mode: options.mode, tx, requestId: envelope.requestId,
      operation: "inspect", actorUserId: envelope.ownerId });
    await assertInitialMarketplaceCoherence(context);
    await assertInitialMarketplaceRecoveryIdentityQuarantine(tx);
    const rows = await readInitialMarketplaceRecoveryRows(tx);
    const canonicalDigest = walletDigest(envelope.canonical), coordinationDigest = walletDigest(envelope.coordination);
    check(walletDigest(rows.canonical) === canonicalDigest && walletDigest(rows.coordination) === coordinationDigest,
      "INTEGRITY", "Restored initial marketplace records differ from the verified source bundle");
    const verified = await createV3DurableWallet({ mode: options.mode, store: scopedStore(tx) }).snapshot();
    check(walletDigest(checkpoint(verified)) === walletDigest(restored), "INTEGRITY", "Recovery changed the quarantined initial wallet checkpoint");
    const receipt: InitialMarketplaceRecoveryReceipt = { checksum: envelope.checksum, source: envelope.wallet.checkpoint,
      restored, requestId: envelope.requestId, ownerId: envelope.ownerId, restoredAtMs: at,
      canonicalDigest, coordinationDigest, quarantineCommandKey };
    await writeInitialMarketplaceRecoveryReceipt(tx, receipt);
    await assertInitialMarketplaceCoherence(context);
    return { backup, restored, quarantined: true as const, quarantineCommandKey };
  });
}

export type InitialMarketplaceWalletRecoveryInspection = InitialMarketplaceRecoveryReceipt & { quarantined: true };

/** Offline same-target outcome verification grants no login, signing or resume authority. */
export async function inspectRestoredInitialMarketplaceWallet(options: {
  mode: "simulation-only"; store: WalletStore; expectedChecksum: string;
}): Promise<InitialMarketplaceWalletRecoveryInspection> {
  assertSimulationRuntime(options.mode);
  const expected = expectedChecksum(options.expectedChecksum);
  return owned(options.store, async tx => {
    const receipt = await readInitialMarketplaceRecoveryReceipt(tx);
    check(receipt && receipt.checksum === expected, "INTEGRITY", "This target has no matching completed initial recovery receipt");
    const context = await registerInitialMarketplaceContext({ mode: options.mode, tx, requestId: receipt.requestId,
      operation: "inspect", actorUserId: receipt.ownerId });
    const snapshot = await createV3DurableWallet({ mode: options.mode, store: scopedStore(tx) }).snapshot();
    check(isV3State(snapshot.state) && snapshot.state.haltReason !== null
      && walletDigest(checkpoint(snapshot)) === walletDigest(receipt.restored),
    "INTEGRITY", "Recovered initial wallet is unpaused or differs from its immutable recovery checkpoint");
    const commands = (await tx.query(COMMANDS)).rows;
    check(commands.length === receipt.source.revision + 1 && receipt.restored.revision === commands.length,
      "INTEGRITY", "Recovered initial wallet must contain exactly the original history and its new pause");
    const original = verifyV3History(commands.slice(0, -1));
    check(walletDigest(checkpoint(original)) === walletDigest(receipt.source), "INTEGRITY", "Recovered initial history differs from its source checkpoint");
    const quarantine = v3Command("pause", { kind: "operator", id: "initial-marketplace-backup-recovery" }, `restore-${expected}`, null);
    const last = commands[commands.length - 1];
    check(last && walletDigest(last.command_json) === walletDigest(quarantine)
      && last.command_key === v3CommandKey(quarantine) && last.command_key === receipt.quarantineCommandKey
      && Number(last.occurred_at_ms) === receipt.restoredAtMs && receipt.restored.lastCommandAtMs === receipt.restoredAtMs,
    "INTEGRITY", "Recovered initial quarantine identity differs from the recovery receipt");
    await assertInitialMarketplaceRecoveryIdentityQuarantine(tx);
    const rows = await readInitialMarketplaceRecoveryRows(tx);
    check(walletDigest(rows.canonical) === receipt.canonicalDigest && walletDigest(rows.coordination) === receipt.coordinationDigest,
      "INTEGRITY", "Recovered initial canonical records differ from the recovery receipt");
    await assertInitialMarketplaceCoherence(context);
    return { ...receipt, quarantined: true as const };
  });
}
