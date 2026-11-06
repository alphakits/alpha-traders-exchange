import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { withDevelopmentPaymentMarketplaceInTransaction,
  type DevelopmentPaymentMarketplaceParticipant } from "@/lib/alpha-exchange-repository";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { AcceptedTermsPlanningError } from "./accepted-terms";
import { WalletAccessError } from "./access";
import { walletDigest } from "./commands";
import { WalletIntegrityError } from "./durable";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import { balance } from "./ledger";
import { developmentMarketplaceMobileCredentialsSchema } from "./marketplace-mobile-auth";
import { resolveDevelopmentPaymentMarketplacePrincipal,
  type DevelopmentPaymentMarketplacePrincipal } from "./payment-marketplace-auth";
import {
  developmentPaymentEvidenceUploadSchema, normalizeDevelopmentPaymentDisputeReason,
  normalizeDevelopmentPaymentEvidenceInput, paymentCanonicalCommitment,
  PaymentMarketplacePlanningError as CanonicalPaymentMarketplacePlanningError,
} from "./payment-marketplace-canonical";
import {
  assertPaymentMarketplaceCoherence, bindPaymentMarketplaceCommand,
  insertPaymentMarketplaceClaim, insertPaymentMarketplaceDispute, insertPaymentMarketplaceTransition,
  readPaymentMarketplaceClaim, readPaymentMarketplaceDispute, readPaymentMarketplacePredecessor,
  readPaymentMarketplaceTransition, registerPaymentMarketplaceContext,
  type PaymentMarketplaceClaim, type PaymentMarketplaceContext, type PaymentMarketplaceDispute,
  type PaymentMarketplaceOperation, type PaymentMarketplaceTransition,
} from "./payment-marketplace-coordination-store";
import { PaymentMarketplacePlanningError, planDevelopmentMarketplacePaymentClaim,
  planDevelopmentMarketplacePaymentDispute } from "./payment-marketplace-plan";
import { assertSimulationRuntime } from "./runtime";
import { isV4State } from "./v4-engine";
import { v5Command, WALLET_V5_ENGINE_VERSION } from "./v5-commands";
import { createCoordinatedV5DurableWallet, upgradeCoordinatedDurableWalletV5, type V5WalletSnapshot } from "./v5-durable";
import { isV5State, V5WalletError, type V5State } from "./v5-engine";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const webCredentials = { sessionToken: z.string().min(1).max(512), requestId: id };
const webOperation = { ...webCredentials, operationId: id };
const upgradeInput = z.strictObject({ ...webOperation, acknowledgeVersionUpgrade: z.literal(true),
  acknowledgePaymentClaimOnlyProfile: z.literal(true) });
const claimInput = z.strictObject({ ...webOperation, evidence: developmentPaymentEvidenceUploadSchema.optional() });
const disputeInput = z.strictObject({ ...webOperation, reason: z.string().min(1).max(2000) });
const inspectInput = z.strictObject(webCredentials);
const pauseInput = z.strictObject(webOperation);
const mobileCredentials = developmentMarketplaceMobileCredentialsSchema.shape;
const mobileUpgradeInput = z.strictObject({ ...upgradeInput.shape, ...mobileCredentials }).omit({ sessionToken: true });
const mobileClaimInput = z.strictObject({ ...claimInput.shape, ...mobileCredentials }).omit({ sessionToken: true });
const mobileDisputeInput = z.strictObject({ ...disputeInput.shape, ...mobileCredentials }).omit({ sessionToken: true });
const mobileInspectInput = z.strictObject({ ...mobileCredentials, requestId: id });
const mobilePauseInput = z.strictObject({ ...mobileCredentials, requestId: id, operationId: id });

export type DevelopmentPaymentMarketplaceUpgradeInput = z.infer<typeof upgradeInput>;
export type DevelopmentPaymentMarketplaceClaimInput = z.infer<typeof claimInput>;
export type DevelopmentPaymentMarketplaceDisputeInput = z.infer<typeof disputeInput>;
export type DevelopmentPaymentMarketplaceInspectionInput = z.infer<typeof inspectInput>;
export type DevelopmentPaymentMarketplacePauseInput = z.infer<typeof pauseInput>;
export type DevelopmentMobilePaymentMarketplaceUpgradeInput = z.infer<typeof mobileUpgradeInput>;
export type DevelopmentMobilePaymentMarketplaceClaimInput = z.infer<typeof mobileClaimInput>;
export type DevelopmentMobilePaymentMarketplaceDisputeInput = z.infer<typeof mobileDisputeInput>;
export type DevelopmentMobilePaymentMarketplaceInspectionInput = z.infer<typeof mobileInspectInput>;
export type DevelopmentMobilePaymentMarketplacePauseInput = z.infer<typeof mobilePauseInput>;
type Options = { mode: "simulation-only"; store: WalletStore; clock?: () => number };
type CredentialInput = DevelopmentPaymentMarketplaceInspectionInput | DevelopmentMobilePaymentMarketplaceInspectionInput;
type Failure = "INVALID_INPUT" | "ACTOR" | "INTEGRITY" | "LOCKED" | "UNSUPPORTED" | "STALE" | "UPGRADE_REQUIRED"
  | "STORAGE_UNAVAILABLE" | "40001" | "40P01";
export class DevelopmentPaymentMarketplaceWalletError extends Error {
  constructor(readonly code: Failure, message: string) { super(message); this.name = "DevelopmentPaymentMarketplaceWalletError"; }
}
function check(value: unknown, code: Failure, message: string): asserts value {
  if (!value) throw new DevelopmentPaymentMarketplaceWalletError(code, message);
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  check(parsed.success, "INVALID_INPUT", "Invalid development payment marketplace input"); return parsed.data;
}
function publicFailure(error: unknown): Error {
  if (error instanceof CommitOutcomeUnknownError) {
    return new CommitOutcomeUnknownError(new Error("Development payment transaction acknowledgement unavailable"));
  }
  if (error instanceof DevelopmentPaymentMarketplaceWalletError || error instanceof WalletAccessError
    || error instanceof WalletIntegrityError || error instanceof V5WalletError || error instanceof PaymentMarketplacePlanningError
    || error instanceof CanonicalPaymentMarketplacePlanningError || error instanceof AcceptedTermsPlanningError) return error;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "40001" || code === "40P01") {
    return new DevelopmentPaymentMarketplaceWalletError(code, "Development payment transaction retries were exhausted");
  }
  return new DevelopmentPaymentMarketplaceWalletError("STORAGE_UNAVAILABLE", "Development payment storage could not complete the operation");
}
export const paymentMarketplaceUpgradeFingerprint = (actorUserId: string, requestId: string) => walletDigest({
  kind: "alpha-wallet-initial-payment-upgrade-v1", actorUserId, requestId,
});
export const paymentMarketplaceClaimFingerprint = (actorUserId: string, requestId: string,
  evidence: null | { mimeType: string; contentDigest: string }) => walletDigest({
  kind: "alpha-wallet-initial-payment-claim-v1", actorUserId, requestId,
  evidence: evidence ? { mimeType: evidence.mimeType, contentDigest: evidence.contentDigest } : null,
});
export const paymentMarketplaceDisputeFingerprint = (actorUserId: string, requestId: string, reasonDigest: string) => walletDigest({
  kind: "alpha-wallet-initial-payment-dispute-v1", actorUserId, requestId, reasonDigest,
});
const checkpoint = (snapshot: V5WalletSnapshot) => ({ revision: snapshot.revision, eventHash: snapshot.eventHash,
  stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs });

export type DevelopmentPaymentMarketplaceUpgradeReceipt = {
  kind: "alpha-wallet-development-payment-marketplace-upgrade-v1"; mode: "simulation-only"; replayed: boolean;
  requestId: string; walletRevision: number; walletEventHash: string; sourceRevision: number; sourceEventHash: string;
  engineVersion: typeof WALLET_V5_ENGINE_VERSION; sourcePaused: boolean; sourceStatus: "accepted" | "cancelled";
  profile: "canonical-initial-payment-cohort-v1"; newCancellationSupported: false;
};
function upgradeReceipt(row: PaymentMarketplaceTransition, replayed: boolean): DevelopmentPaymentMarketplaceUpgradeReceipt {
  return { kind: "alpha-wallet-development-payment-marketplace-upgrade-v1", mode: "simulation-only", replayed,
    requestId: row.requestId, walletRevision: row.walletRevision, walletEventHash: row.walletEventHash,
    sourceRevision: row.walletCheckpoint.revision, sourceEventHash: row.walletCheckpoint.eventHash,
    engineVersion: WALLET_V5_ENGINE_VERSION, sourcePaused: row.continuation.sourceHaltReason !== null,
    sourceStatus: row.sourceStatus, profile: "canonical-initial-payment-cohort-v1", newCancellationSupported: false };
}
type PublicPaymentReceipt = {
  mode: "simulation-only"; replayed: boolean; requestId: string; platformListingId: string; platformTradeId: string;
  walletListingId: string; walletTradeId: string; acceptanceKey: string; actorUserId: string; actorKind: "buyer";
  principalRaw: string; transferAmountRaw: "0"; tradeReservedRaw: string; termsDigest: string;
  walletRevision: number; walletEventHash: string; publicationId: string;
  paymentVerified: false; releaseAuthorized: false;
};
export type DevelopmentPaymentMarketplaceClaimReceipt = PublicPaymentReceipt & {
  kind: "alpha-wallet-development-payment-marketplace-claim-v1"; claimKey: string; claimedAt: string;
  evidence: null | { evidenceId: string; contentDigest: string; mimeType: string; sizeBytes: number };
};
function claimReceipt(row: PaymentMarketplaceClaim, replayed: boolean): DevelopmentPaymentMarketplaceClaimReceipt {
  const r = row.receipt, proof = r.input.claim.proof;
  return { kind: "alpha-wallet-development-payment-marketplace-claim-v1", mode: "simulation-only", replayed,
    requestId: r.platformRequestId, platformListingId: r.platformListingId, platformTradeId: r.platformTradeId,
    walletListingId: r.walletListingId, walletTradeId: r.walletTradeId, acceptanceKey: r.acceptanceKey,
    actorUserId: r.actorUserId, actorKind: "buyer", claimKey: r.claimKey, claimedAt: new Date(r.claimedAtMs).toISOString(),
    principalRaw: r.principalRaw, transferAmountRaw: "0", tradeReservedRaw: r.input.principalHold.expectedTradeReservedRaw,
    termsDigest: r.termsDigest, walletRevision: row.walletRevision, walletEventHash: row.walletEventHash,
    publicationId: row.publicationId, paymentVerified: false, releaseAuthorized: false,
    evidence: proof ? { evidenceId: proof.evidenceId, contentDigest: proof.contentSha256, mimeType: proof.mimeType,
      sizeBytes: proof.sizeBytes } : null };
}
export type DevelopmentPaymentMarketplaceDisputeReceipt = PublicPaymentReceipt & {
  kind: "alpha-wallet-development-payment-marketplace-dispute-v1"; disputeKey: string; claimKey: string;
  disputedAt: string; disputed: true;
};
function disputeReceipt(row: PaymentMarketplaceDispute, replayed: boolean): DevelopmentPaymentMarketplaceDisputeReceipt {
  const r = row.receipt;
  return { kind: "alpha-wallet-development-payment-marketplace-dispute-v1", mode: "simulation-only", replayed,
    requestId: r.platformRequestId, platformListingId: r.platformListingId, platformTradeId: r.platformTradeId,
    walletListingId: r.walletListingId, walletTradeId: r.walletTradeId, acceptanceKey: r.acceptanceKey,
    actorUserId: r.actorUserId, actorKind: "buyer", claimKey: r.claimKey, disputeKey: r.disputeKey,
    disputedAt: new Date(r.disputedAtMs).toISOString(), disputed: true, principalRaw: r.principalRaw,
    transferAmountRaw: "0", tradeReservedRaw: r.input.principalHold.expectedTradeReservedRaw, termsDigest: r.termsDigest,
    walletRevision: row.walletRevision, walletEventHash: row.walletEventHash, publicationId: row.publicationId,
    paymentVerified: false, releaseAuthorized: false };
}
export type DevelopmentPaymentMarketplaceInspection = {
  kind: "alpha-wallet-development-payment-marketplace-inspection-v1"; mode: "simulation-only"; requestId: string;
  marketplace: { listingId: string; tradeId: string; status: PurchaseRequest["status"]; disputed: boolean };
  wallet: { revision: number; eventHash: string; engineVersion: typeof WALLET_V5_ENGINE_VERSION; halted: boolean };
  transition: DevelopmentPaymentMarketplaceUpgradeReceipt;
  acceptance: { acceptanceKey: string; principalRaw: string; walletRevision: number; walletEventHash: string; publicationId: string };
  cancellation: null | { cancellationKey: string; walletRevision: number; walletEventHash: string };
  claim: DevelopmentPaymentMarketplaceClaimReceipt | null;
  dispute: DevelopmentPaymentMarketplaceDisputeReceipt | null;
  reservation: { listingAvailableRaw: string; tradeReservedRaw: string };
};
export type DevelopmentPaymentMarketplacePauseReceipt = {
  kind: "alpha-wallet-development-payment-marketplace-pause-v1"; mode: "simulation-only"; replayed: boolean;
  halted: true; walletRevision: number; walletEventHash: string;
};
function v5Snapshot(snapshot: V5WalletSnapshot): V5WalletSnapshot & { state: V5State } {
  check(isV5State(snapshot.state), "UPGRADE_REQUIRED", "An explicit owner payment-profile upgrade is required");
  return { ...snapshot, state: snapshot.state };
}
type Predecessor = Awaited<ReturnType<typeof readPaymentMarketplacePredecessor>>;
function verifyPredecessor(predecessor: Predecessor, request: PurchaseRequest, snapshot: V5WalletSnapshot) {
  const { activation, acceptance, transition, cancellation } = predecessor, state = snapshot.state;
  check((isV4State(state) || isV5State(state)) && request.tradeId && activation.requestId === request.id
    && activation.platformListingId === request.listingId && activation.platformTradeId === request.tradeId
    && activation.sellerId === request.sellerId && activation.buyerId === request.buyerId,
  "INTEGRITY", "Payment predecessor and canonical identities disagree");
  const binding = state.initialBindings.get(request.id), original = state.initialAcceptanceReceipts.get(acceptance.receipt.acceptanceKey);
  check(binding && original && state.initialBindings.size === 1 && state.initialAcceptanceReceipts.size === 1
    && binding.walletTradeId === activation.walletTradeId && binding.walletListingId === activation.walletListingId
    && binding.assetId === activation.assetId && binding.acceptanceKey === acceptance.receipt.acceptanceKey
    && walletDigest(original) === walletDigest(acceptance.receipt) && acceptance.actorUserId === request.sellerId
    && acceptance.walletRevision === original.commandRevision && acceptance.walletCommandKey === original.commandKey,
  "INTEGRITY", "Original coordinated and financial acceptance disagree");
  check(transition.requestId === request.id && walletDigest(transition.continuation) === walletDigest(state.cancellationContinuation)
    && transition.walletRevision === transition.continuation.commandRevision
    && transition.walletCommandKey === transition.continuation.commandKey,
  "INTEGRITY", "Payment requires the original coordinated V4 continuation");
  if (cancellation) check(request.status === "cancelled"
    && walletDigest(state.initialCancellationReceipts.get(cancellation.receipt.cancellationKey)) === walletDigest(cancellation.receipt),
  "INTEGRITY", "An archival cancelled cohort cannot change its original cancellation");
  else check(state.initialCancellationReceipts.size === 0 && request.status !== "cancelled",
    "INTEGRITY", "Financial and canonical cancellation disagree");
}
function verifyTransition(row: PaymentMarketplaceTransition, snapshot: V5WalletSnapshot & { state: V5State }, requestId: string) {
  check(row.requestId === requestId && row.inputDigest === paymentMarketplaceUpgradeFingerprint(row.actorUserId, requestId)
    && walletDigest(row.continuation) === walletDigest(snapshot.state.paymentContinuation)
    && walletDigest(row.walletCheckpoint) === walletDigest(row.continuation.checkpoint)
    && row.walletRevision === row.continuation.commandRevision && row.walletCommandKey === row.continuation.commandKey,
  "INTEGRITY", "Payment profile transition and original V5 continuation disagree");
}
function verifyClaim(row: PaymentMarketplaceClaim, snapshot: V5WalletSnapshot & { state: V5State }, request: PurchaseRequest) {
  const r = row.receipt, original = snapshot.state.initialPaymentClaimReceipts.get(r.claimKey), proof = r.input.claim.proof;
  check(original && request.status === "payment_sent" && r.platformRequestId === request.id
    && r.platformTradeId === request.tradeId && r.actorUserId === request.buyerId && row.actorUserId === r.actorUserId
    && row.inputDigest === paymentMarketplaceClaimFingerprint(r.actorUserId, request.id,
      proof ? { mimeType: proof.mimeType, contentDigest: proof.contentSha256 } : null)
    && row.walletRevision === r.commandRevision && row.walletCommandKey === r.commandKey
    && walletDigest(original) === walletDigest(r), "INTEGRITY", "Coordinated payment claim and original financial receipt disagree");
}
function verifyDispute(row: PaymentMarketplaceDispute, snapshot: V5WalletSnapshot & { state: V5State }, request: PurchaseRequest) {
  const r = row.receipt, original = snapshot.state.initialDisputeFreezeReceipts.get(r.disputeKey);
  check(original && request.status === "payment_sent" && r.platformRequestId === request.id
    && r.platformTradeId === request.tradeId && r.actorUserId === request.buyerId && row.actorUserId === r.actorUserId
    && row.inputDigest === paymentMarketplaceDisputeFingerprint(r.actorUserId, request.id, r.input.reasonDigest)
    && row.walletRevision === r.commandRevision && row.walletCommandKey === r.commandKey
    && walletDigest(original) === walletDigest(r), "INTEGRITY", "Coordinated dispute and original financial receipt disagree");
}
type Attempt = { tx: WalletSql; participant: DevelopmentPaymentMarketplaceParticipant;
  request: PurchaseRequest & { tradeId: string }; context: PaymentMarketplaceContext;
  principal: DevelopmentPaymentMarketplacePrincipal };

/** Every child receives the same earliest physical transaction certificate and guarded SQL handle. */
async function inPaymentAttempt<T>(mode: "simulation-only", raw: WalletSql, work: (tx: WalletSql) => Promise<T>): Promise<T> {
  let originalId: string | undefined;
  const assertOwner = async () => {
    const rows = (await raw.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null }>(
      `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
        current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode
        /* payment coordinator: original attempt owner */`)).rows;
    const current = rows[0];
    check(rows.length === 1 && typeof current?.transaction_id === "string" && /^[1-9][0-9]*$/.test(current.transaction_id),
      "INTEGRITY", "Payment coordinator requires a physical transaction identity");
    check(originalId === undefined || originalId === current.transaction_id, "INTEGRITY", "Payment transaction identity changed or ended");
    originalId ??= current.transaction_id;
    check(current.isolation === "serializable" && current.read_only === "off" && current.development_mode === mode,
      "INTEGRITY", "Payment coordinator requires its original writable SERIALIZABLE simulation transaction");
    assertSimulationRuntime(mode);
  };
  const tx: WalletSql = {
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      await assertOwner(); const result = await raw.query<Row>(sql, values); await assertOwner(); return result;
    },
    async exec(sql: string) { await assertOwner(); await raw.exec(sql); await assertOwner(); },
  };
  try { await assertOwner(); await assertOwner(); const result = await work(tx); await assertOwner(); return result; }
  catch (error) {
    if (originalId !== undefined) try {
      const rows = (await raw.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
      if (rows.length === 1 && rows[0]?.transaction_id === originalId) {
        await raw.query("SELECT 1 / 0 /* abort failed payment coordinator attempt */");
      }
    } catch { /* A replacement transaction never becomes the failed attempt's cleanup owner. */ }
    throw error;
  }
}

/** Private stored-authority API. No route, sender, signer or provider is installed. */
function createCoordinator(options: Options, credentialKind: "web" | "mobile") {
  assertSimulationRuntime(options.mode);
  const { mode, store } = options, suppliedClock = options.clock ?? Date.now;
  let previousClock: number | undefined;
  const clock = () => {
    assertSimulationRuntime(mode); const at = suppliedClock();
    check(Number.isSafeInteger(at) && at >= 0 && Number.isFinite(new Date(at).getTime())
      && (previousClock === undefined || at >= previousClock), "INVALID_INPUT", "Invalid or regressed development payment clock");
    previousClock = at; return at;
  };
  const walletAt = (context: PaymentMarketplaceContext, commandClock = clock) => createCoordinatedV5DurableWallet({ mode, context, clock: commandClock });
  async function run<T>(input: CredentialInput, operation: PaymentMarketplaceOperation, work: (attempt: Attempt) => Promise<T>) {
    assertSimulationRuntime(mode);
    return store.transaction(raw => inPaymentAttempt(mode, raw, async tx => {
      let principal: DevelopmentPaymentMarketplacePrincipal | undefined, context: PaymentMarketplaceContext | undefined;
      const result = await withDevelopmentPaymentMarketplaceInTransaction({ mode, tx, requestId: input.requestId }, async participant => {
        const request = participant.canonical.request;
        check(request.id === input.requestId && request.tradeId, "INTEGRITY", "One exact retained payment request and trade are required");
        principal = await resolveDevelopmentPaymentMarketplacePrincipal({ mode, tx, requestId: input.requestId, operation,
          credentials: "sessionToken" in input ? { kind: "web", sessionToken: input.sessionToken }
            : { kind: "mobile", accessToken: input.accessToken, metadata: input.metadata }, clock });
        context = await registerPaymentMarketplaceContext({ mode, tx, requestId: input.requestId, operation, actorUserId: principal.userId });
        const answer = await work({ tx, participant, request: request as PurchaseRequest & { tradeId: string }, context, principal });
        await principal.assertFresh(); return answer;
      });
      check(principal && context, "INTEGRITY", "Payment coordinator did not complete its original transaction");
      await assertPaymentMarketplaceCoherence(context); await principal.assertFresh(); return structuredClone(result);
    })).catch(error => { throw publicFailure(error); });
  }
  async function current(context: PaymentMarketplaceContext, request: PurchaseRequest) {
    const transition = await readPaymentMarketplaceTransition(context);
    check(transition, "UPGRADE_REQUIRED", "Explicit owner enrollment in the payment claim profile is required");
    const predecessor = await readPaymentMarketplacePredecessor(context), snapshot = v5Snapshot(await walletAt(context).snapshot());
    verifyPredecessor(predecessor, request, snapshot); verifyTransition(transition, snapshot, request.id);
    return { transition, predecessor, snapshot };
  }
  return Object.freeze({
    async upgradeRequest(raw: unknown): Promise<DevelopmentPaymentMarketplaceUpgradeReceipt> {
      const input = credentialKind === "web" ? parse(upgradeInput, raw) : parse(mobileUpgradeInput, raw);
      return run(input, "upgrade", async ({ participant, request, principal, context }) => {
        const inputDigest = paymentMarketplaceUpgradeFingerprint(principal.userId, request.id);
        const old = await readPaymentMarketplaceTransition(context), predecessor = await readPaymentMarketplacePredecessor(context);
        const snapshot = await walletAt(context).snapshot(); verifyPredecessor(predecessor, request, snapshot);
        if (old) {
          check(old.inputDigest === inputDigest && old.actorUserId === principal.userId, "STALE", "Payment upgrade identity was reused by another owner");
          verifyTransition(old, v5Snapshot(snapshot), request.id); return upgradeReceipt(old, true);
        }
        check(isV4State(snapshot.state) && (request.status === "accepted" || request.status === "cancelled"),
          "UNSUPPORTED", "Only the original accepted or archival cancelled V4 cohort may be explicitly enrolled");
        const at = clock();
        check(at >= snapshot.lastCommandAtMs && at < principal.sessionExpiresAtMs, "LOCKED", "Current owner authority cannot authorize this continuation time");
        const command = v5Command("continueFromV4", { kind: "operator", id: principal.userId }, input.operationId,
          { checkpoint: checkpoint(snapshot) });
        await bindPaymentMarketplaceCommand(context, command); await participant.authorizeUpgrade(context);
        const execution = await upgradeCoordinatedDurableWalletV5({ mode, context, command, acknowledgeVersionUpgrade: true,
          acknowledgePaymentClaimOnlyProfile: true, clock: () => at });
        check(!execution.replayed, "INTEGRITY", "A standalone continuation cannot authorize a coordinated payment profile");
        return upgradeReceipt(await insertPaymentMarketplaceTransition(context, { inputDigest, execution }), false);
      });
    },
    async claimPayment(raw: unknown): Promise<DevelopmentPaymentMarketplaceClaimReceipt> {
      const input = credentialKind === "web" ? parse(claimInput, raw) : parse(mobileClaimInput, raw);
      const evidence = input.evidence === undefined ? null : normalizeDevelopmentPaymentEvidenceInput(input.evidence);
      return run(input, "claim", async ({ participant, request, principal, context }) => {
        const { predecessor, snapshot } = await current(context, request);
        const inputDigest = paymentMarketplaceClaimFingerprint(principal.userId, request.id, evidence);
        const old = await readPaymentMarketplaceClaim(context);
        if (old) {
          check(old.actorUserId === principal.userId && old.inputDigest === inputDigest, "STALE", "Payment claim was already recorded with different evidence");
          verifyClaim(old, snapshot, request); return claimReceipt(old, true);
        }
        const claimedAtMs = clock();
        check(claimedAtMs < principal.sessionExpiresAtMs, "LOCKED", "Current buyer authority cannot authorize this claim time");
        const plan = planDevelopmentMarketplacePaymentClaim({ mode, actorUserId: principal.userId, requestId: request.id,
          operationId: input.operationId, claimedAtMs, marketplace: participant.marketplace, canonical: participant.canonical,
          basis: participant.basis, digests: participant.digests, activation: predecessor.activation,
          acceptance: predecessor.acceptance, wallet: snapshot,
          ...(input.evidence === undefined ? {} : { evidence: input.evidence }) });
        check(principal.actorKind === "buyer", "ACTOR", "Payment claim requires the current retained buyer");
        await bindPaymentMarketplaceCommand(context, plan.command, plan.canonicalInput);
        const execution = await walletAt(context, () => claimedAtMs).execute(plan.command);
        check(!execution.replayed, "INTEGRITY", "A standalone financial claim cannot authorize a canonical claim");
        const canonical = await participant.claim(context, plan.canonicalDecision);
        check(walletDigest(paymentCanonicalCommitment(canonical)) === walletDigest(paymentCanonicalCommitment(plan.canonicalResult)),
          "INTEGRITY", "Canonical claim differs from its complete original plan");
        return claimReceipt(await insertPaymentMarketplaceClaim(context, { inputDigest, execution, canonical }), false);
      });
    },
    async openDispute(raw: unknown): Promise<DevelopmentPaymentMarketplaceDisputeReceipt> {
      const input = credentialKind === "web" ? parse(disputeInput, raw) : parse(mobileDisputeInput, raw);
      const reason = normalizeDevelopmentPaymentDisputeReason(input.reason);
      const reasonDigest = createHash("sha256").update(reason, "utf8").digest("hex");
      return run(input, "dispute", async ({ participant, request, principal, context }) => {
        const { predecessor, snapshot } = await current(context, request);
        const inputDigest = paymentMarketplaceDisputeFingerprint(principal.userId, request.id, reasonDigest);
        const old = await readPaymentMarketplaceDispute(context);
        if (old) {
          check(old.actorUserId === principal.userId && old.inputDigest === inputDigest, "STALE", "Dispute was already recorded with a different reason");
          verifyDispute(old, snapshot, request); return disputeReceipt(old, true);
        }
        const disputedAtMs = clock();
        check(disputedAtMs < principal.sessionExpiresAtMs, "LOCKED", "Current buyer authority cannot authorize this dispute time");
        const plan = planDevelopmentMarketplacePaymentDispute({ mode, actorUserId: principal.userId, requestId: request.id,
          operationId: input.operationId, disputedAtMs, reason, marketplace: participant.marketplace, canonical: participant.canonical,
          basis: participant.basis, digests: participant.digests, activation: predecessor.activation,
          acceptance: predecessor.acceptance, wallet: snapshot });
        check(principal.actorKind === "buyer", "ACTOR", "Dispute requires the current retained buyer");
        await bindPaymentMarketplaceCommand(context, plan.command, plan.canonicalInput);
        const execution = await walletAt(context, () => disputedAtMs).execute(plan.command);
        check(!execution.replayed, "INTEGRITY", "A standalone financial dispute cannot authorize a canonical dispute");
        const canonical = await participant.dispute(context, plan.canonicalDecision);
        check(walletDigest(paymentCanonicalCommitment(canonical)) === walletDigest(paymentCanonicalCommitment(plan.canonicalResult)),
          "INTEGRITY", "Canonical dispute differs from its complete original plan");
        return disputeReceipt(await insertPaymentMarketplaceDispute(context, { inputDigest, execution, canonical }), false);
      });
    },
    async inspect(raw: unknown): Promise<DevelopmentPaymentMarketplaceInspection> {
      const input = credentialKind === "web" ? parse(inspectInput, raw) : parse(mobileInspectInput, raw);
      return run(input, "inspect", async ({ request, context }) => {
        const { transition, predecessor, snapshot } = await current(context, request);
        const claim = await readPaymentMarketplaceClaim(context), dispute = await readPaymentMarketplaceDispute(context);
        if (claim) verifyClaim(claim, snapshot, request); if (dispute) verifyDispute(dispute, snapshot, request);
        const { activation, acceptance, cancellation } = predecessor;
        return { kind: "alpha-wallet-development-payment-marketplace-inspection-v1", mode, requestId: request.id,
          marketplace: { listingId: request.listingId, tradeId: request.tradeId, status: request.status, disputed: dispute !== null },
          wallet: { revision: snapshot.revision, eventHash: snapshot.eventHash, engineVersion: WALLET_V5_ENGINE_VERSION,
            halted: snapshot.state.haltReason !== null }, transition: upgradeReceipt(transition, true),
          acceptance: { acceptanceKey: acceptance.receipt.acceptanceKey, principalRaw: acceptance.receipt.principalRaw,
            walletRevision: acceptance.walletRevision, walletEventHash: acceptance.walletEventHash, publicationId: acceptance.publicationId },
          cancellation: cancellation ? { cancellationKey: cancellation.receipt.cancellationKey,
            walletRevision: cancellation.walletRevision, walletEventHash: cancellation.walletEventHash } : null,
          claim: claim ? claimReceipt(claim, true) : null, dispute: dispute ? disputeReceipt(dispute, true) : null,
          reservation: { listingAvailableRaw: balance(snapshot.state, activation.assetId, `listing:${activation.walletListingId}`).toString(),
            tradeReservedRaw: balance(snapshot.state, activation.assetId, `trade:${activation.walletTradeId}`).toString() } };
      });
    },
    async pause(raw: unknown): Promise<DevelopmentPaymentMarketplacePauseReceipt> {
      const input = credentialKind === "web" ? parse(pauseInput, raw) : parse(mobilePauseInput, raw);
      return run(input, "pause", async ({ request, context, principal }) => {
        await current(context, request);
        const command = v5Command("pause", { kind: "operator", id: principal.userId }, input.operationId, null);
        await bindPaymentMarketplaceCommand(context, command);
        const execution = await walletAt(context).execute(command);
        return { kind: "alpha-wallet-development-payment-marketplace-pause-v1", mode, replayed: execution.replayed,
          halted: true, walletRevision: execution.revision, walletEventHash: execution.eventHash };
      });
    },
  });
}
export function createDevelopmentPaymentMarketplaceWalletCoordinator(options: Options) {
  const coordinator = createCoordinator(options, "web");
  return Object.freeze({
    upgradeRequest: (input: DevelopmentPaymentMarketplaceUpgradeInput) => coordinator.upgradeRequest(input),
    claimPayment: (input: DevelopmentPaymentMarketplaceClaimInput) => coordinator.claimPayment(input),
    openDispute: (input: DevelopmentPaymentMarketplaceDisputeInput) => coordinator.openDispute(input),
    inspect: (input: DevelopmentPaymentMarketplaceInspectionInput) => coordinator.inspect(input),
    pause: (input: DevelopmentPaymentMarketplacePauseInput) => coordinator.pause(input),
  });
}
export function createDevelopmentMobilePaymentMarketplaceWalletCoordinator(options: Options) {
  const coordinator = createCoordinator(options, "mobile");
  return Object.freeze({
    upgradeRequest: (input: DevelopmentMobilePaymentMarketplaceUpgradeInput) => coordinator.upgradeRequest(input),
    claimPayment: (input: DevelopmentMobilePaymentMarketplaceClaimInput) => coordinator.claimPayment(input),
    openDispute: (input: DevelopmentMobilePaymentMarketplaceDisputeInput) => coordinator.openDispute(input),
    inspect: (input: DevelopmentMobilePaymentMarketplaceInspectionInput) => coordinator.inspect(input),
    pause: (input: DevelopmentMobilePaymentMarketplacePauseInput) => coordinator.pause(input),
  });
}
