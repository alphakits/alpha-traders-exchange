import "server-only";

import { z } from "zod";
import { walletDigest } from "./commands";
import { captureInboxData } from "./deposit-inbox-data";
import { assertSimulationRuntime } from "./runtime";
import { captureTrustedPaymentManifest, preparedTrustedPaymentEvidenceSchema, verifyPreparedTrustedPaymentEvidence,
  type PreparedTrustedPaymentEvidenceV1, type TrustedPaymentManifestV1, type TrustedPaymentObservationStatus } from "./trusted-payment-evidence";

/** Retention and consistency only: this journal cannot verify a live payment, consume credit, or release escrow. */
export const TRUSTED_PAYMENT_JOURNAL_FORMAT = "development-trusted-payment-journal" as const;
export const MAX_TRUSTED_PAYMENT_JOURNAL_RECORDS = 128;
export const MAX_TRUSTED_PAYMENT_JOURNAL_BYTES = 32 * 1_048_576;
const ZERO_HASH = "0".repeat(64);
// Only internally produced, deeply frozen archives enter this cache. Deserialized
// storage/backup data always replays; no caller-supplied digest can populate it.
const verifiedArchives = new WeakSet<object>();
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.number().int().min(1).max(8_640_000_000_000_000).refine(value => !Object.is(value, -0));
const sequence = z.number().int().min(0).max(MAX_TRUSTED_PAYMENT_JOURNAL_RECORDS);
const status = z.enum(["recording", "paused", "quarantined"]);
const checkpointSchema = z.strictObject({ revision: sequence, eventHash: hex, stateHash: hex, lastCommandAtMs: instant });
export type TrustedPaymentJournalCheckpoint = z.infer<typeof checkpointSchema>;
const recordCommandSchema = z.strictObject({ type: z.literal("record"), operationId: id, prepared: preparedTrustedPaymentEvidenceSchema });
const pauseCommandSchema = z.strictObject({ type: z.literal("pause"), operationId: id,
  reasonCode: z.enum(["manual-review", "source-unavailable", "maintenance"]) });
const restoreCommandSchema = z.strictObject({ type: z.literal("quarantine-restore"), operationId: id,
  backupSha256: hex, sourceArchiveSha256: hex, sourceCheckpoint: checkpointSchema, targetStoreId: id, exportedAtMs: instant });
const commandSchema = z.discriminatedUnion("type", [recordCommandSchema, pauseCommandSchema, restoreCommandSchema]);
const publicCommandSchema = z.discriminatedUnion("type", [recordCommandSchema, pauseCommandSchema]);
export type TrustedPaymentJournalCommand = z.infer<typeof commandSchema>;
export type TrustedPaymentJournalPublicCommand = z.infer<typeof publicCommandSchema>;
const receiptSchema = z.strictObject({ operationId: id, inputHash: hex, revision: sequence.refine(value => value > 0),
  eventHash: hex, stateHash: hex, disposition: z.enum(["recorded", "corroborated", "stale-corroboration", "paused", "restored-quarantined",
    "operation-conflict-quarantined", "payment-conflict-quarantined", "revision-conflict-quarantined", "revision-gap-quarantined",
    "source-reversal-quarantined", "source-revocation-quarantined", "source-rejection-quarantined", "status-regression-quarantined"]),
  status, executionAuthority: z.literal(false), releaseAuthority: z.literal(false) });
export type TrustedPaymentJournalReceipt = z.infer<typeof receiptSchema>;
export type TrustedPaymentJournalDisposition = TrustedPaymentJournalReceipt["disposition"];
const recordSchema = z.strictObject({ revision: sequence.refine(value => value > 0), operationId: id, inputHash: hex,
  command: commandSchema, occurredAtMs: instant, previousEventHash: hex, eventHash: hex, stateHash: hex, receipt: receiptSchema });
export type TrustedPaymentJournalRecord = z.infer<typeof recordSchema>;
type PaymentRevision = { revision: number; observationSha256: string; status: TrustedPaymentObservationStatus; observedAtMs: number;
  settledAtMs: number | null; firstJournalRevision: number };
export type TrustedPaymentJournalPayment = {
  nativePaymentKey: string; paymentFactsSha256: string; platformRequestId: string; claimKey: string;
  sourceId: string; transactionId: string; firstJournalRevision: number; latestSourceRevision: number;
  revisions: PaymentRevision[];
};
export type TrustedPaymentJournalState = {
  status: "recording" | "paused" | "quarantined"; haltReason: string | null; restoredTargetStoreId: string | null;
  executionAuthority: false; releaseAuthority: false; payments: TrustedPaymentJournalPayment[];
};
export type TrustedPaymentJournalBootstrap = {
  sourceStoreId: string; manifest: TrustedPaymentManifestV1; manifestSha256: string; createdAtMs: number;
};
export type TrustedPaymentJournalArchive = {
  kind: typeof TRUSTED_PAYMENT_JOURNAL_FORMAT; formatVersion: 1; mode: "simulation-only";
  bootstrap: TrustedPaymentJournalBootstrap; records: TrustedPaymentJournalRecord[];
  checkpoint: TrustedPaymentJournalCheckpoint; state: TrustedPaymentJournalState; archiveSha256: string;
};
export type TrustedPaymentJournalBackup = {
  kind: "development-trusted-payment-journal-backup"; formatVersion: 1; mode: "simulation-only";
  sourceStopped: true; exportedAtMs: number; archive: TrustedPaymentJournalArchive; backupSha256: string;
};

export class TrustedPaymentJournalError extends Error {
  readonly executionAuthority = false;
  readonly releaseAuthority = false;
  constructor(readonly code: "INVALID_INPUT" | "INTEGRITY" | "STOPPED" | "RESOURCE_LIMIT" | "RUNTIME_REFUSED", message: string) {
    super(message); this.name = "TrustedPaymentJournalError";
  }
}
function check(value: unknown, code: TrustedPaymentJournalError["code"], message: string): asserts value {
  if (!value) throw new TrustedPaymentJournalError(code, message);
}
function runtime(mode: unknown = "simulation-only") {
  try { assertSimulationRuntime(typeof mode === "string" ? mode : undefined); }
  catch { throw new TrustedPaymentJournalError("RUNTIME_REFUSED", "Fiat journal requires the explicit local simulation-only runtime"); }
}
function capture<T>(value: unknown): T {
  try { return captureInboxData<T>(value, { maxBytes: MAX_TRUSTED_PAYMENT_JOURNAL_BYTES, maxNodes: 100_000, maxDepth: 64 }); }
  catch { throw new TrustedPaymentJournalError("INVALID_INPUT", "Fiat journal requires bounded inert JSON data"); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(capture(value));
  check(result.success, "INVALID_INPUT", "Fiat journal data does not match its closed contract");
  return capture<T>(result.data);
}
function equal(left: unknown, right: unknown) { return walletDigest(left) === walletDigest(right); }
function sealed(bootstrap: TrustedPaymentJournalBootstrap, records: TrustedPaymentJournalRecord[], state: TrustedPaymentJournalState): TrustedPaymentJournalArchive {
  const last = records.at(-1);
  const checkpoint = { revision: records.length, eventHash: last?.eventHash ?? ZERO_HASH,
    stateHash: walletDigest(state), lastCommandAtMs: last?.occurredAtMs ?? bootstrap.createdAtMs };
  const body = { kind: TRUSTED_PAYMENT_JOURNAL_FORMAT, formatVersion: 1 as const, mode: "simulation-only" as const,
    bootstrap, records, checkpoint, state };
  const archive = capture<TrustedPaymentJournalArchive>({ ...body, archiveSha256: walletDigest(body) });
  verifiedArchives.add(archive);
  return archive;
}
function emptyState(): TrustedPaymentJournalState {
  return { status: "recording", haltReason: null, restoredTargetStoreId: null, executionAuthority: false, releaseAuthority: false, payments: [] };
}
const bootstrapSchema = z.strictObject({ sourceStoreId: id, manifest: z.unknown(), manifestSha256: hex, createdAtMs: instant });
function bootstrapOf(value: unknown): TrustedPaymentJournalBootstrap {
  const parsed = parse(bootstrapSchema, value), admission = captureTrustedPaymentManifest(parsed.manifest);
  check(parsed.manifestSha256 === admission.manifestSha256, "INTEGRITY", "Fiat journal admission digest changed");
  return capture({ ...parsed, manifest: admission.manifest });
}

export function createTrustedPaymentJournalArchive(value: {
  mode: "simulation-only"; manifest: unknown; sourceStoreId: string; atMs: number;
}): TrustedPaymentJournalArchive {
  runtime();
  const input = parse(z.strictObject({ mode: z.literal("simulation-only"), manifest: z.unknown(), sourceStoreId: id, atMs: instant }), value);
  runtime(input.mode);
  const admission = captureTrustedPaymentManifest(input.manifest);
  return sealed({ sourceStoreId: input.sourceStoreId, ...admission, createdAtMs: input.atMs }, [], emptyState());
}

/** Stable exact operation identity; historical receipts are evidence, never current eligibility. */
export function trustedPaymentJournalCommandDigest(value: unknown): string {
  runtime(); return walletDigest(parse(publicCommandSchema, value));
}
export function findTrustedPaymentJournalReceipt(value: unknown, query: { operationId: string; inputHash: string }): TrustedPaymentJournalReceipt | null {
  runtime();
  const input = parse(z.strictObject({ operationId: id, inputHash: hex }), query);
  const archive = verifyTrustedPaymentJournalArchive(value);
  const found = archive.records.find(row => row.operationId === input.operationId && row.inputHash === input.inputHash);
  return found ? capture(found.receipt) : null;
}

function revisionOf(prepared: PreparedTrustedPaymentEvidenceV1, journalRevision: number): PaymentRevision {
  return { revision: prepared.observation.revision, observationSha256: prepared.observationSha256,
    status: prepared.observation.status, observedAtMs: prepared.observation.observedAtMs,
    settledAtMs: prepared.observation.settledAtMs, firstJournalRevision: journalRevision };
}
function applyRecord(state: TrustedPaymentJournalState, prepared: PreparedTrustedPaymentEvidenceV1, journalRevision: number): TrustedPaymentJournalDisposition {
  const original = state.payments.find(row => row.nativePaymentKey === prepared.nativePaymentKey);
  const incoming = revisionOf(prepared, journalRevision);
  if (original) {
    if (original.paymentFactsSha256 !== prepared.paymentFactsSha256) return "payment-conflict-quarantined";
    const known = original.revisions.find(row => row.revision === incoming.revision);
    if (known) {
      if (known.observationSha256 !== incoming.observationSha256) return "revision-conflict-quarantined";
      return incoming.revision === original.latestSourceRevision ? "corroborated" : "stale-corroboration";
    }
    if (incoming.revision !== original.latestSourceRevision + 1) return "revision-gap-quarantined";
    const previous = original.revisions.at(-1)!;
    if (incoming.observedAtMs < previous.observedAtMs || (previous.settledAtMs !== null && incoming.settledAtMs !== previous.settledAtMs)
      || (previous.status === "settled" && incoming.status === "pending")) return "status-regression-quarantined";
    original.revisions.push(incoming); original.latestSourceRevision = incoming.revision;
  } else {
    // A first observation beginning halfway through a source history cannot establish that no revocation was skipped.
    if (incoming.revision !== 1) return "revision-gap-quarantined";
    state.payments.push({ nativePaymentKey: prepared.nativePaymentKey, paymentFactsSha256: prepared.paymentFactsSha256,
      platformRequestId: prepared.walletContext.platformRequestId, claimKey: prepared.walletContext.claimKey,
      sourceId: prepared.sourceId, transactionId: prepared.transactionId, firstJournalRevision: journalRevision,
      latestSourceRevision: incoming.revision, revisions: [incoming] });
  }
  if (incoming.status === "reversed") return "source-reversal-quarantined";
  if (incoming.status === "revoked") return "source-revocation-quarantined";
  if (incoming.status === "rejected") return "source-rejection-quarantined";
  return "recorded";
}

function advance(current: TrustedPaymentJournalArchive, command: TrustedPaymentJournalCommand, atMs: number): { archive: TrustedPaymentJournalArchive; receipt: TrustedPaymentJournalReceipt } {
  check(current.records.length < MAX_TRUSTED_PAYMENT_JOURNAL_RECORDS, "RESOURCE_LIMIT", "Fiat journal development record bound reached");
  if (command.type === "record") check(current.records.length < MAX_TRUSTED_PAYMENT_JOURNAL_RECORDS - 2,
    "RESOURCE_LIMIT", "Fiat journal reserves capacity for stopping and quarantined recovery");
  if (command.type === "pause") check(current.records.length < MAX_TRUSTED_PAYMENT_JOURNAL_RECORDS - 1,
    "RESOURCE_LIMIT", "Fiat journal reserves capacity for quarantined recovery");
  check(instant.safeParse(atMs).success && atMs >= current.checkpoint.lastCommandAtMs, "INVALID_INPUT", "Fiat journal clock moved backwards");
  const revision = current.records.length + 1, inputHash = walletDigest(command);
  check(!current.records.some(row => row.operationId === command.operationId && row.inputHash === inputHash),
    "INTEGRITY", "Fiat journal appended an exact operation twice");
  const state = structuredClone(current.state);
  let disposition: TrustedPaymentJournalDisposition;
  if (command.type === "quarantine-restore") {
    check(state.status !== "recording" && state.restoredTargetStoreId === null
      && command.targetStoreId !== current.bootstrap.sourceStoreId
      && equal(command.sourceCheckpoint, current.checkpoint) && command.sourceArchiveSha256 === current.archiveSha256
      && command.exportedAtMs >= current.checkpoint.lastCommandAtMs && atMs >= command.exportedAtMs,
    "INTEGRITY", "Fiat restoration must retain one exact stopped source in a distinct permanently quarantined target");
    const body = { kind: "development-trusted-payment-journal-backup", formatVersion: 1, mode: "simulation-only", sourceStopped: true,
      exportedAtMs: command.exportedAtMs, archive: current };
    check(walletDigest(body) === command.backupSha256, "INTEGRITY", "Fiat restore backup checksum disagrees with the retained original history");
    check(!current.records.some(row => row.operationId === command.operationId), "INVALID_INPUT", "Fiat restore operation identity collides with source history");
    state.status = "quarantined"; state.haltReason = "restored-copy"; state.restoredTargetStoreId = command.targetStoreId;
    disposition = "restored-quarantined";
  } else {
    // Exact historical receipt recovery is handled before this new-command fence.
    check(state.status === "recording" && state.restoredTargetStoreId === null, "STOPPED", "A stopped fiat journal cannot accept new commands or resume");
    if (command.type === "record") {
      const prepared = verifyPreparedTrustedPaymentEvidence({ mode: "simulation-only", manifest: current.bootstrap.manifest, prepared: command.prepared });
      check(atMs >= prepared.preparedAtMs, "INVALID_INPUT", "Fiat journal cannot record evidence from its future");
      // Store negative/stale evidence too. No cached eligibility is returned as authority at a later clock.
      disposition = current.records.some(row => row.operationId === command.operationId) ? "operation-conflict-quarantined"
        : applyRecord(state, prepared, revision);
    } else {
      disposition = current.records.some(row => row.operationId === command.operationId) ? "operation-conflict-quarantined" : "paused";
      if (disposition === "paused") { state.status = "paused"; state.haltReason = command.reasonCode; }
    }
    if (disposition.endsWith("-quarantined")) { state.status = "quarantined"; state.haltReason = disposition; }
  }
  const stateHash = walletDigest(state), previousEventHash = current.checkpoint.eventHash;
  const eventHash = walletDigest({ revision, operationId: command.operationId, inputHash, occurredAtMs: atMs,
    previousEventHash, stateHash, disposition, status: state.status });
  const receipt: TrustedPaymentJournalReceipt = { operationId: command.operationId, inputHash, revision, eventHash, stateHash,
    disposition, status: state.status, executionAuthority: false, releaseAuthority: false };
  const record: TrustedPaymentJournalRecord = { revision, operationId: command.operationId, inputHash, command, occurredAtMs: atMs,
    previousEventHash, eventHash, stateHash, receipt };
  const archive = sealed(current.bootstrap, [...current.records, record], state);
  if (command.type === "record") {
    // Bounded record growth must leave bytes/nodes for a stop, backup envelope and restore receipt.
    try { captureInboxData(archive, { maxBytes: MAX_TRUSTED_PAYMENT_JOURNAL_BYTES - 1_048_576, maxNodes: 90_000, maxDepth: 60 }); }
    catch { throw new TrustedPaymentJournalError("RESOURCE_LIMIT", "Fiat evidence leaves insufficient terminal and recovery capacity"); }
  }
  return { archive, receipt: capture(receipt) };
}

const archiveSchema = z.strictObject({ kind: z.literal(TRUSTED_PAYMENT_JOURNAL_FORMAT), formatVersion: z.literal(1), mode: z.literal("simulation-only"),
  bootstrap: bootstrapSchema, records: z.array(recordSchema).max(MAX_TRUSTED_PAYMENT_JOURNAL_RECORDS), checkpoint: checkpointSchema,
  state: z.unknown(), archiveSha256: hex });
/** Replays immutable commands and all archived V5 fiat evidence; checksums alone confer no source authenticity. */
export function verifyTrustedPaymentJournalArchive(value: unknown): TrustedPaymentJournalArchive {
  runtime();
  if (value !== null && typeof value === "object" && verifiedArchives.has(value)) return value as TrustedPaymentJournalArchive;
  const parsed = parse(archiveSchema, value), bootstrap = bootstrapOf(parsed.bootstrap);
  let current = sealed(bootstrap, [], emptyState());
  for (const row of parsed.records) {
    const next = advance(current, row.command, row.occurredAtMs);
    check(equal(next.archive.records.at(-1), row), "INTEGRITY", "Fiat journal record does not reproduce its original result and chain");
    current = next.archive;
  }
  check(equal(current, parsed), "INTEGRITY", "Fiat journal head, projection, admission or archive digest changed");
  runtime(); return current;
}
export function appendTrustedPaymentJournal(value: unknown, supplied: unknown, atMs: number): {
  archive: TrustedPaymentJournalArchive; receipt: TrustedPaymentJournalReceipt; replayed: boolean;
} {
  runtime(); const archive = verifyTrustedPaymentJournalArchive(value), command = parse(publicCommandSchema, supplied);
  const receipt = findTrustedPaymentJournalReceipt(archive, { operationId: command.operationId, inputHash: walletDigest(command) });
  if (receipt) return { archive, receipt, replayed: true };
  const appended = advance(archive, command, atMs); runtime(); return { ...appended, replayed: false };
}

const backupSchema = z.strictObject({ kind: z.literal("development-trusted-payment-journal-backup"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), sourceStopped: z.literal(true), exportedAtMs: instant, archive: z.unknown(), backupSha256: hex });
export function createTrustedPaymentJournalBackup(value: unknown, exportedAtMs: number): TrustedPaymentJournalBackup {
  runtime(); const archive = verifyTrustedPaymentJournalArchive(value);
  check(archive.state.status !== "recording" && archive.state.restoredTargetStoreId === null, "STOPPED", "Fiat backup requires the stopped original source");
  check(instant.safeParse(exportedAtMs).success && exportedAtMs >= archive.checkpoint.lastCommandAtMs,
    "INVALID_INPUT", "Fiat backup clock precedes retained evidence");
  const body = { kind: "development-trusted-payment-journal-backup" as const, formatVersion: 1 as const, mode: "simulation-only" as const,
    sourceStopped: true as const, exportedAtMs, archive };
  return capture({ ...body, backupSha256: walletDigest(body) });
}
export function verifyTrustedPaymentJournalBackup(value: unknown): TrustedPaymentJournalBackup {
  runtime(); const parsed = parse(backupSchema, value);
  const expected = createTrustedPaymentJournalBackup(parsed.archive, parsed.exportedAtMs);
  check(equal(parsed, expected), "INTEGRITY", "Fiat backup checksum or original stopped history changed");
  return expected;
}
/** Historical consistency only. The storage owner must certify a physically fresh target and fence the stopped source. */
export function restoreTrustedPaymentJournalArchive(value: {
  backup: unknown; operationId: string; targetStoreId: string; atMs: number;
}): TrustedPaymentJournalArchive {
  runtime(); const input = parse(z.strictObject({ backup: z.unknown(), operationId: id, targetStoreId: id, atMs: instant }), value);
  const backup = verifyTrustedPaymentJournalBackup(input.backup);
  const command = parse(restoreCommandSchema, { type: "quarantine-restore", operationId: input.operationId,
    backupSha256: backup.backupSha256, sourceArchiveSha256: backup.archive.archiveSha256, sourceCheckpoint: backup.archive.checkpoint,
    targetStoreId: input.targetStoreId, exportedAtMs: backup.exportedAtMs });
  return advance(backup.archive, command, input.atMs).archive;
}
