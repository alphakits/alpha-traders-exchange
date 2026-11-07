import "server-only";

import { z } from "zod";
import { walletDigest } from "./commands";
import { captureInboxData } from "./deposit-inbox-data";
import { balance } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import { captureTrustedPaymentManifest, preparedTrustedPaymentEvidenceSchema, verifyPreparedTrustedPaymentEvidence,
  type PreparedTrustedPaymentEvidenceV1, type TrustedPaymentManifestV1 } from "./trusted-payment-evidence";
import { appendTrustedPaymentJournal, createTrustedPaymentJournalArchive, type TrustedPaymentJournalArchive,
  type TrustedPaymentJournalCheckpoint, type TrustedPaymentJournalDisposition, type TrustedPaymentJournalState } from "./trusted-payment-journal-model";
import { v5PaymentClaimKey } from "./v5-commands";
import { verifyV5History } from "./v5-durable";
import { isV5State } from "./v5-engine";

/** Revocable preparation only. No result from this model authorizes a ledger transition, payment or payout. */
export const RELEASE_CONSENT_FORMAT = "development-release-consent-overlay" as const;
export const MAX_RELEASE_CONSENT_RECORDS = 128;
export const MAX_RELEASE_CONSENT_BYTES = 32 * 1_048_576;
const ZERO_HASH = "0".repeat(64);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).refine(value => !["constructor", "prototype", "__proto__"].includes(value));
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.number().int().min(1).max(8_640_000_000_000_000).refine(value => !Object.is(value, -0));
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const sequence = z.number().int().min(0).max(MAX_RELEASE_CONSENT_RECORDS);
const statusSchema = z.enum(["recording", "paused", "quarantined"]);
const walletCheckpointSchema = z.strictObject({ revision: positive, eventHash: hex, stateHash: hex, lastCommandAtMs: instant });
const checkpointSchema = z.strictObject({ revision: sequence, eventHash: hex, stateHash: hex, lastCommandAtMs: instant });
export type ReleaseConsentCheckpoint = z.infer<typeof checkpointSchema>;

/** The coordinator must derive the canonical digest from its locked physical rows, including the seller account. */
export const releaseConsentCurrentBasisSchema = z.strictObject({
  walletCheckpoint: walletCheckpointSchema, walletTradeSha256: hex, walletPaused: z.boolean(), walletDisputed: z.boolean(),
  canonicalBasisSha256: hex,
});
export type ReleaseConsentCurrentBasis = z.infer<typeof releaseConsentCurrentBasisSchema>;

const observeSchema = z.strictObject({ type: z.literal("observe"), operationId: id, actorUserId: id,
  prepared: preparedTrustedPaymentEvidenceSchema });
const consentSchema = z.strictObject({ type: z.literal("consent"), operationId: id, actorUserId: id,
  reviewedBasisSha256: hex, sessionExpiresAtMs: instant });
const revokeSchema = z.strictObject({ type: z.literal("revoke"), operationId: id, actorUserId: id, consentOperationId: id });
const pauseSchema = z.strictObject({ type: z.literal("pause"), operationId: id, actorUserId: id,
  reasonCode: z.enum(["manual-review", "source-unavailable", "maintenance"]) });
const enrollSchema = z.strictObject({ type: z.literal("enroll"), operationId: id, actorUserId: id, enrollmentSha256: hex });
const restoreSchema = z.strictObject({ type: z.literal("quarantine-restore"), operationId: id,
  backupSha256: hex, sourceArchiveSha256: hex, sourceCheckpoint: checkpointSchema, targetStoreId: id, exportedAtMs: instant });
export const releaseConsentPublicCommandSchema = z.discriminatedUnion("type", [observeSchema, consentSchema, revokeSchema, pauseSchema]);
const commandSchema = z.discriminatedUnion("type", [observeSchema, consentSchema, revokeSchema, pauseSchema, enrollSchema, restoreSchema]);
export type ReleaseConsentPublicCommand = z.infer<typeof releaseConsentPublicCommandSchema>;
export type ReleaseConsentCommand = z.infer<typeof commandSchema>;
export type ReleaseConsentDisposition = TrustedPaymentJournalDisposition | "enrolled" | "consented" | "consent-revoked" | "consent-already-revoked";
const dispositionSchema = z.enum(["enrolled", "consented", "consent-revoked", "consent-already-revoked", "recorded", "corroborated", "stale-corroboration",
  "paused", "restored-quarantined", "operation-conflict-quarantined", "payment-conflict-quarantined", "revision-conflict-quarantined",
  "revision-gap-quarantined", "source-reversal-quarantined", "source-revocation-quarantined", "source-rejection-quarantined", "status-regression-quarantined"]);
const receiptSchema = z.strictObject({ operationId: id, inputHash: hex, revision: sequence.refine(value => value > 0),
  eventHash: hex, stateHash: hex, commandType: z.enum(["enroll", "observe", "consent", "revoke", "pause", "quarantine-restore"]),
  actorUserId: id.nullable(), disposition: dispositionSchema, status: statusSchema,
  executionAuthority: z.literal(false), releaseAuthority: z.literal(false) });
export type ReleaseConsentReceipt = z.infer<typeof receiptSchema>;
const recordSchema = z.strictObject({ revision: sequence.refine(value => value > 0), operationId: id, inputHash: hex,
  command: commandSchema, currentBasis: releaseConsentCurrentBasisSchema, occurredAtMs: instant, previousEventHash: hex,
  eventHash: hex, stateHash: hex, receipt: receiptSchema });
export type ReleaseConsentRecord = z.infer<typeof recordSchema>;
export type ReleaseConsent = {
  operationId: string; sellerId: string; reviewedBasisSha256: string; currentBasis: ReleaseConsentCurrentBasis;
  nativePaymentKey: string; sourceRevision: number; observationSha256: string;
  consentedAtMs: number; expiresAtMs: number; revokedByOperationId: string | null;
};
export type ReleaseConsentState = {
  status: "recording" | "paused" | "quarantined"; haltReason: string | null; restoredTargetStoreId: string | null;
  executionAuthority: false; releaseAuthority: false;
  source: TrustedPaymentJournalState; sourceCheckpoint: TrustedPaymentJournalCheckpoint; latestPreparationSha256: string;
  consents: ReleaseConsent[]; activeConsentOperationId: string | null;
};
export type ReleaseConsentBootstrap = {
  sourceStoreId: string; manifest: TrustedPaymentManifestV1; manifestSha256: string; enrollingOwnerId: string;
  enrollmentOperationId: string; createdAtMs: number; initialPrepared: PreparedTrustedPaymentEvidenceV1; initialBasis: ReleaseConsentCurrentBasis;
};
export type ReleaseConsentArchive = {
  kind: typeof RELEASE_CONSENT_FORMAT; formatVersion: 1; mode: "simulation-only"; bootstrap: ReleaseConsentBootstrap;
  records: ReleaseConsentRecord[]; checkpoint: ReleaseConsentCheckpoint; state: ReleaseConsentState; archiveSha256: string;
};
export type ReleaseConsentBackup = {
  kind: "development-release-consent-overlay-backup"; formatVersion: 1; mode: "simulation-only";
  sourceStopped: true; exportedAtMs: number; archive: ReleaseConsentArchive; backupSha256: string;
};
export type ReleaseConsentReviewedBasis = {
  kind: "development-release-consent-reviewed-basis"; formatVersion: 1; mode: "simulation-only";
  sourceStoreId: string; manifestSha256: string; platformRequestId: string; platformTradeId: string;
  sellerId: string; buyerId: string; assetId: string; principalRaw: string; amountMinor: string; currency: "ILS";
  paymentMethod: string; paymentInstructionsDigest: string; destinationSha256: string; termsDigest: string;
  acceptanceKey: string; acceptanceReceiptSha256: string; claimKey: string; claimReceiptSha256: string;
  nativePaymentKey: string; paymentFactsSha256: string; sourceId: string; transactionId: string; sourceRevision: number;
  observationSha256: string; currentBasis: ReleaseConsentCurrentBasis; sourceValidUntilMs: number;
  executionAuthority: false; releaseAuthority: false;
};
export type ReleaseConsentInspection = {
  status: ReleaseConsentState["status"]; currentPreconditionsMatch: boolean; canConsent: boolean;
  reviewedBasisSha256: string | null; reviewedBasis: ReleaseConsentReviewedBasis | null; activeConsent: ReleaseConsent | null;
  validUntilMs: number | null; reasons: string[]; executionAuthority: false; releaseAuthority: false;
};

export class ReleaseConsentError extends Error {
  readonly executionAuthority = false;
  readonly releaseAuthority = false;
  constructor(readonly code: "INVALID_INPUT" | "INTEGRITY" | "STOPPED" | "RESOURCE_LIMIT" | "RUNTIME_REFUSED"
    | "BINDING_MISMATCH" | "STALE_BASIS" | "ACTOR_REFUSED", message: string) {
    super(message); this.name = "ReleaseConsentError";
  }
}
function check(value: unknown, code: ReleaseConsentError["code"], message: string): asserts value {
  if (!value) throw new ReleaseConsentError(code, message);
}
function runtime(mode: unknown = "simulation-only") {
  try { assertSimulationRuntime(typeof mode === "string" ? mode : undefined); }
  catch { throw new ReleaseConsentError("RUNTIME_REFUSED", "Release consent requires the explicit local simulation-only runtime"); }
}
function capture<T>(value: unknown, code: "INVALID_INPUT" | "RESOURCE_LIMIT" = "INVALID_INPUT"): T {
  try { return captureInboxData<T>(value, { maxBytes: MAX_RELEASE_CONSENT_BYTES, maxNodes: 100_000, maxDepth: 64 }); }
  catch { throw new ReleaseConsentError(code, "Release consent requires bounded inert JSON data"); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(capture(value));
  check(result.success, "INVALID_INPUT", "Release consent data does not match its closed contract");
  return capture<T>(result.data);
}
function equal(left: unknown, right: unknown) { return walletDigest(left) === walletDigest(right); }
type Derived = { sourceJournal: TrustedPaymentJournalArchive; latestPrepared: PreparedTrustedPaymentEvidenceV1 };
// Only internally reproduced, deeply frozen archives populate this cache. Deserialized data always replays.
const verifiedArchives = new WeakMap<object, Derived>();
function sealed(bootstrap: ReleaseConsentBootstrap, records: ReleaseConsentRecord[], state: ReleaseConsentState, derived: Derived): ReleaseConsentArchive {
  const last = records.at(-1);
  const checkpoint = { revision: records.length, eventHash: last?.eventHash ?? ZERO_HASH,
    stateHash: walletDigest(state), lastCommandAtMs: last?.occurredAtMs ?? bootstrap.createdAtMs };
  const body = { kind: RELEASE_CONSENT_FORMAT, formatVersion: 1 as const, mode: "simulation-only" as const, bootstrap, records, checkpoint, state };
  const archive = capture<ReleaseConsentArchive>({ ...body, archiveSha256: walletDigest(body) }, "RESOURCE_LIMIT");
  verifiedArchives.set(archive, derived); return archive;
}
function basisForPrepared(prepared: PreparedTrustedPaymentEvidenceV1, canonicalBasisSha256: string): ReleaseConsentCurrentBasis {
  return { walletCheckpoint: prepared.walletContext.checkpoint, walletTradeSha256: prepared.walletContext.walletTradeSha256,
    walletPaused: prepared.walletContext.paused, walletDisputed: prepared.walletContext.disputed, canonicalBasisSha256 };
}
function requirePreparedBasis(prepared: PreparedTrustedPaymentEvidenceV1, currentBasis: ReleaseConsentCurrentBasis) {
  check(equal(currentBasis, basisForPrepared(prepared, currentBasis.canonicalBasisSha256)), "STALE_BASIS",
    "Source preparation must match the actual current V5 checkpoint and trade state");
}
function independentActor(bootstrap: ReleaseConsentBootstrap, actorUserId: string) {
  check(!bootstrap.manifest.sources.some(source => source.authorityId === actorUserId), "ACTOR_REFUSED",
    "An admitted source authority cannot act as a platform participant in this consent overlay");
}

/** The history is replayed, never replaced with a body-supplied wallet snapshot or eligibility flag. */
export function releaseConsentCurrentBasisFromHistory(value: {
  requestId: string; walletHistory: unknown; canonicalBasisSha256: string;
}): ReleaseConsentCurrentBasis {
  runtime();
  const input = parse(z.strictObject({ requestId: id, walletHistory: preparedTrustedPaymentEvidenceSchema.shape.walletHistory,
    canonicalBasisSha256: hex }), value);
  const snapshot = verifyV5History(input.walletHistory);
  check(isV5State(snapshot.state), "BINDING_MISMATCH", "Release consent requires the retained V5 buyer-claim profile");
  const state = snapshot.state, binding = state.initialBindings.get(input.requestId);
  check(binding, "BINDING_MISMATCH", "Release consent requires an existing original reservation");
  const accepted = state.initialAcceptanceReceipts.get(binding.acceptanceKey);
  const claim = state.initialPaymentClaimReceipts.get(v5PaymentClaimKey(input.requestId, binding.acceptanceKey));
  const trade = state.trades.get(binding.walletTradeId);
  check(accepted && claim && trade && trade.status === "payment_reported" && !trade.evidence && !trade.authorization && !trade.payoutId
    && balance(state, binding.assetId, `trade:${trade.id}`).toString() === binding.terms.principalRaw,
  "BINDING_MISMATCH", "Release consent requires the original unverified claim and full principal reservation");
  const result = parse(releaseConsentCurrentBasisSchema, {
    walletCheckpoint: { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(state), lastCommandAtMs: snapshot.lastCommandAtMs },
    walletTradeSha256: walletDigest(trade), walletPaused: state.haltReason !== null, walletDisputed: trade.disputed,
    canonicalBasisSha256: input.canonicalBasisSha256,
  });
  runtime(); return result;
}

const bootstrapSchema = z.strictObject({ sourceStoreId: id, manifest: z.unknown(), manifestSha256: hex, enrollingOwnerId: id,
  enrollmentOperationId: id, createdAtMs: instant, initialPrepared: preparedTrustedPaymentEvidenceSchema, initialBasis: releaseConsentCurrentBasisSchema });
function bootstrapOf(value: unknown): ReleaseConsentBootstrap {
  const input = parse(bootstrapSchema, value), admission = captureTrustedPaymentManifest(input.manifest);
  check(input.manifestSha256 === admission.manifestSha256, "INTEGRITY", "Release consent admission digest changed");
  const initialPrepared = verifyPreparedTrustedPaymentEvidence({ mode: "simulation-only", manifest: admission.manifest, prepared: input.initialPrepared });
  const bootstrap = capture<ReleaseConsentBootstrap>({ ...input, ...admission, initialPrepared });
  independentActor(bootstrap, bootstrap.enrollingOwnerId); requirePreparedBasis(initialPrepared, bootstrap.initialBasis);
  check(!bootstrap.initialBasis.walletPaused && !bootstrap.initialBasis.walletDisputed, "BINDING_MISMATCH",
    "Enrollment requires an unpaused and undisputed original V5 claim");
  check(bootstrap.createdAtMs >= initialPrepared.preparedAtMs, "INVALID_INPUT", "Enrollment cannot precede its source preparation");
  return bootstrap;
}
function initialArchive(bootstrap: ReleaseConsentBootstrap): ReleaseConsentArchive {
  const sourceJournal = createTrustedPaymentJournalArchive({ mode: "simulation-only", manifest: bootstrap.manifest,
    sourceStoreId: bootstrap.sourceStoreId, atMs: bootstrap.createdAtMs });
  const state: ReleaseConsentState = { status: "recording", haltReason: null, restoredTargetStoreId: null,
    executionAuthority: false, releaseAuthority: false, source: sourceJournal.state, sourceCheckpoint: sourceJournal.checkpoint,
    latestPreparationSha256: bootstrap.initialPrepared.preparationSha256, consents: [], activeConsentOperationId: null };
  return sealed(bootstrap, [], state, { sourceJournal, latestPrepared: bootstrap.initialPrepared });
}
function enrollmentCommand(bootstrap: ReleaseConsentBootstrap): ReleaseConsentCommand {
  return { type: "enroll", operationId: bootstrap.enrollmentOperationId, actorUserId: bootstrap.enrollingOwnerId,
    enrollmentSha256: walletDigest(["alpha-wallet-release-consent-enrollment-v1", bootstrap]) };
}
function reviewBasis(archive: ReleaseConsentArchive, currentBasis: ReleaseConsentCurrentBasis): ReleaseConsentReviewedBasis {
  const derived = verifiedArchives.get(archive)!;
  const original = archive.bootstrap.initialPrepared, context = original.walletContext, prepared = derived.latestPrepared;
  const source = archive.bootstrap.manifest.sources.find(item => item.sourceId === original.sourceId)!;
  return {
    kind: "development-release-consent-reviewed-basis", formatVersion: 1, mode: "simulation-only",
    sourceStoreId: archive.bootstrap.sourceStoreId, manifestSha256: archive.bootstrap.manifestSha256,
    platformRequestId: context.platformRequestId, platformTradeId: context.platformTradeId, sellerId: context.sellerId, buyerId: context.buyerId,
    assetId: context.assetId, principalRaw: context.principalRaw, amountMinor: context.amountMinor, currency: context.currency,
    paymentMethod: context.paymentMethod, paymentInstructionsDigest: context.paymentInstructionsDigest, destinationSha256: context.destinationSha256,
    termsDigest: context.termsDigest, acceptanceKey: context.acceptanceKey, acceptanceReceiptSha256: context.acceptanceReceiptSha256,
    claimKey: context.claimKey, claimReceiptSha256: context.claimReceiptSha256, nativePaymentKey: original.nativePaymentKey,
    paymentFactsSha256: original.paymentFactsSha256, sourceId: original.sourceId, transactionId: original.transactionId,
    sourceRevision: prepared.observation.revision, observationSha256: prepared.observationSha256, currentBasis,
    sourceValidUntilMs: Math.min(source.validUntilMs, prepared.observation.observedAtMs + source.maxObservationAgeMs),
    executionAuthority: false, releaseAuthority: false,
  };
}
function inspection(archive: ReleaseConsentArchive, currentBasis: ReleaseConsentCurrentBasis, atMs: number): ReleaseConsentInspection {
  const { latestPrepared } = verifiedArchives.get(archive)!;
  const source = archive.bootstrap.manifest.sources.find(item => item.sourceId === archive.bootstrap.initialPrepared.sourceId)!;
  const state = archive.state, observation = latestPrepared.observation, reasons: string[] = [];
  if (state.status !== "recording") reasons.push(`overlay-${state.status}`);
  if (state.restoredTargetStoreId !== null) reasons.push("restored-copy");
  if (currentBasis.walletPaused) reasons.push("wallet-paused");
  if (currentBasis.walletDisputed) reasons.push("trade-disputed");
  if (!equal(currentBasis, basisForPrepared(latestPrepared, currentBasis.canonicalBasisSha256))) reasons.push("source-wallet-checkpoint-changed");
  if (observation.status !== "settled") reasons.push("source-not-settled");
  if (!source.enabled || atMs < source.validFromMs || atMs >= source.validUntilMs) reasons.push("source-inactive");
  if (atMs < observation.observedAtMs) reasons.push("source-observation-future");
  if (atMs - observation.observedAtMs >= source.maxObservationAgeMs) reasons.push("source-observation-stale");
  const canConsent = reasons.length === 0;
  const reviewedBasis = reviewBasis(archive, currentBasis);
  const reviewedBasisSha256 = walletDigest(["alpha-wallet-release-consent-reviewed-basis-v1", reviewedBasis]);
  const activeConsent = state.consents.find(consent => consent.operationId === state.activeConsentOperationId) ?? null;
  if (!activeConsent) reasons.push("no-seller-consent");
  else {
    if (activeConsent.revokedByOperationId !== null) reasons.push("seller-consent-revoked");
    if (activeConsent.reviewedBasisSha256 !== reviewedBasisSha256) reasons.push("reviewed-basis-changed");
    if (atMs >= activeConsent.expiresAtMs) reasons.push("seller-consent-expired");
  }
  return capture({ status: state.status, currentPreconditionsMatch: canConsent && reasons.length === 0, canConsent,
    reviewedBasisSha256, reviewedBasis, activeConsent, validUntilMs: activeConsent?.expiresAtMs ?? reviewedBasis.sourceValidUntilMs,
    reasons, executionAuthority: false, releaseAuthority: false });
}

function advance(current: ReleaseConsentArchive, command: ReleaseConsentCommand, currentBasis: ReleaseConsentCurrentBasis, atMs: number): {
  archive: ReleaseConsentArchive; receipt: ReleaseConsentReceipt;
} {
  const terminal = command.type === "pause" || command.type === "quarantine-restore";
  check(current.records.length < MAX_RELEASE_CONSENT_RECORDS, "RESOURCE_LIMIT", "Release consent development record bound reached");
  if (!terminal) check(current.records.length < MAX_RELEASE_CONSENT_RECORDS - 2, "RESOURCE_LIMIT", "Release consent reserves stopping and restored quarantine capacity");
  if (command.type === "pause") check(current.records.length < MAX_RELEASE_CONSENT_RECORDS - 1, "RESOURCE_LIMIT", "Release consent reserves restored quarantine capacity");
  check(instant.safeParse(atMs).success && atMs >= current.checkpoint.lastCommandAtMs && atMs >= currentBasis.walletCheckpoint.lastCommandAtMs,
    "INVALID_INPUT", "Release consent clock moved backwards or precedes its current wallet checkpoint");
  const revision = current.records.length + 1, inputHash = walletDigest(command);
  check(current.records.length > 0 || command.type === "enroll", "INTEGRITY", "The original enrollment must precede every consent overlay command");
  check(!current.records.some(row => row.operationId === command.operationId && row.inputHash === inputHash), "INTEGRITY", "Release consent appended an exact operation twice");
  const state = structuredClone(current.state), previous = verifiedArchives.get(current)!;
  let sourceJournal = previous.sourceJournal, latestPrepared = previous.latestPrepared, disposition: ReleaseConsentDisposition;
  if (command.type === "quarantine-restore") {
    check(state.status !== "recording" && state.restoredTargetStoreId === null && command.targetStoreId !== current.bootstrap.sourceStoreId
      && equal(command.sourceCheckpoint, current.checkpoint) && command.sourceArchiveSha256 === current.archiveSha256
      && equal(currentBasis, current.records.at(-1)!.currentBasis) && command.exportedAtMs >= current.checkpoint.lastCommandAtMs && atMs >= command.exportedAtMs,
    "INTEGRITY", "Consent restoration requires one exact stopped original in a distinct permanently quarantined target");
    const body = { kind: "development-release-consent-overlay-backup", formatVersion: 1, mode: "simulation-only", sourceStopped: true,
      exportedAtMs: command.exportedAtMs, archive: current };
    check(walletDigest(body) === command.backupSha256, "INTEGRITY", "Consent restore checksum disagrees with retained source history");
    check(!current.records.some(row => row.operationId === command.operationId), "INVALID_INPUT", "Consent restore operation identity collides with source history");
    state.status = "quarantined"; state.haltReason = "restored-copy"; state.restoredTargetStoreId = command.targetStoreId;
    disposition = "restored-quarantined";
  } else {
    check(state.status === "recording" && state.restoredTargetStoreId === null, "STOPPED", "A stopped release consent overlay cannot accept new commands or resume");
    independentActor(current.bootstrap, command.actorUserId);
    if (command.type === "consent" || command.type === "revoke") check(command.actorUserId === current.bootstrap.initialPrepared.walletContext.sellerId,
      "ACTOR_REFUSED", "Only the exact retained seller may grant or revoke this consent");
    const operationConflict = current.records.some(row => row.operationId === command.operationId);
    if (command.type === "enroll") {
      check(current.records.length === 0 && equal(command, enrollmentCommand(current.bootstrap)) && equal(currentBasis, current.bootstrap.initialBasis)
        && atMs === current.bootstrap.createdAtMs, "INTEGRITY", "Enrollment must be the exact first overlay record");
      const recorded = appendTrustedPaymentJournal(sourceJournal, { type: "record", operationId: command.operationId,
        prepared: current.bootstrap.initialPrepared }, atMs);
      sourceJournal = recorded.archive;
      disposition = recorded.receipt.status === "recording" ? "enrolled" : recorded.receipt.disposition;
    } else if (command.type === "observe") {
      const prepared = verifyPreparedTrustedPaymentEvidence({ mode: "simulation-only", manifest: current.bootstrap.manifest, prepared: command.prepared });
      check(prepared.nativePaymentKey === current.bootstrap.initialPrepared.nativePaymentKey, "BINDING_MISMATCH",
        "This overlay retains exactly one original native payment identity");
      requirePreparedBasis(prepared, currentBasis);
      const recorded = appendTrustedPaymentJournal(sourceJournal, { type: "record", operationId: command.operationId, prepared }, atMs);
      sourceJournal = recorded.archive;
      const retainedHistory = latestPrepared.walletHistory;
      const originalHistory = current.bootstrap.initialPrepared.walletHistory;
      const preservesHistory = prepared.walletHistory.length >= retainedHistory.length
        && equal(prepared.walletHistory.slice(0, retainedHistory.length), retainedHistory)
        && equal(prepared.walletHistory.slice(0, originalHistory.length), originalHistory);
      disposition = operationConflict ? "operation-conflict-quarantined"
        : !preservesHistory ? "payment-conflict-quarantined" : recorded.receipt.disposition;
      if (preservesHistory && (recorded.receipt.disposition === "recorded" || recorded.receipt.disposition === "corroborated")) latestPrepared = prepared;
    } else if (operationConflict) {
      disposition = "operation-conflict-quarantined";
    } else if (command.type === "consent") {
      const reviewed = inspection(current, currentBasis, atMs);
      check(reviewed.canConsent && reviewed.reviewedBasisSha256 === command.reviewedBasisSha256, "STALE_BASIS",
        "Seller consent requires the exact reviewed current V5, canonical and fresh settled source basis");
      check(command.sessionExpiresAtMs > atMs, "ACTOR_REFUSED", "Seller consent cannot outlive an already expired current session");
      const basis = reviewed.reviewedBasis!;
      state.consents.push({ operationId: command.operationId, sellerId: command.actorUserId, reviewedBasisSha256: command.reviewedBasisSha256,
        currentBasis, nativePaymentKey: basis.nativePaymentKey, sourceRevision: basis.sourceRevision, observationSha256: basis.observationSha256,
        consentedAtMs: atMs, expiresAtMs: Math.min(command.sessionExpiresAtMs, basis.sourceValidUntilMs), revokedByOperationId: null });
      state.activeConsentOperationId = command.operationId; disposition = "consented";
    } else if (command.type === "revoke") {
      const consent = state.consents.find(item => item.operationId === command.consentOperationId);
      check(consent, "BINDING_MISMATCH", "Seller withdrawal must name an exact retained consent");
      disposition = consent.revokedByOperationId === null ? "consent-revoked" : "consent-already-revoked";
      if (consent.revokedByOperationId === null) consent.revokedByOperationId = command.operationId;
    } else {
      state.status = "paused"; state.haltReason = command.reasonCode; disposition = "paused";
    }
    if (disposition.endsWith("-quarantined")) { state.status = "quarantined"; state.haltReason = disposition; }
  }
  state.source = sourceJournal.state; state.sourceCheckpoint = sourceJournal.checkpoint;
  state.latestPreparationSha256 = latestPrepared.preparationSha256;
  const stateHash = walletDigest(state), previousEventHash = current.checkpoint.eventHash;
  const actorUserId = command.type === "quarantine-restore" ? null : command.actorUserId;
  const eventHash = walletDigest({ revision, operationId: command.operationId, inputHash, currentBasis, occurredAtMs: atMs,
    previousEventHash, stateHash, disposition, status: state.status });
  const receipt: ReleaseConsentReceipt = { operationId: command.operationId, inputHash, revision, eventHash, stateHash,
    commandType: command.type, actorUserId, disposition, status: state.status, executionAuthority: false, releaseAuthority: false };
  const record: ReleaseConsentRecord = { revision, operationId: command.operationId, inputHash, command, currentBasis,
    occurredAtMs: atMs, previousEventHash, eventHash, stateHash, receipt };
  const archive = sealed(current.bootstrap, [...current.records, record], state, { sourceJournal, latestPrepared });
  if (!terminal) {
    try { captureInboxData(archive, { maxBytes: MAX_RELEASE_CONSENT_BYTES - 1_048_576, maxNodes: 90_000, maxDepth: 60 }); }
    catch { throw new ReleaseConsentError("RESOURCE_LIMIT", "Consent evidence leaves insufficient stop, backup and restore capacity"); }
  }
  return { archive, receipt: capture(receipt) };
}

export function createReleaseConsentArchive(value: {
  mode: "simulation-only"; manifest: unknown; sourceStoreId: string; enrollingOwnerId: string; enrollmentOperationId: string;
  prepared: unknown; currentBasis: ReleaseConsentCurrentBasis; atMs: number;
}): ReleaseConsentArchive {
  runtime();
  const input = parse(z.strictObject({ mode: z.literal("simulation-only"), manifest: z.unknown(), sourceStoreId: id, enrollingOwnerId: id,
    enrollmentOperationId: id, prepared: preparedTrustedPaymentEvidenceSchema, currentBasis: releaseConsentCurrentBasisSchema, atMs: instant }), value);
  runtime(input.mode); const admission = captureTrustedPaymentManifest(input.manifest);
  const bootstrap = bootstrapOf({ sourceStoreId: input.sourceStoreId, ...admission, enrollingOwnerId: input.enrollingOwnerId,
    enrollmentOperationId: input.enrollmentOperationId, createdAtMs: input.atMs, initialPrepared: input.prepared, initialBasis: input.currentBasis });
  const archive = advance(initialArchive(bootstrap), enrollmentCommand(bootstrap), bootstrap.initialBasis, bootstrap.createdAtMs).archive;
  runtime(); return archive;
}

const archiveSchema = z.strictObject({ kind: z.literal(RELEASE_CONSENT_FORMAT), formatVersion: z.literal(1), mode: z.literal("simulation-only"),
  bootstrap: bootstrapSchema, records: z.array(recordSchema).min(1).max(MAX_RELEASE_CONSENT_RECORDS), checkpoint: checkpointSchema,
  state: z.unknown(), archiveSha256: hex });
/** Every retained preparation and original source-journal transition is replayed. A checksum is never authentication. */
export function verifyReleaseConsentArchive(value: unknown): ReleaseConsentArchive {
  runtime();
  if (value !== null && typeof value === "object" && verifiedArchives.has(value)) return value as ReleaseConsentArchive;
  const input = parse(archiveSchema, value), bootstrap = bootstrapOf(input.bootstrap);
  let current = initialArchive(bootstrap);
  for (const row of input.records) {
    const next = advance(current, row.command, row.currentBasis, row.occurredAtMs);
    check(equal(next.archive.records.at(-1), row), "INTEGRITY", "Consent record does not reproduce its exact result, source state and chain");
    current = next.archive;
  }
  check(equal(current, input), "INTEGRITY", "Consent head, projection, bootstrap or archive digest changed");
  runtime(); return current;
}
export function releaseConsentCommandDigest(value: unknown): string {
  runtime(); const digest = walletDigest(parse(releaseConsentPublicCommandSchema, value)); runtime(); return digest;
}
/** This lookup returns a historical result, including after a hold, withdrawal or restore. It never renews consent. */
export function findReleaseConsentReceipt(value: unknown, query: { operationId: string; inputHash: string }): ReleaseConsentReceipt | null {
  runtime(); const input = parse(z.strictObject({ operationId: id, inputHash: hex }), query), archive = verifyReleaseConsentArchive(value);
  const record = archive.records.find(row => row.operationId === input.operationId && row.inputHash === input.inputHash);
  runtime(); return record ? capture(record.receipt) : null;
}
export function appendReleaseConsent(value: unknown, supplied: unknown, suppliedBasis: ReleaseConsentCurrentBasis, atMs: number): {
  archive: ReleaseConsentArchive; receipt: ReleaseConsentReceipt; replayed: boolean;
} {
  runtime(); const command = parse(releaseConsentPublicCommandSchema, supplied), currentBasis = parse(releaseConsentCurrentBasisSchema, suppliedBasis);
  check(instant.safeParse(atMs).success, "INVALID_INPUT", "Consent clock must be an exact positive timestamp");
  const archive = verifyReleaseConsentArchive(value), inputHash = walletDigest(command);
  const receipt = findReleaseConsentReceipt(archive, { operationId: command.operationId, inputHash });
  if (receipt) { runtime(); return { archive, receipt, replayed: true }; }
  const appended = advance(archive, command, currentBasis, atMs); runtime(); return { ...appended, replayed: false };
}
export function inspectReleaseConsent(value: unknown, suppliedBasis: ReleaseConsentCurrentBasis, atMs: number): ReleaseConsentInspection {
  runtime(); const currentBasis = parse(releaseConsentCurrentBasisSchema, suppliedBasis), archive = verifyReleaseConsentArchive(value);
  check(instant.safeParse(atMs).success && atMs >= archive.checkpoint.lastCommandAtMs && atMs >= currentBasis.walletCheckpoint.lastCommandAtMs,
    "INVALID_INPUT", "Consent inspection clock precedes current retained evidence");
  const result = inspection(archive, currentBasis, atMs); runtime(); return result;
}

const backupSchema = z.strictObject({ kind: z.literal("development-release-consent-overlay-backup"), formatVersion: z.literal(1),
  mode: z.literal("simulation-only"), sourceStopped: z.literal(true), exportedAtMs: instant, archive: z.unknown(), backupSha256: hex });
/** Overlay component only. The owning store must also export the complete canonical and V1–V5 recovery evidence. */
export function createReleaseConsentBackup(value: unknown, exportedAtMs: number): ReleaseConsentBackup {
  runtime(); const archive = verifyReleaseConsentArchive(value);
  check(archive.state.status !== "recording" && archive.state.restoredTargetStoreId === null, "STOPPED", "Consent backup requires the stopped original source");
  check(instant.safeParse(exportedAtMs).success && exportedAtMs >= archive.checkpoint.lastCommandAtMs,
    "INVALID_INPUT", "Consent backup clock precedes retained evidence");
  const body = { kind: "development-release-consent-overlay-backup" as const, formatVersion: 1 as const, mode: "simulation-only" as const,
    sourceStopped: true as const, exportedAtMs, archive };
  const result = capture<ReleaseConsentBackup>({ ...body, backupSha256: walletDigest(body) }); runtime(); return result;
}
export function verifyReleaseConsentBackup(value: unknown): ReleaseConsentBackup {
  runtime(); const input = parse(backupSchema, value), expected = createReleaseConsentBackup(input.archive, input.exportedAtMs);
  check(equal(input, expected), "INTEGRITY", "Consent backup checksum or retained stopped history changed");
  runtime(); return expected;
}
/** Historical consistency only: a physical fresh-target certificate and complete recovery remain the storage owner's job. */
export function restoreReleaseConsentArchive(value: {
  backup: unknown; operationId: string; targetStoreId: string; atMs: number;
}): ReleaseConsentArchive {
  runtime(); const input = parse(z.strictObject({ backup: z.unknown(), operationId: id, targetStoreId: id, atMs: instant }), value);
  const backup = verifyReleaseConsentBackup(input.backup);
  // The inert backup envelope contains a distinct captured archive object. Reverify
  // that object to reconstruct its private derived source journal before advancing.
  const source = verifyReleaseConsentArchive(backup.archive);
  const command = parse(restoreSchema, { type: "quarantine-restore", operationId: input.operationId, backupSha256: backup.backupSha256,
    sourceArchiveSha256: source.archiveSha256, sourceCheckpoint: source.checkpoint, targetStoreId: input.targetStoreId,
    exportedAtMs: backup.exportedAtMs });
  const result = advance(source, command, source.records.at(-1)!.currentBasis, input.atMs).archive;
  runtime(); return result;
}
