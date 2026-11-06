import "server-only";

import type { DevelopmentChainObservation } from "./chain-observer-common";
import type { DepositInboxCandidate, DepositInboxManifestV1 } from "./deposit-inbox-admission";
import type { DepositPreparationContextV1, PreparedDepositObservationV1 } from "./deposit-observation-preparation";

export const DEPOSIT_INBOX_SCHEMA = "alpha_wallet_deposit_inbox_simulation";
export const DEPOSIT_INBOX_PROFILE = "development-deposit-inbox-v1";
export const DEPOSIT_INBOX_LIMITS = Object.freeze({ commands: 1000, ordinaryCommands: 998, terminalCommands: 999,
  observations: 256, blockAnchors: 4096, transactionAnchors: 256, events: 256, candidateJobs: 16,
  candidatesPerJob: 256, rawBytes: 16 * 1_048_576, backupBytes: 64 * 1_048_576, controlReserveBytes: 65_536 });

export interface DepositInboxCheckpoint { readonly revision: number; readonly eventHash: string; readonly stateHash: string }
export type DepositInboxStatus = "recording" | "paused" | "quarantined";
export interface DepositInboxActor { readonly workerId: string; readonly role: "worker" | "operator" }
export interface DepositInboxBootstrap {
  readonly kind: "development-deposit-inbox-bootstrap";
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly inboxId: string;
  readonly storeInstanceId: string;
  readonly manifestSha256: string;
  readonly requestId: string;
  readonly atMs: number;
  readonly bootstrapSha256: string;
}
export interface DepositInboxCursorPrecondition {
  readonly jobId: string;
  readonly expectedCursorRevision: number;
  readonly expectedNextOrdinal: number;
  readonly candidateManifestSha256: string;
}
export interface DepositInboxCandidateJob {
  readonly jobId: string;
  readonly workerId: string;
  readonly manifestSha256: string;
  readonly candidateManifestSha256: string;
  readonly candidates: readonly DepositInboxCandidate[];
  readonly commandRevision: number;
}
export interface DepositInboxCandidateCursor {
  readonly jobId: string;
  readonly candidateManifestSha256: string;
  readonly previousRevision: number | null;
  readonly previousNextOrdinal: number | null;
  readonly nextOrdinal: number;
  readonly candidateCount: number;
  readonly commandRevision: number;
}
export interface DepositInboxEvidenceReference {
  readonly evidenceId: string;
  readonly observationSha256: string;
  readonly rawBytes: number;
  readonly commandRevision: number;
}
export interface DepositInboxEvidenceBlob extends DepositInboxEvidenceReference {
  readonly observation: DevelopmentChainObservation;
}
export interface DepositInboxObservation extends DepositInboxEvidenceReference {
  readonly sourceSetId: string;
  readonly assignmentId: string;
  readonly nativeEventLocator: string;
  readonly eventFactsSha256: string;
  readonly transactionKey: string;
  readonly transactionFactsSha256: string;
}
export interface DepositInboxBlockAnchor {
  readonly blockKey: string;
  readonly chainKey: string;
  readonly number: string;
  readonly hash: string;
  readonly parentHash: string;
  readonly timestampMs: number;
  readonly blockSemanticsSha256: string;
  readonly evidenceId: string;
  readonly commandRevision: number;
}
export interface DepositInboxTransactionAnchor {
  readonly transactionKey: string;
  readonly chainKey: string;
  readonly transactionId: string;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly transactionIndex: string;
  readonly receiptSemanticsSha256: string;
  readonly transactionFactsSha256: string;
  readonly evidenceId: string;
  readonly commandRevision: number;
}
export interface DepositInboxEvent {
  readonly nativeEventLocator: string;
  readonly eventKey: string;
  readonly chainKey: string;
  readonly token: string;
  readonly sender: string;
  readonly recipient: string;
  readonly amountRaw: string;
  readonly eventIndex: string;
  readonly assignmentId: string;
  readonly assignmentSha256: string;
  readonly transactionKey: string;
  readonly eventFactsSha256: string;
  readonly evidenceId: string;
  readonly commandRevision: number;
}
export interface DepositInboxEventObservation {
  readonly nativeEventLocator: string;
  readonly evidenceId: string;
  readonly commandRevision: number;
}
export interface DepositInboxSourceHead {
  readonly sourceSetId: string;
  readonly chainKey: string;
  readonly number: string;
  readonly hash: string;
  readonly timestampMs: number;
  readonly evidenceId: string;
  readonly previousRevision: number | null;
  readonly commandRevision: number;
}
export type DepositInboxQuarantineReason = "validated-event-conflict" | "validated-transaction-conflict"
  | "validated-block-conflict" | "validated-head-regression" | "request-conflict" | "source-conflict-unsealed"
  | "resource-limit" | "restored-target";
export interface DepositInboxQuarantine {
  readonly quarantineId: string;
  readonly reason: DepositInboxQuarantineReason;
  readonly scope: string;
  readonly firstEvidenceId: string | null;
  readonly incomingEvidenceId: string | null;
  readonly incomingFingerprint: string;
  readonly originalRequestKey: string | null;
  readonly originalFingerprint: string | null;
  readonly commandRevision: number;
}
/** Full target checkpoint is the immutable journal receipt at targetRevision; no self-referential state hash. */
export interface DepositInboxRecoveryRecord {
  readonly recoveryId: string;
  readonly requestId: string;
  readonly sourceStoreInstanceId: string;
  readonly targetStoreInstanceId: string;
  readonly sourceCheckpoint: DepositInboxCheckpoint;
  readonly backupChecksum: string;
  readonly targetRevision: number;
  readonly commandRevision: number;
}
export interface DepositInboxEffects {
  readonly evidenceBlobs: readonly DepositInboxEvidenceReference[];
  readonly observations: readonly DepositInboxObservation[];
  readonly blockAnchors: readonly DepositInboxBlockAnchor[];
  readonly transactionAnchors: readonly DepositInboxTransactionAnchor[];
  readonly events: readonly DepositInboxEvent[];
  readonly eventObservations: readonly DepositInboxEventObservation[];
  readonly sourceHeads: readonly DepositInboxSourceHead[];
  readonly candidateJobs: readonly DepositInboxCandidateJob[];
  readonly candidateCursors: readonly DepositInboxCandidateCursor[];
  readonly quarantines: readonly DepositInboxQuarantine[];
  readonly recoveryReceipts: readonly DepositInboxRecoveryRecord[];
}
export interface DepositInboxState extends Omit<DepositInboxEffects, "evidenceBlobs"> {
  readonly kind: "development-deposit-inbox-state";
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly profile: typeof DEPOSIT_INBOX_PROFILE;
  readonly inboxId: string;
  readonly manifestSha256: string;
  readonly originStoreInstanceId: string;
  readonly storeInstanceId: string;
  readonly status: DepositInboxStatus;
  readonly haltReason: string | null;
  readonly lastCommandAtMs: number;
  readonly rawEvidenceBytes: number;
}
export type DepositInboxFailureCode = "TIMEOUT" | "TRANSPORT" | "INVALID_RESPONSE" | "INVALID_EVIDENCE"
  | "SOURCE_CONFLICT" | "STALE_CHECKPOINT" | "RESOURCE_LIMIT";
export interface DepositInboxUnsealedAttempt {
  readonly kind: "development-deposit-unsealed-attempt";
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly inboxId: string;
  readonly storeInstanceId: string;
  readonly manifestSha256: string;
  readonly workerId: string;
  readonly attemptId: string;
  readonly candidate: DepositInboxCandidate;
  readonly preparationContext: DepositPreparationContextV1;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly failureCode: DepositInboxFailureCode;
  readonly attemptSha256: string;
}
export type DepositInboxUserCommand =
  | { readonly type: "register-candidate-job"; readonly requestId: string; readonly jobId: string;
      readonly orderedCandidates: readonly DepositInboxCandidate[] }
  | { readonly type: "record-observation"; readonly requestId: string; readonly prepared: PreparedDepositObservationV1;
      readonly candidateCursor: DepositInboxCursorPrecondition | null }
  | { readonly type: "record-attempt-hold"; readonly requestId: string; readonly attempt: DepositInboxUnsealedAttempt;
      readonly candidateCursor: DepositInboxCursorPrecondition | null }
  | { readonly type: "pause"; readonly requestId: string; readonly reason: string };
export type DepositInboxCompactPreparation = Omit<PreparedDepositObservationV1, "timedObservation"> & {
  readonly timedObservation: Omit<PreparedDepositObservationV1["timedObservation"], "observation"> & { readonly evidenceId: string };
};
export type DepositInboxStoredCommand = Exclude<DepositInboxUserCommand, { type: "record-observation" }> | {
  readonly type: "record-observation"; readonly requestId: string; readonly prepared: DepositInboxCompactPreparation;
  readonly candidateCursor: DepositInboxCursorPrecondition | null;
} | {
  readonly type: "resource-quarantine"; readonly requestId: string; readonly rejectedRequestKey: string;
  readonly rejectedFingerprint: string; readonly scope: string; readonly originalFingerprint: string | null;
} | {
  readonly type: "restore-quarantine"; readonly requestId: string; readonly sourceStoreInstanceId: string;
  readonly targetStoreInstanceId: string; readonly sourceCheckpoint: DepositInboxCheckpoint; readonly backupChecksum: string;
};
export type DepositInboxDisposition = "job-registered" | "recorded" | "duplicate-evidence" | "corroborating-observation"
  | "stale-preparation-held" | "continuity-unproved-held" | "attempt-held" | "conflict-quarantined"
  | "request-conflict-quarantined" | "source-conflict-unsealed" | "resource-quarantined" | "paused" | "restored-quarantined";
export interface DepositInboxOutcome {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly disposition: DepositInboxDisposition;
  readonly requestId: string;
  readonly requestKey: string;
  readonly inputFingerprint: string;
  readonly workerId: string;
  readonly recordedAtMs: number;
  readonly revision: number;
  readonly evidenceId: string | null;
  readonly nativeEventLocator: string | null;
  readonly quarantineId: string | null;
  readonly cursorBefore: DepositInboxCandidateCursor | null;
  readonly cursorAfter: DepositInboxCandidateCursor | null;
}
export interface DepositInboxReceipt extends DepositInboxOutcome { readonly checkpoint: DepositInboxCheckpoint }
export interface DepositInboxJournalRecord {
  readonly kind: "development-deposit-inbox-command";
  readonly formatVersion: 1;
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly revision: number;
  readonly atMs: number;
  readonly workerId: string;
  readonly actorRole: "worker" | "operator" | "restore";
  readonly requestKey: string;
  readonly inputFingerprint: string;
  readonly command: DepositInboxStoredCommand;
  readonly effects: DepositInboxEffects;
  readonly result: DepositInboxOutcome;
  readonly resultSha256: string;
  readonly previousEventHash: string;
  readonly eventHash: string;
  readonly stateHash: string;
  readonly receipt: DepositInboxReceipt;
}
export interface DepositInboxArchive {
  readonly manifest: DepositInboxManifestV1;
  readonly bootstrap: DepositInboxBootstrap;
  readonly commands: readonly DepositInboxJournalRecord[];
  readonly evidenceBlobs: readonly DepositInboxEvidenceBlob[];
  readonly projections: DepositInboxState;
  readonly checkpoint: DepositInboxCheckpoint;
}
export interface DepositInboxSnapshot {
  readonly mode: "simulation-only";
  readonly creditAuthority: false;
  readonly manifest: DepositInboxManifestV1;
  readonly bootstrap: DepositInboxBootstrap;
  readonly state: DepositInboxState;
  readonly checkpoint: DepositInboxCheckpoint;
}
export interface DepositInboxAppendPlan {
  readonly previousCheckpoint: DepositInboxCheckpoint;
  readonly record: DepositInboxJournalRecord;
  readonly evidenceBlobs: readonly DepositInboxEvidenceBlob[];
  readonly nextState: DepositInboxState;
  readonly nextCheckpoint: DepositInboxCheckpoint;
  readonly archive: DepositInboxArchive;
}
export type DepositInboxTransition = { readonly kind: "recovered"; readonly receipt: DepositInboxReceipt }
  | { readonly kind: "append"; readonly plan: DepositInboxAppendPlan; readonly receipt: DepositInboxReceipt };
