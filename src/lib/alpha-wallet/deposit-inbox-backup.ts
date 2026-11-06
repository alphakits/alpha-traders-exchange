import "server-only";

import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { CommitOutcomeUnknownError, type WalletStore } from "./durable-store";
import { captureInboxData, captureInboxOptions, canonicalInboxJson, depositInboxError,
  digestInboxValue, inboxCheck, inboxRuntime } from "./deposit-inbox-data";
import { DEPOSIT_INBOX_LIMITS, DEPOSIT_INBOX_PROFILE,
  type DepositInboxArchive, type DepositInboxCheckpoint, type DepositInboxReceipt,
  type DepositInboxRecoveryRecord } from "./deposit-inbox-protocol";
import { verifyDepositInboxArchive, planDepositInboxRestore } from "./deposit-inbox-model";
import { appendDepositInboxStore, captureDepositInboxStore, completeDepositInboxRestore,
  installDepositInboxStore, loadDepositInboxStore, withDepositInboxStoreTransaction } from "./deposit-inbox-store";
import { DEPOSIT_INBOX_BACKUP_FORMAT, assertDepositInboxPortableCapacity,
  assertDepositInboxPortableControlGrowth, serializeDepositInboxPortable } from "./deposit-inbox-portable";

export { DEPOSIT_INBOX_BACKUP_FORMAT } from "./deposit-inbox-portable";
export const MAX_DEPOSIT_INBOX_BACKUP_BYTES = DEPOSIT_INBOX_LIMITS.backupBytes;

const MAX_BACKUP_NODES = 100_000, MAX_BACKUP_DEPTH = 64, MAX_STRING_BYTES = 1_048_576;
const checksumSchema = z.string().regex(/^[0-9a-f]{64}$/);
const identifierSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const instantSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).refine(value => !Object.is(value, -0));

function exactIdentifier(value: unknown): string {
  inboxCheck(typeof value === "string", "INVALID_INPUT", "Deposit backup identities must be primitive strings");
  const parsed = identifierSchema.safeParse(value);
  inboxCheck(parsed.success, "INVALID_INPUT", "Deposit backup identity is outside its closed profile");
  return parsed.data;
}
function expectedChecksum(value: unknown): string {
  inboxCheck(typeof value === "string", "INVALID_INPUT", "A separately retained deposit backup checksum is required");
  const parsed = checksumSchema.safeParse(value);
  inboxCheck(parsed.success, "INVALID_INPUT", "A separately retained deposit backup checksum is required");
  return parsed.data;
}
function capturedClock(value: unknown): number {
  inboxCheck(value === undefined || typeof value === "function" && !types.isProxy(value),
    "INVALID_INPUT", "Deposit backup clock must be an explicit trusted function");
  let result: unknown;
  try {
    inboxRuntime("simulation-only");
    result = value === undefined ? Date.now() : (value as () => unknown)();
    inboxRuntime("simulation-only");
  } catch (error) { throw depositInboxError(error, "RUNTIME_REFUSED"); }
  inboxCheck(typeof result === "number", "INVALID_INPUT", "Deposit backup clock must return a primitive number");
  const parsed = instantSchema.safeParse(result);
  inboxCheck(parsed.success, "INVALID_INPUT", "Deposit backup clock must return an exact nonnegative instant");
  return parsed.data;
}

/**
 * Preflight the complete logical document before allocating its parsed tree.
 * Raw node responses remain strings here; their own unchanged native profiles
 * are checked again by historical transcript replay.
 */
function parsedDocument(serialized: unknown): unknown {
  inboxRuntime("simulation-only");
  inboxCheck(typeof serialized === "string" && serialized.length > 0 && serialized.length <= MAX_DEPOSIT_INBOX_BACKUP_BYTES,
    "RESOURCE_LIMIT", "Deposit backup must be a nonempty bounded JSON document");
  inboxCheck(Buffer.byteLength(serialized, "utf8") <= MAX_DEPOSIT_INBOX_BACKUP_BYTES,
    "RESOURCE_LIMIT", "Deposit backup exceeds its exact UTF-8 byte bound");
  inboxCheck(serialized.isWellFormed() && serialized.charCodeAt(0) !== 0xfeff,
    "INVALID_INPUT", "Deposit backup must contain well-formed UTF-8 JSON without a byte order mark");
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\],:]|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null/g;
  const stack: Array<{ kind: "object"; expectingKey: boolean; keys: Set<string> } | { kind: "array" }> = [];
  let nodes = 0;
  try {
    for (const match of serialized.matchAll(tokens)) {
      const token = match[0], current = stack[stack.length - 1];
      if (token === "{" || token === "[") {
        nodes += 1;
        stack.push(token === "{" ? { kind: "object", expectingKey: true, keys: new Set() } : { kind: "array" });
        inboxCheck(stack.length <= MAX_BACKUP_DEPTH, "RESOURCE_LIMIT", "Deposit backup nesting exceeds its structural bound");
      } else if (token === "}" || token === "]") stack.pop();
      else if (token === "," && current?.kind === "object") current.expectingKey = true;
      else if (token.startsWith('"')) {
        inboxCheck(token.length <= MAX_STRING_BYTES * 6 + 2, "RESOURCE_LIMIT", "Deposit backup string exceeds its encoded bound");
        if (current?.kind === "object" && current.expectingKey) {
          const key = JSON.parse(token) as string;
          inboxCheck(!current.keys.has(key), "INVALID_INPUT", "Deposit backup JSON contains an ambiguous duplicate key");
          current.keys.add(key); current.expectingKey = false;
        } else nodes += 1;
      } else if (token !== "," && token !== ":") {
        nodes += 1;
        if (token !== "true" && token !== "false" && token !== "null") {
          inboxCheck(token.length <= 17 && /^-?(?:0|[1-9][0-9]*)$/.test(token) && token !== "-0",
            "INVALID_INPUT", "Deposit backup numbers must use exact integer literals");
          const integer = BigInt(token), maximum = BigInt(Number.MAX_SAFE_INTEGER);
          inboxCheck(integer >= -maximum && integer <= maximum, "INVALID_INPUT", "Deposit backup integer exceeds the exact range");
        }
      }
      inboxCheck(nodes <= MAX_BACKUP_NODES, "RESOURCE_LIMIT", "Deposit backup exceeds its structural node bound");
    }
    return captureInboxData(JSON.parse(serialized));
  } catch (error) { throw depositInboxError(error); }
}

export interface DepositInboxBackupEnvelopeV1 {
  readonly format: typeof DEPOSIT_INBOX_BACKUP_FORMAT;
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly profile: typeof DEPOSIT_INBOX_PROFILE;
  readonly sourcePaused: true;
  readonly exportedAtMs: number;
  readonly archive: DepositInboxArchive;
  readonly checksum: string;
}
export interface DepositInboxBackupInspection {
  readonly format: typeof DEPOSIT_INBOX_BACKUP_FORMAT;
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly profile: typeof DEPOSIT_INBOX_PROFILE;
  readonly sourcePaused: true;
  readonly inboxId: string;
  readonly sourceStoreInstanceId: string;
  readonly originStoreInstanceId: string;
  readonly manifestSha256: string;
  readonly status: "paused" | "quarantined";
  readonly exportedAtMs: number;
  readonly checkpoint: DepositInboxCheckpoint;
  readonly commandCount: number;
  readonly observationCount: number;
  readonly blockAnchorCount: number;
  readonly transactionAnchorCount: number;
  readonly eventCount: number;
  readonly candidateJobCount: number;
  readonly quarantineCount: number;
  readonly recoveryCount: number;
  readonly rawEvidenceBytes: number;
  readonly checksum: string;
}
export interface DepositInboxRestoreResult {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly quarantined: true;
  readonly recovery: DepositInboxRecoveryRecord;
  readonly receipt: DepositInboxReceipt;
  readonly restored: DepositInboxCheckpoint;
}

const envelopeSchema = z.object({ format: z.literal(DEPOSIT_INBOX_BACKUP_FORMAT), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), creditAuthority: z.literal(false), profile: z.literal(DEPOSIT_INBOX_PROFILE),
  sourcePaused: z.literal(true), exportedAtMs: instantSchema, archive: z.unknown(), checksum: checksumSchema }).strict();

function same(left: unknown, right: unknown): boolean { return canonicalInboxJson(left) === canonicalInboxJson(right); }
function assertStopped(archive: DepositInboxArchive): void {
  inboxCheck(archive.projections.status === "paused" || archive.projections.status === "quarantined",
    "ADMISSION_REFUSED", "Deposit inbox must be durably paused or quarantined before export");
  assertDepositInboxPortableCapacity(archive, "terminal");
}
function inspection(envelope: DepositInboxBackupEnvelopeV1): DepositInboxBackupInspection {
  const { archive } = envelope, state = archive.projections;
  inboxCheck(state.status === "paused" || state.status === "quarantined", "ADMISSION_REFUSED", "Backup source is not stopped");
  return captureInboxData({ format: envelope.format, formatVersion: 1, mode: "simulation-only", creditAuthority: false,
    profile: envelope.profile, sourcePaused: true, inboxId: state.inboxId, sourceStoreInstanceId: state.storeInstanceId,
    originStoreInstanceId: state.originStoreInstanceId, manifestSha256: state.manifestSha256, status: state.status,
    exportedAtMs: envelope.exportedAtMs, checkpoint: archive.checkpoint, commandCount: archive.commands.length,
    observationCount: archive.evidenceBlobs.length, blockAnchorCount: state.blockAnchors.length,
    transactionAnchorCount: state.transactionAnchors.length, eventCount: state.events.length,
    candidateJobCount: state.candidateJobs.length, quarantineCount: state.quarantines.length,
    recoveryCount: state.recoveryReceipts.length, rawEvidenceBytes: state.rawEvidenceBytes, checksum: envelope.checksum });
}

/** Full historical replay; freshness at the current wall clock is deliberately not an archival condition. */
export async function parseDevelopmentDepositInboxBackup(serialized: unknown,
  suppliedOptions: { expectedChecksum?: string } = {}): Promise<DepositInboxBackupEnvelopeV1> {
  try {
    inboxRuntime("simulation-only");
    const options = captureInboxOptions(suppliedOptions, ["expectedChecksum"]);
    const expected = options.expectedChecksum === undefined ? undefined : expectedChecksum(options.expectedChecksum);
    const parsed = envelopeSchema.safeParse(parsedDocument(serialized));
    inboxCheck(parsed.success, "INVALID_INPUT", "Deposit backup is outside its isolated versioned format");
    const { checksum, ...body } = parsed.data;
    inboxCheck((expected === undefined || expected === checksum) && digestInboxValue("deposit-inbox-backup", body) === checksum,
      "REPLAY_MISMATCH", "Deposit backup differs from its complete canonical checksum");
    const archive = await verifyDepositInboxArchive(parsed.data.archive);
    inboxRuntime("simulation-only");
    inboxCheck(same(archive, parsed.data.archive), "REPLAY_MISMATCH", "Deposit backup is not an exact canonical archive");
    assertStopped(archive);
    inboxCheck(parsed.data.exportedAtMs >= archive.projections.lastCommandAtMs,
      "INVALID_INPUT", "Deposit backup export clock precedes its retained command history");
    // The model's verified archive is immutable and carries a private replay
    // certificate. Preserve that exact object instead of deep-copying its data.
    return Object.freeze({ ...parsed.data, archive });
  } catch (error) { throw depositInboxError(error, "INVALID_EVIDENCE"); }
}

export async function inspectDevelopmentDepositInboxBackup(serialized: unknown,
  options: { expectedChecksum?: string } = {}): Promise<DepositInboxBackupInspection> {
  return inspection(await parseDevelopmentDepositInboxBackup(serialized, options));
}

export async function exportDevelopmentDepositInboxBackup(supplied: {
  mode: "simulation-only"; store: WalletStore; expectedStoreInstanceId?: string; clock?: () => number;
}): Promise<string> {
  inboxRuntime("simulation-only");
  const options = captureInboxOptions(supplied, ["mode", "store", "expectedStoreInstanceId", "clock"]);
  inboxRuntime(options.mode);
  const store = captureDepositInboxStore(options.store);
  const selected = options.expectedStoreInstanceId === undefined ? undefined : exactIdentifier(options.expectedStoreInstanceId);
  const captured = (() => { try { return { atMs: capturedClock(options.clock) }; } catch (error) { return { error }; } })();
  return withDepositInboxStoreTransaction({ mode: "simulation-only", store, ...(selected === undefined ? {} : { expectedStoreInstanceId: selected }) }, async owner => {
    if ("error" in captured) throw captured.error;
    const archive = await loadDepositInboxStore(owner);
    assertStopped(archive);
    inboxCheck(captured.atMs >= archive.projections.lastCommandAtMs, "INVALID_INPUT", "Deposit export clock precedes retained history");
    const serialized = serializeDepositInboxPortable(archive, captured.atMs);
    inboxCheck(Buffer.byteLength(serialized, "utf8") <= MAX_DEPOSIT_INBOX_BACKUP_BYTES, "RESOURCE_LIMIT", "Deposit backup exceeds its portable byte bound");
    inboxRuntime("simulation-only");
    return serialized;
  });
}

function restorationResult(archive: DepositInboxArchive, requestId: string, checksum: string): DepositInboxRestoreResult {
  const state = archive.projections;
  inboxCheck(state.status === "quarantined", "INVALID_EVIDENCE", "A restored inbox must remain quarantined");
  const matching = state.recoveryReceipts.filter(receipt => receipt.requestId === requestId && receipt.backupChecksum === checksum
    && receipt.targetStoreInstanceId === state.storeInstanceId);
  inboxCheck(matching.length === 1, "REPLAY_MISMATCH", "This target has no complete matching restoration receipt");
  const recovery = matching[0], record = archive.commands.find(command => command.revision === recovery.commandRevision);
  inboxCheck(record && record.command.type === "restore-quarantine" && record.receipt.disposition === "restored-quarantined"
    && recovery.targetRevision === record.revision && record.revision === archive.checkpoint.revision,
  "REPLAY_MISMATCH", "Restoration receipt is not the target's complete terminal command");
  return captureInboxData({ mode: "simulation-only", creditAuthority: false, quarantined: true,
    recovery, receipt: record.receipt, restored: record.receipt.checkpoint });
}

/** Recovery lookup is confined to this target. It makes no claim about post-backup commands at its source. */
export async function inspectRestoredDevelopmentDepositInbox(supplied: {
  mode: "simulation-only"; store: WalletStore; requestId: string; expectedChecksum: string; expectedStoreInstanceId?: string;
}): Promise<DepositInboxRestoreResult> {
  inboxRuntime("simulation-only");
  const options = captureInboxOptions(supplied, ["mode", "store", "requestId", "expectedChecksum", "expectedStoreInstanceId"]);
  inboxRuntime(options.mode);
  const store = captureDepositInboxStore(options.store), requestId = exactIdentifier(options.requestId), checksum = expectedChecksum(options.expectedChecksum);
  const selected = options.expectedStoreInstanceId === undefined ? undefined : exactIdentifier(options.expectedStoreInstanceId);
  return withDepositInboxStoreTransaction({ mode: "simulation-only", store, ...(selected === undefined ? {} : { expectedStoreInstanceId: selected }) }, async owner => {
    const archive = await loadDepositInboxStore(owner);
    return restorationResult(archive, requestId, checksum);
  });
}

/** Restore every original row and exactly one new quarantine/recovery receipt in the same certified owner. */
export async function restoreDevelopmentDepositInboxBackup(supplied: {
  mode: "simulation-only"; store: WalletStore; backup: string; expectedChecksum: string;
  acknowledgeFreshTarget: true; requestId: string; clock?: () => number;
}): Promise<DepositInboxRestoreResult> {
  inboxRuntime("simulation-only");
  const options = captureInboxOptions(supplied, ["mode", "store", "backup", "expectedChecksum", "acknowledgeFreshTarget", "requestId", "clock"]);
  inboxRuntime(options.mode);
  const store = captureDepositInboxStore(options.store);
  const captured = await (async () => {
    try {
      inboxCheck(options.acknowledgeFreshTarget === true, "INVALID_INPUT", "Deposit recovery requires explicit fresh-target acknowledgment");
      const requestId = exactIdentifier(options.requestId), checksum = expectedChecksum(options.expectedChecksum);
      const atMs = capturedClock(options.clock), targetStoreInstanceId = `deposit-inbox-${randomUUID()}`;
      const envelope = await parseDevelopmentDepositInboxBackup(options.backup, { expectedChecksum: checksum });
      inboxCheck(atMs >= envelope.exportedAtMs, "INVALID_INPUT", "Deposit restore clock precedes its backup export");
      inboxCheck(targetStoreInstanceId !== envelope.archive.projections.storeInstanceId
        && !envelope.archive.projections.recoveryReceipts.some(receipt => receipt.targetStoreInstanceId === targetStoreInstanceId
          || receipt.sourceStoreInstanceId === targetStoreInstanceId), "INVALID_INPUT", "Deposit restore requires a new physical instance identity");
      const plan = await planDepositInboxRestore(envelope.archive, { requestId, targetStoreInstanceId, atMs, backupChecksum: checksum });
      assertDepositInboxPortableControlGrowth(envelope.archive, plan.archive);
      assertDepositInboxPortableCapacity(plan.archive, "restore");
      return { prepared: { envelope, plan, requestId, checksum, targetStoreInstanceId } };
    } catch (error) { return { error }; }
  })();
  try {
    return await withDepositInboxStoreTransaction({ mode: "simulation-only", store, freshTarget: "restore",
      ...("prepared" in captured && captured.prepared ? { expectedStoreInstanceId: captured.prepared.targetStoreInstanceId } : {}) }, async owner => {
      if (!("prepared" in captured) || !captured.prepared) throw captured.error;
      const { envelope, plan, requestId, checksum, targetStoreInstanceId } = captured.prepared;
      await installDepositInboxStore(owner, envelope.archive, targetStoreInstanceId);
      await appendDepositInboxStore(owner, plan);
      const recovery = plan.record.effects.recoveryReceipts;
      inboxCheck(recovery.length === 1, "INVALID_EVIDENCE", "Deposit restore must append exactly one complete recovery receipt");
      await completeDepositInboxRestore(owner, recovery[0]);
      const restored = await loadDepositInboxStore(owner);
      inboxCheck(restored.commands.length === envelope.archive.commands.length + 1
        && same(restored.commands.slice(0, -1), envelope.archive.commands)
        && same(restored.evidenceBlobs, envelope.archive.evidenceBlobs) && same(restored.bootstrap, envelope.archive.bootstrap)
        && same(restored.checkpoint, plan.nextCheckpoint) && same(restored.projections, plan.nextState),
      "REPLAY_MISMATCH", "Deposit restore did not preserve every original receipt and exact evidence blob");
      inboxRuntime("simulation-only");
      return restorationResult(restored, requestId, checksum);
    });
  } catch (error) {
    if (error !== null && typeof error === "object" && !types.isProxy(error)
      && Object.getPrototypeOf(error) === CommitOutcomeUnknownError.prototype) {
      const unknown = new CommitOutcomeUnknownError(new Error("Development deposit recovery acknowledgment is unavailable"));
      if ("prepared" in captured && captured.prepared) Object.assign(unknown, { mode: "simulation-only", creditAuthority: false,
        requestId: captured.prepared.requestId, backupChecksum: captured.prepared.checksum,
        targetStoreInstanceId: captured.prepared.targetStoreInstanceId });
      throw unknown;
    }
    throw depositInboxError(error, "INVALID_EVIDENCE");
  }
}
