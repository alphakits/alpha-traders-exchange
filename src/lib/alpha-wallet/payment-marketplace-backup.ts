import "server-only";

import { z } from "zod";
import { WalletAccessError } from "./access";
import { MAX_WALLET_BACKUP_BYTES, MAX_WALLET_BACKUP_COMMANDS, WALLET_BACKUP_FORMAT,
  WalletBackupError, type WalletBackupCheckpoint } from "./backup";
import {
  PAYMENT_MARKETPLACE_WALLET_BACKUP_FORMAT, PAYMENT_MARKETPLACE_WALLET_BACKUP_SCHEMA,
  PAYMENT_MARKETPLACE_WALLET_LEDGER_SCOPE, inspectPaymentMarketplaceWalletBackup,
  parsePaymentMarketplaceWalletBackup, type PaymentMarketplaceWalletBackupEnvelope,
  type PaymentMarketplaceWalletBackupInspection,
} from "./payment-marketplace-backup-manifest";
import { assertPaymentMarketplaceCoherence, registerPaymentMarketplaceContext,
  type PaymentMarketplaceContext } from "./payment-marketplace-coordination-store";
import {
  assertFreshPaymentMarketplaceRecoveryTarget, assertPaymentMarketplaceRecoveryIdentityQuarantine,
  installPaymentMarketplaceRecoveryRows, readPaymentMarketplaceRecoveryReceipt, readPaymentMarketplaceRecoveryRows,
  writePaymentMarketplaceRecoveryReceipt, type PaymentMarketplaceRecoveryReceipt,
} from "./payment-marketplace-recovery-store";
import { parseWalletCommand, walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet, WalletIntegrityError } from "./durable";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import { resolveDevelopmentMarketplaceWebPrincipal, type DevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";
import { developmentMarketplaceMobileCredentialsSchema, resolveDevelopmentMarketplaceMobilePrincipal,
  type DevelopmentMarketplaceMobileCredentials } from "./marketplace-mobile-auth";
import { assertSimulationRuntime } from "./runtime";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "./versioned-durable";
import { createV3DurableWallet, upgradeDurableWalletV3 } from "./v3-durable";
import { createV4DurableWallet, upgradeDurableWalletV4 } from "./v4-durable";
import { parseV5VersionedCommand, v5Command, v5CommandKey, WALLET_V5_ENGINE_VERSION } from "./v5-commands";
import { createCoordinatedV5DurableWallet, createV5DurableWallet, upgradeDurableWalletV5,
  verifyV5History, type V5WalletSnapshot } from "./v5-durable";
import { isV5State } from "./v5-engine";

export { inspectPaymentMarketplaceWalletBackup, parsePaymentMarketplaceWalletBackup } from "./payment-marketplace-backup-manifest";
export type { PaymentMarketplaceWalletBackupEnvelope, PaymentMarketplaceWalletBackupInspection } from "./payment-marketplace-backup-manifest";

const identity = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const exportInput = z.strictObject({ sessionToken: z.string().min(1).max(512), requestId: identity });
const mobileExportInput = z.strictObject({ ...developmentMarketplaceMobileCredentialsSchema.shape, requestId: identity });
type ExportOptions = { mode: "simulation-only"; store: WalletStore; requestId: string; clock?: () => number };
type Captured<T> = { prepared: T } | { error: unknown };
const COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;

export class PaymentMarketplaceWalletRecoveryError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "OWNER_REQUIRED" | "SOURCE_NOT_PAUSED" | "INTEGRITY"
    | "STORAGE_UNAVAILABLE" | "40001" | "40P01", message: string) {
    super(message); this.name = "PaymentMarketplaceWalletRecoveryError";
  }
}
function check(value: unknown, code: PaymentMarketplaceWalletRecoveryError["code"], message: string): asserts value {
  if (!value) throw new PaymentMarketplaceWalletRecoveryError(code, message);
}
function safeFailure(error: unknown): Error {
  if (error instanceof CommitOutcomeUnknownError) return new CommitOutcomeUnknownError(new Error("Development payment recovery acknowledgement unavailable"));
  if (error instanceof PaymentMarketplaceWalletRecoveryError || error instanceof WalletBackupError
    || error instanceof WalletAccessError || error instanceof WalletIntegrityError) return error;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "40001" || code === "40P01") return new PaymentMarketplaceWalletRecoveryError(code, "Development payment recovery retries were exhausted");
  return new PaymentMarketplaceWalletRecoveryError("STORAGE_UNAVAILABLE", "Development payment marketplace recovery could not complete the operation");
}
function captured<T>(work: () => T): Captured<T> {
  try { return { prepared: work() }; } catch (error) { return { error }; }
}
function prepared<T>(value: Captured<T>): T { if ("error" in value) throw value.error; return value.prepared; }
function checkedTime(clock: () => number): number {
  const at = clock();
  check(Number.isSafeInteger(at) && at >= 0 && Number.isFinite(new Date(at).getTime()), "INVALID_INPUT", "Invalid payment recovery clock");
  return at;
}
function expectedChecksum(value: unknown): string {
  const parsed = checksumSchema.safeParse(value);
  check(parsed.success, "INVALID_INPUT", "A separately retained expected backup checksum is required");
  return parsed.data;
}
const scopedStore = (tx: WalletSql): WalletStore => ({
  transaction: work => work(tx), close: async () => { throw new WalletBackupError("The outer payment recovery transaction owns this store"); },
});
function checkpoint(snapshot: V5WalletSnapshot): WalletBackupCheckpoint {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs };
}
async function transactionIdentity(tx: WalletSql, expected: string) {
  const result = await tx.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null; timezone: string }>(
    `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
      current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode,
      current_setting('TimeZone') AS timezone`);
  const row = result.rows[0];
  check(result.rows.length === 1 && row?.transaction_id === expected, "INTEGRITY", "Payment recovery transaction identity changed or ended");
  check(row.isolation === "serializable" && row.read_only === "off" && row.development_mode === "simulation-only",
    "INTEGRITY", "Payment recovery requires one writable SERIALIZABLE simulation transaction");
  check(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/GMT0"].includes(row.timezone), "INTEGRITY", "Payment recovery requires exact UTC timestamp representations");
  assertSimulationRuntime("simulation-only");
}
async function owned<T>(store: WalletStore, work: (tx: WalletSql) => Promise<T>): Promise<T> {
  return store.transaction(async tx => {
    let certified: string | undefined;
    try {
      // Certify the raw physical identity before reporting captured refusals.
      // Cleanup must remain possible even if runtime validation itself fails.
      const rows = (await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
      check(rows.length === 1 && /^[1-9][0-9]*$/.test(rows[0]?.transaction_id), "INTEGRITY", "Payment recovery needs a stable physical transaction");
      certified = rows[0].transaction_id;
      await transactionIdentity(tx, certified);
      const originalIdentity = certified;
      // Every nested reader, replay writer and recovery participant receives a
      // handle tied to this certificate. A replacement cannot be returned to a
      // child as a newly owned transaction, including during its first probe.
      const scoped: WalletSql = {
        async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
          await transactionIdentity(tx, originalIdentity);
          const result = await tx.query<Row>(sql, values);
          await transactionIdentity(tx, originalIdentity);
          return result;
        },
        async exec(sql: string) {
          await transactionIdentity(tx, originalIdentity);
          await tx.exec(sql);
          await transactionIdentity(tx, originalIdentity);
        },
      };
      const value = await work(scoped);
      await transactionIdentity(tx, certified);
      return value;
    } catch (error) {
      if (certified !== undefined) {
        try {
          const rows = (await tx.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
          if (rows.length === 1 && rows[0]?.transaction_id === certified) await tx.query("SELECT 1 / 0 /* abort failed payment combined recovery */");
        } catch { /* Preserve the original refusal; never poison a replacement transaction. */ }
      }
      throw error;
    }
  }).catch(error => { throw safeFailure(error); });
}
async function lockExport(tx: WalletSql, requestId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(61422919,hashtext($1))", [requestId]);
  await tx.query("SELECT pg_advisory_xact_lock(61422917)");
  const runtime = await tx.query("SELECT version FROM alpha_exchange.runtime_meta WHERE singleton=true FOR UPDATE");
  check(runtime.rows.length === 1, "INTEGRITY", "Payment recovery requires the canonical runtime fence");
  const listing = await tx.query(`SELECT l.id FROM alpha_exchange.listings l JOIN alpha_exchange.purchase_requests r ON r.listing_id=l.id
    WHERE r.id=$1 ORDER BY l.id FOR UPDATE OF l`, [requestId]);
  check(listing.rows.length === 1, "INTEGRITY", "Payment recovery requires the exact mapped listing");
}

/** Current stored owner authority and a durably paused source are mandatory. */
export async function exportPaymentMarketplaceWalletBackup(options: ExportOptions & { sessionToken: string }): Promise<string> {
  const { mode, store, requestId, sessionToken, clock = Date.now } = options;
  const input = captured(() => {
    assertSimulationRuntime(mode);
    const parsed = exportInput.safeParse({ requestId, sessionToken });
    check(parsed.success, "INVALID_INPUT", "Invalid payment marketplace export input");
    return parsed.data;
  });
  return exportAuthenticated(store, input, clock);
}
/** The same bytes and scope through the fixed stored mobile/device reader. */
export async function exportMobilePaymentMarketplaceWalletBackup(options: ExportOptions & DevelopmentMarketplaceMobileCredentials): Promise<string> {
  const { mode, store, requestId, accessToken, metadata, clock = Date.now } = options;
  const input = captured(() => {
    assertSimulationRuntime(mode);
    const parsed = mobileExportInput.safeParse({ requestId, accessToken, metadata });
    check(parsed.success, "INVALID_INPUT", "Invalid mobile payment marketplace export input");
    return parsed.data;
  });
  return exportAuthenticated(store, input, clock);
}
async function exportAuthenticated(store: WalletStore,
  capturedInput: Captured<z.infer<typeof exportInput> | z.infer<typeof mobileExportInput>>, sourceClock: () => number): Promise<string> {
  const clock = () => checkedTime(sourceClock);
  return owned(store, async tx => {
    const input = prepared(capturedInput);
    await lockExport(tx, input.requestId);
    const principal: DevelopmentMarketplaceWebPrincipal = "sessionToken" in input
      ? await resolveDevelopmentMarketplaceWebPrincipal({ mode: "simulation-only", tx, token: input.sessionToken, clock })
      : await resolveDevelopmentMarketplaceMobilePrincipal({ mode: "simulation-only", tx, accessToken: input.accessToken, metadata: input.metadata, clock });
    check(principal.isOwner, "OWNER_REQUIRED", "Combined payment export requires the authenticated owner");
    const context = await registerPaymentMarketplaceContext({ mode: "simulation-only", tx, requestId: input.requestId,
      operation: "export", actorUserId: principal.userId });
    const snapshot = await createCoordinatedV5DurableWallet({ mode: "simulation-only", context }).snapshot();
    check(isV5State(snapshot.state) && Boolean(snapshot.state.haltReason), "SOURCE_NOT_PAUSED", "Pause the successor source through its owner coordinator before export");
    check(snapshot.revision < MAX_WALLET_BACKUP_COMMANDS, "INVALID_INPUT", "Payment backup must retain room for its quarantine command");
    await assertPaymentMarketplaceCoherence(context);
    const rows = await readPaymentMarketplaceRecoveryRows(tx);
    const exportedAtMs = clock();
    check(exportedAtMs >= snapshot.lastCommandAtMs, "INVALID_INPUT", "Export clock precedes the successor wallet history");
    const commands = (await tx.query(COMMANDS)).rows;
    const walletBody = { format: WALLET_BACKUP_FORMAT, formatVersion: 5, scope: PAYMENT_MARKETPLACE_WALLET_LEDGER_SCOPE,
      mode: "simulation-only", engineVersion: WALLET_V5_ENGINE_VERSION, sourcePaused: true, exportedAtMs,
      checkpoint: checkpoint(snapshot), continuation: snapshot.state.continuation, initialContinuation: snapshot.state.initialContinuation,
      cancellationContinuation: snapshot.state.cancellationContinuation, paymentContinuation: snapshot.state.paymentContinuation, commands };
    const wallet = { ...walletBody, checksum: walletDigest(walletBody) };
    const body = { format: PAYMENT_MARKETPLACE_WALLET_BACKUP_FORMAT, formatVersion: 1, mode: "simulation-only",
      schemaVersion: PAYMENT_MARKETPLACE_WALLET_BACKUP_SCHEMA, exportedAtMs, requestId: input.requestId,
      ownerId: principal.userId, wallet, ...rows };
    const serialized = JSON.stringify({ ...body, checksum: walletDigest(body) }, null, 2);
    check(Buffer.byteLength(serialized, "utf8") <= MAX_WALLET_BACKUP_BYTES, "INVALID_INPUT", "Combined payment backup byte limit exceeded");
    parsePaymentMarketplaceWalletBackup(serialized);
    await principal.assertFresh();
    await assertPaymentMarketplaceCoherence(context);
    await principal.assertFresh();
    return serialized;
  });
}

export type PaymentMarketplaceWalletRestoreResult = {
  backup: PaymentMarketplaceWalletBackupInspection; restored: WalletBackupCheckpoint; quarantined: true; quarantineCommandKey: string;
};
async function replayAndPause(tx: WalletSql, envelope: PaymentMarketplaceWalletBackupEnvelope, at: number) {
  const store = scopedStore(tx);
  await initializeDurableWallet(store);
  let clock = 0;
  const v1 = createDurableWallet({ mode: "simulation-only", store, clock: () => clock });
  const v2 = createVersionedDurableWallet({ mode: "simulation-only", store, clock: () => clock });
  const v3 = createV3DurableWallet({ mode: "simulation-only", store, clock: () => clock });
  const v4 = createV4DurableWallet({ mode: "simulation-only", store, clock: () => clock });
  const v5 = createV5DurableWallet({ mode: "simulation-only", store, clock: () => clock });
  for (const row of envelope.wallet.commands) {
    clock = Number(row.occurred_at_ms);
    const command = parseV5VersionedCommand(row.command_json);
    const execution = command.version === 1 ? await v1.execute(parseWalletCommand(command))
      : command.version === 2 ? command.type === "continueFromV1"
        ? await upgradeDurableWalletV2({ mode: "simulation-only", store, command, acknowledgeVersionUpgrade: true, clock: () => clock }) : await v2.execute(command)
        : command.version === 3 ? command.type === "continueFromV2"
          ? await upgradeDurableWalletV3({ mode: "simulation-only", store, command, acknowledgeVersionUpgrade: true, clock: () => clock }) : await v3.execute(command)
          : command.version === 4 ? command.type === "continueFromV3"
            ? await upgradeDurableWalletV4({ mode: "simulation-only", store, command, acknowledgeVersionUpgrade: true, clock: () => clock }) : await v4.execute(command)
            : command.type === "continueFromV4"
              ? await upgradeDurableWalletV5({ mode: "simulation-only", store, command, acknowledgeVersionUpgrade: true,
                acknowledgePaymentClaimOnlyProfile: true, clock: () => clock }) : await v5.execute(command);
    check(!execution.replayed && execution.revision === row.revision && execution.eventHash === row.event_hash,
      "INTEGRITY", "Restored payment wallet differs from its original command history");
  }
  const original = await v5.snapshot();
  check(sameCheckpoint(checkpoint(original), envelope.wallet.checkpoint), "INTEGRITY", "Restored payment wallet differs before quarantine");
  const quarantine = v5Command("pause", { kind: "operator", id: "payment-marketplace-backup-recovery" }, `restore-${envelope.checksum}`, null);
  const quarantineCommandKey = v5CommandKey(quarantine);
  check(!envelope.wallet.commands.some(row => row.command_key === quarantineCommandKey), "INTEGRITY", "Payment quarantine identity already exists");
  clock = at;
  const pause = await v5.execute(quarantine), restored = await v5.snapshot();
  check(!pause.replayed && isV5State(restored.state) && Boolean(restored.state.haltReason)
    && restored.revision === envelope.wallet.checkpoint.revision + 1, "INTEGRITY", "Payment restore must append one new V5 quarantine pause");
  return { restored: checkpoint(restored), quarantineCommandKey };
}
const sameCheckpoint = (left: WalletBackupCheckpoint, right: WalletBackupCheckpoint) => walletDigest(left) === walletDigest(right);

/** Fresh-target restore is one certified transaction. It restores no credentials or resume authority. */
export async function restorePaymentMarketplaceWalletBackup(options: {
  mode: "simulation-only"; store: WalletStore; backup: string; acknowledgeFreshTarget: true; expectedChecksum: string; clock?: () => number;
}): Promise<PaymentMarketplaceWalletRestoreResult> {
  const { mode, store, backup: serialized, acknowledgeFreshTarget, expectedChecksum: expectedInput, clock = Date.now } = options;
  const input = captured(() => {
    assertSimulationRuntime(mode);
    check(acknowledgeFreshTarget === true, "INVALID_INPUT", "Explicit acknowledgment of a fresh isolated development target is required");
    const expected = expectedChecksum(expectedInput), envelope = parsePaymentMarketplaceWalletBackup(serialized, expected);
    const backup = inspectPaymentMarketplaceWalletBackup(serialized, { expectedChecksum: expected }), at = checkedTime(clock);
    check(at >= envelope.exportedAtMs && at >= envelope.wallet.checkpoint.lastCommandAtMs, "INVALID_INPUT", "Restore clock precedes the exported payment source");
    return { envelope, backup, at };
  });
  return owned(store, async tx => {
    const { envelope, backup, at } = prepared(input);
    await assertFreshPaymentMarketplaceRecoveryTarget(tx);
    const { restored, quarantineCommandKey } = await replayAndPause(tx, envelope, at);
    await installPaymentMarketplaceRecoveryRows(tx, { canonical: envelope.canonical, predecessor: envelope.predecessor, coordination: envelope.coordination });
    const context = await registerPaymentMarketplaceContext({ mode: "simulation-only", tx, requestId: envelope.requestId,
      operation: "inspect", actorUserId: envelope.ownerId });
    await assertPaymentMarketplaceCoherence(context);
    await assertPaymentMarketplaceRecoveryIdentityQuarantine(tx);
    const rows = await readPaymentMarketplaceRecoveryRows(tx);
    const canonicalDigest = walletDigest(envelope.canonical), predecessorDigest = walletDigest(envelope.predecessor), coordinationDigest = walletDigest(envelope.coordination);
    check(walletDigest(rows.canonical) === canonicalDigest && walletDigest(rows.predecessor) === predecessorDigest
      && walletDigest(rows.coordination) === coordinationDigest, "INTEGRITY", "Restored payment records differ from the original recovery bundle");
    const snapshot = await createCoordinatedV5DurableWallet({ mode: "simulation-only", context }).snapshot();
    check(sameCheckpoint(checkpoint(snapshot), restored), "INTEGRITY", "Recovery changed the quarantined successor checkpoint");
    const receipt: PaymentMarketplaceRecoveryReceipt = { checksum: envelope.checksum, source: envelope.wallet.checkpoint, restored,
      requestId: envelope.requestId, ownerId: envelope.ownerId, restoredAtMs: at, canonicalDigest, predecessorDigest, coordinationDigest, quarantineCommandKey };
    await writePaymentMarketplaceRecoveryReceipt(tx, receipt);
    await assertPaymentMarketplaceCoherence(context);
    return { backup, restored, quarantined: true as const, quarantineCommandKey };
  });
}

export type PaymentMarketplaceWalletRecoveryInspection = PaymentMarketplaceRecoveryReceipt & { quarantined: true };
/** Offline same-target outcome inspection grants no account, signing, or resume authority. */
export async function inspectRestoredPaymentMarketplaceWallet(options: {
  mode: "simulation-only"; store: WalletStore; expectedChecksum: string;
}): Promise<PaymentMarketplaceWalletRecoveryInspection> {
  const { mode, store, expectedChecksum: value } = options;
  const input = captured(() => { assertSimulationRuntime(mode); return expectedChecksum(value); });
  return owned(store, async tx => {
    const expected = prepared(input), receipt = await readPaymentMarketplaceRecoveryReceipt(tx);
    check(receipt && receipt.checksum === expected, "INTEGRITY", "This target has no matching completed payment recovery receipt");
    const context: PaymentMarketplaceContext = await registerPaymentMarketplaceContext({ mode: "simulation-only", tx,
      requestId: receipt.requestId, operation: "inspect", actorUserId: receipt.ownerId });
    const snapshot = await createCoordinatedV5DurableWallet({ mode: "simulation-only", context }).snapshot();
    check(isV5State(snapshot.state) && Boolean(snapshot.state.haltReason) && sameCheckpoint(checkpoint(snapshot), receipt.restored),
      "INTEGRITY", "Recovered payment wallet differs from its paused immutable checkpoint");
    const commands = (await tx.query(COMMANDS)).rows;
    check(commands.length === receipt.source.revision + 1 && receipt.restored.revision === commands.length,
      "INTEGRITY", "Recovered successor requires exactly original history plus its new pause");
    const original = verifyV5History(commands.slice(0, -1));
    check(sameCheckpoint(checkpoint(original), receipt.source), "INTEGRITY", "Recovered successor history differs from its source checkpoint");
    const quarantine = v5Command("pause", { kind: "operator", id: "payment-marketplace-backup-recovery" }, `restore-${expected}`, null);
    const last = commands.at(-1);
    check(last && walletDigest(last.command_json) === walletDigest(quarantine) && last.command_key === v5CommandKey(quarantine)
      && last.command_key === receipt.quarantineCommandKey && Number(last.occurred_at_ms) === receipt.restoredAtMs
      && receipt.restored.lastCommandAtMs === receipt.restoredAtMs, "INTEGRITY", "Recovered successor quarantine differs from its receipt");
    await assertPaymentMarketplaceRecoveryIdentityQuarantine(tx);
    const rows = await readPaymentMarketplaceRecoveryRows(tx);
    check(walletDigest(rows.canonical) === receipt.canonicalDigest && walletDigest(rows.predecessor) === receipt.predecessorDigest
      && walletDigest(rows.coordination) === receipt.coordinationDigest, "INTEGRITY", "Recovered successor records differ from the immutable recovery receipt");
    await assertPaymentMarketplaceCoherence(context);
    return { ...receipt, quarantined: true as const };
  });
}
