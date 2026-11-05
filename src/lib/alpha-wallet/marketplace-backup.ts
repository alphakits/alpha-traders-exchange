import "server-only";

import { z } from "zod";
import { mutateDevelopmentFocusedTradeInTransaction } from "@/lib/alpha-exchange-repository";
import { WalletAccessError } from "./access";
import { MAX_WALLET_BACKUP_BYTES, WalletBackupError, type WalletBackupCheckpoint } from "./backup";
import { parseWalletCommand, walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet, WalletIntegrityError } from "./durable";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import { resolveDevelopmentMarketplaceWebPrincipal, type DevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";
import {
  inspectMarketplaceWalletBackup, parseMarketplaceWalletBackup,
  type MarketplaceWalletBackupEnvelope, type MarketplaceWalletBackupInspection,
} from "./marketplace-backup-manifest";
import { assertMarketplaceCoherence, registerMarketplaceContext, type MarketplaceContext } from "./marketplace-coordination-store";
import {
  assertFreshMarketplaceRecoveryTarget, assertMarketplaceRecoveryIdentityQuarantine,
  installMarketplaceRecoveryRows, readMarketplaceRecoveryReceipt, readMarketplaceRecoveryRows,
  writeMarketplaceRecoveryReceipt, type MarketplaceRecoveryReceipt,
} from "./marketplace-recovery-store";
import { assertSimulationRuntime } from "./runtime";
import { parseVersionedCommand, v2Command, versionedCommandKey } from "./v2-commands";
import { isV2State } from "./v2-engine";
import { exportVersionedWalletBackup } from "./versioned-backup";
import { createVersionedDurableWallet, upgradeDurableWalletV2, verifyVersionedHistory, type VersionedWalletSnapshot } from "./versioned-durable";

export { inspectMarketplaceWalletBackup } from "./marketplace-backup-manifest";
export type { MarketplaceWalletBackupEnvelope, MarketplaceWalletBackupInspection } from "./marketplace-backup-manifest";

const identity = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const exportInput = z.strictObject({ sessionToken: z.string().min(1).max(512), requestId: identity });
const COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;

export class MarketplaceWalletRecoveryError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "OWNER_REQUIRED" | "SOURCE_NOT_PAUSED" | "INTEGRITY"
    | "STORAGE_UNAVAILABLE" | "40001" | "40P01", message: string) {
    super(message); this.name = "MarketplaceWalletRecoveryError";
  }
}
function check(value: unknown, code: MarketplaceWalletRecoveryError["code"], message: string): asserts value {
  if (!value) throw new MarketplaceWalletRecoveryError(code, message);
}
function safeFailure(error: unknown): Error {
  if (error instanceof CommitOutcomeUnknownError) {
    return new CommitOutcomeUnknownError(new Error("Development recovery transaction acknowledgement unavailable"));
  }
  if (error instanceof MarketplaceWalletRecoveryError || error instanceof WalletBackupError
    || error instanceof WalletAccessError || error instanceof WalletIntegrityError) return error;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "40001" || code === "40P01") {
    return new MarketplaceWalletRecoveryError(code, "Development recovery transaction retries were exhausted");
  }
  // A driver's detail/cause/query can contain private payment snapshots. Keep
  // retry classification inside the real owner; sanitize only its final error.
  return new MarketplaceWalletRecoveryError("STORAGE_UNAVAILABLE", "Development marketplace recovery could not complete the operation");
}
function checkedTime(clock: () => number): number {
  const at = clock();
  check(Number.isSafeInteger(at) && at >= 0 && Number.isFinite(new Date(at).getTime()), "INVALID_INPUT", "Invalid development recovery clock");
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
function checkpoint(snapshot: VersionedWalletSnapshot): WalletBackupCheckpoint {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state),
    lastCommandAtMs: snapshot.lastCommandAtMs };
}
type TransactionIdentity = { transaction_id: string; isolation: string; read_only: string; development_mode: string | null };
async function transactionIdentity(tx: WalletSql, expected?: string, full = true) {
  assertSimulationRuntime("simulation-only");
  const result = await tx.query<TransactionIdentity>(`SELECT txid_current()::text AS transaction_id,
    current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS read_only,
    current_setting('alpha_wallet.development_schema', true) AS development_mode`);
  assertSimulationRuntime("simulation-only");
  const row = result.rows[0];
  check(result.rows.length === 1 && row && /^[1-9][0-9]*$/.test(row.transaction_id)
    && (expected === undefined || expected === row.transaction_id), "INTEGRITY", "Development recovery transaction identity changed or ended");
  if (full) check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only",
    "INTEGRITY", "Development recovery requires one writable SERIALIZABLE simulation transaction");
  return row.transaction_id;
}
async function owned<T>(store: WalletStore, work: (tx: WalletSql) => Promise<T>): Promise<T> {
  return store.transaction(async tx => {
    let certified: string | undefined;
    try {
      const identity = await transactionIdentity(tx);
      await transactionIdentity(tx, identity);
      certified = identity;
      const result = await work(tx);
      await transactionIdentity(tx, identity);
      return result;
    } catch (error) {
      if (certified !== undefined) {
        try {
          await transactionIdentity(tx, certified, false);
          await tx.query("SELECT 1 / 0 /* abort failed combined marketplace recovery */");
        } catch { /* Preserve the original error; never poison a changed transaction. */ }
      }
      throw error;
    }
  }).catch(error => { throw safeFailure(error); });
}

/**
 * Private DEVELOPMENT export. An actual current owner session and an already
 * paused, enrolled source are mandatory. The canonical lock order, fixed auth,
 * verified wallet replay and all row capture share the same transaction.
 * Returns private plaintext data; the caller must save it under restricted
 * access and retain its checksum separately. No file/network/provider operation.
 */
export async function exportMarketplaceWalletBackup(options: {
  mode: "simulation-only"; store: WalletStore; sessionToken: string; requestId: string; clock?: () => number;
}): Promise<string> {
  assertSimulationRuntime(options.mode);
  const parsed = exportInput.safeParse({ sessionToken: options.sessionToken, requestId: options.requestId });
  check(parsed.success, "INVALID_INPUT", "Invalid development marketplace recovery export input");
  const input = parsed.data;
  const clock = () => checkedTime(options.clock ?? Date.now);
  return owned(options.store, async tx => {
    let principal: DevelopmentMarketplaceWebPrincipal | undefined;
    let context: MarketplaceContext | undefined;
    let serialized: string | undefined;
    await mutateDevelopmentFocusedTradeInTransaction({ mode: options.mode, tx, requestId: input.requestId }, async db => {
      check(db.purchaseRequests.some(request => request.id === input.requestId), "INTEGRITY", "Recovery requires the canonical enrolled request identity");
      principal = await resolveDevelopmentMarketplaceWebPrincipal({ mode: options.mode, tx, token: input.sessionToken, clock });
      check(principal.isOwner, "OWNER_REQUIRED", "Combined marketplace export requires the authenticated owner");
      context = await registerMarketplaceContext({ mode: options.mode, tx, requestId: input.requestId,
        operation: "inspect", actorUserId: principal.userId });
      const scoped = scopedStore(tx);
      const snapshot = await createVersionedDurableWallet({ mode: options.mode, store: scoped }).snapshot();
      check(isV2State(snapshot.state) && snapshot.state.haltReason !== null, "SOURCE_NOT_PAUSED",
        "Pause the enrolled source through the owner coordinator before combined export");
      await assertMarketplaceCoherence(context);
      const rows = await readMarketplaceRecoveryRows(tx);
      const exportedAtMs = clock();
      const wallet: unknown = JSON.parse(await exportVersionedWalletBackup({ mode: options.mode, store: scoped, clock: () => exportedAtMs }));
      const body = { format: "alpha-wallet-marketplace-simulation-backup", formatVersion: 1, mode: options.mode,
        schemaVersion: "canonical-cohort-v1", exportedAtMs, requestId: input.requestId, ownerId: principal.userId,
        wallet, ...rows };
      const candidate = JSON.stringify({ ...body, checksum: walletDigest(body) }, null, 2);
      check(Buffer.byteLength(candidate, "utf8") <= MAX_WALLET_BACKUP_BYTES, "INVALID_INPUT", "Combined development backup byte limit exceeded");
      // Re-derive semantic relationships from the bytes the caller will receive.
      // This includes all fingerprints/receipt/publication links, not just SQL.
      parseMarketplaceWalletBackup(candidate);
      serialized = candidate;
      await principal.assertFresh();
      return db;
    });
    check(principal && context && serialized, "INTEGRITY", "Combined development export did not finish its owned transaction");
    await assertMarketplaceCoherence(context);
    await principal.assertFresh();
    return serialized;
  });
}

export type MarketplaceWalletRestoreResult = {
  backup: MarketplaceWalletBackupInspection; restored: WalletBackupCheckpoint;
  quarantined: true; quarantineCommandKey: string;
};

async function replayAndPause(tx: WalletSql, envelope: MarketplaceWalletBackupEnvelope, at: number) {
  const scoped = scopedStore(tx);
  await initializeDurableWallet(scoped);
  let replayClock = 0;
  const v1 = createDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
  const wallet = createVersionedDurableWallet({ mode: "simulation-only", store: scoped, clock: () => replayClock });
  for (const row of envelope.wallet.commands) {
    replayClock = Number(row.occurred_at_ms);
    const command = parseVersionedCommand(row.command_json);
    const execution = command.version === 1
      ? await v1.execute(parseWalletCommand(command))
      : command.type === "continueFromV1"
        ? await upgradeDurableWalletV2({ mode: "simulation-only", store: scoped, command,
          acknowledgeVersionUpgrade: true, clock: () => replayClock })
        : await wallet.execute(command);
    check(!execution.replayed && execution.revision === row.revision && execution.eventHash === row.event_hash,
      "INTEGRITY", "Restored wallet command differs from original verified history");
  }
  const original = await wallet.snapshot();
  check(walletDigest(checkpoint(original)) === walletDigest(envelope.wallet.checkpoint),
    "INTEGRITY", "Restored wallet differs from the source checkpoint before quarantine");
  const quarantine = v2Command("pause", { kind: "operator", id: "marketplace-backup-recovery" }, `restore-${envelope.checksum}`, null);
  const quarantineCommandKey = versionedCommandKey(quarantine);
  check(!envelope.wallet.commands.some(row => row.command_key === quarantineCommandKey), "INTEGRITY", "Recovery quarantine identity already exists");
  replayClock = at;
  const pause = await wallet.execute(quarantine);
  const restored = await wallet.snapshot();
  check(!pause.replayed && restored.revision === envelope.wallet.checkpoint.revision + 1
    && isV2State(restored.state) && restored.state.haltReason !== null,
  "INTEGRITY", "Recovery must append a new durable pause before installing canonical records");
  return { restored: checkpoint(restored), quarantineCommandKey };
}

/**
 * Fresh isolated DEVELOPMENT target only. Full byte/semantic validation precedes
 * opening its transaction. Original commands, canonical rows, receipts, common
 * fences, a new pause and the immutable recovery receipt commit atomically.
 * Restored identities are disabled stubs; sessions/credentials are never copied.
 * There is no resume, authority re-entry, provider or external publication path.
 */
export async function restoreMarketplaceWalletBackup(options: {
  mode: "simulation-only"; store: WalletStore; backup: string; acknowledgeFreshTarget: true;
  expectedChecksum: string; clock?: () => number;
}): Promise<MarketplaceWalletRestoreResult> {
  assertSimulationRuntime(options.mode);
  check(options.acknowledgeFreshTarget === true, "INVALID_INPUT", "Explicit acknowledgment of a fresh isolated development target is required");
  const expected = expectedChecksum(options.expectedChecksum);
  const envelope = parseMarketplaceWalletBackup(options.backup, expected);
  const backup = inspectMarketplaceWalletBackup(options.backup, { expectedChecksum: expected });
  const at = checkedTime(options.clock ?? Date.now);
  check(at >= envelope.exportedAtMs && at >= envelope.wallet.checkpoint.lastCommandAtMs,
    "INVALID_INPUT", "Restore clock precedes the exported source checkpoint");
  return owned(options.store, async tx => {
    await assertFreshMarketplaceRecoveryTarget(tx);
    const { restored, quarantineCommandKey } = await replayAndPause(tx, envelope, at);
    await installMarketplaceRecoveryRows(tx, { canonical: envelope.canonical, coordination: envelope.coordination });
    const context = await registerMarketplaceContext({ mode: options.mode, tx, requestId: envelope.requestId,
      operation: "inspect", actorUserId: envelope.ownerId });
    await assertMarketplaceCoherence(context);
    await assertMarketplaceRecoveryIdentityQuarantine(tx);
    const rows = await readMarketplaceRecoveryRows(tx);
    const canonicalDigest = walletDigest(envelope.canonical), coordinationDigest = walletDigest(envelope.coordination);
    check(walletDigest(rows.canonical) === canonicalDigest && walletDigest(rows.coordination) === coordinationDigest,
      "INTEGRITY", "Restored marketplace records differ from the verified source bundle");
    const verified = await createVersionedDurableWallet({ mode: options.mode, store: scopedStore(tx) }).snapshot();
    check(walletDigest(checkpoint(verified)) === walletDigest(restored), "INTEGRITY", "Recovery changed the quarantined wallet checkpoint");
    const receipt: MarketplaceRecoveryReceipt = { checksum: envelope.checksum, source: envelope.wallet.checkpoint,
      restored, requestId: envelope.requestId, ownerId: envelope.ownerId, restoredAtMs: at,
      canonicalDigest, coordinationDigest, quarantineCommandKey };
    await writeMarketplaceRecoveryReceipt(tx, receipt);
    await assertMarketplaceCoherence(context);
    return { backup, restored, quarantined: true as const, quarantineCommandKey };
  });
}

export type MarketplaceWalletRecoveryInspection = MarketplaceRecoveryReceipt & { quarantined: true };

/**
 * Offline, capability-scoped same-target outcome inspection after an uncertain
 * COMMIT. It accepts no session/actor override and grants no user authority. The
 * supplied guarded development database capability and separately kept checksum
 * are required. It returns safe metadata only, and refuses altered or unpaused
 * targets. Operational transaction registrations are not financial commands.
 */
export async function inspectRestoredMarketplaceWallet(options: {
  mode: "simulation-only"; store: WalletStore; expectedChecksum: string;
}): Promise<MarketplaceWalletRecoveryInspection> {
  assertSimulationRuntime(options.mode);
  const expected = expectedChecksum(options.expectedChecksum);
  return owned(options.store, async tx => {
    const receipt = await readMarketplaceRecoveryReceipt(tx);
    check(receipt && receipt.checksum === expected, "INTEGRITY", "This target has no matching completed combined recovery receipt");
    const context = await registerMarketplaceContext({ mode: options.mode, tx, requestId: receipt.requestId,
      operation: "inspect", actorUserId: receipt.ownerId });
    const snapshot = await createVersionedDurableWallet({ mode: options.mode, store: scopedStore(tx) }).snapshot();
    check(isV2State(snapshot.state) && snapshot.state.haltReason !== null
      && walletDigest(checkpoint(snapshot)) === walletDigest(receipt.restored),
    "INTEGRITY", "Recovered wallet is unpaused or differs from its immutable recovery checkpoint");
    const commands = (await tx.query(COMMANDS)).rows;
    check(commands.length === receipt.source.revision + 1 && receipt.restored.revision === commands.length,
      "INTEGRITY", "Recovered wallet must contain exactly the original history and its new pause");
    const original = verifyVersionedHistory(commands.slice(0, -1));
    check(walletDigest(checkpoint(original)) === walletDigest(receipt.source), "INTEGRITY", "Recovered original history differs from its source checkpoint");
    const quarantine = v2Command("pause", { kind: "operator", id: "marketplace-backup-recovery" }, `restore-${expected}`, null);
    const last = commands[commands.length - 1];
    check(last && walletDigest(last.command_json) === walletDigest(quarantine)
      && last.command_key === versionedCommandKey(quarantine) && last.command_key === receipt.quarantineCommandKey
      && Number(last.occurred_at_ms) === receipt.restoredAtMs && receipt.restored.lastCommandAtMs === receipt.restoredAtMs,
    "INTEGRITY", "Recovered quarantine identity differs from the combined recovery receipt");
    await assertMarketplaceRecoveryIdentityQuarantine(tx);
    const rows = await readMarketplaceRecoveryRows(tx);
    check(walletDigest(rows.canonical) === receipt.canonicalDigest && walletDigest(rows.coordination) === receipt.coordinationDigest,
      "INTEGRITY", "Recovered canonical records differ from the combined recovery receipt");
    await assertMarketplaceCoherence(context);
    return { ...receipt, quarantined: true as const };
  });
}
