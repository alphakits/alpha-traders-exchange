import "server-only";

import { z } from "zod";
import { withDevelopmentCancellationMarketplaceInTransaction,
  type DevelopmentCancellationMarketplaceParticipant } from "@/lib/alpha-exchange-repository";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { AcceptedTermsPlanningError } from "./accepted-terms";
import { WalletAccessError } from "./access";
import { resolveDevelopmentCancellationMarketplacePrincipal,
  type DevelopmentCancellationMarketplacePrincipal } from "./cancellation-marketplace-auth";
import {
  assertCancellationMarketplaceCoherence, bindCancellationMarketplaceCommand,
  insertCancellationMarketplaceCancellation, insertCancellationMarketplaceTransition,
  readCancellationMarketplaceCancellation, readCancellationMarketplacePredecessor, readCancellationMarketplaceTransition,
  registerCancellationMarketplaceContext,
  type CancellationMarketplaceCancellation, type CancellationMarketplaceContext,
  type CancellationMarketplaceOperation, type CancellationMarketplaceTransition,
} from "./cancellation-marketplace-coordination-store";
import { planDevelopmentMarketplaceCancellation } from "./cancellation-marketplace-plan";
import { walletDigest } from "./commands";
import { WalletIntegrityError } from "./durable";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import type { InitialMarketplaceAcceptance, InitialMarketplaceActivation } from "./initial-marketplace-coordination-store";
import { balance } from "./ledger";
import { developmentMarketplaceMobileCredentialsSchema } from "./marketplace-mobile-auth";
import { PrepaymentCancellationPlanningError } from "./prepayment-cancellation";
import { assertSimulationRuntime } from "./runtime";
import { isV3State } from "./v3-engine";
import { v4Command, WALLET_V4_ENGINE_VERSION } from "./v4-commands";
import { createCoordinatedV4DurableWallet, upgradeCoordinatedDurableWalletV4, type V4WalletSnapshot } from "./v4-durable";
import { isV4State, V4WalletError, type V4State } from "./v4-engine";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const webCredentials = { sessionToken: z.string().min(1).max(512), requestId: id };
const webOperation = { ...webCredentials, operationId: id };
const upgradeInput = z.strictObject({ ...webOperation, acknowledgeVersionUpgrade: z.literal(true) });
const cancelInput = z.strictObject(webOperation);
const inspectInput = z.strictObject(webCredentials);
const pauseInput = z.strictObject(webOperation);
const mobileCredentials = developmentMarketplaceMobileCredentialsSchema.shape;
const mobileUpgradeInput = z.strictObject({ ...upgradeInput.shape, ...mobileCredentials }).omit({ sessionToken: true });
const mobileCancelInput = z.strictObject({ ...cancelInput.shape, ...mobileCredentials }).omit({ sessionToken: true });
const mobileInspectInput = z.strictObject({ ...mobileCredentials, requestId: id });
const mobilePauseInput = z.strictObject({ ...mobileCredentials, requestId: id, operationId: id });

export type DevelopmentCancellationMarketplaceUpgradeInput = z.infer<typeof upgradeInput>;
export type DevelopmentCancellationMarketplaceCancellationInput = z.infer<typeof cancelInput>;
export type DevelopmentCancellationMarketplaceInspectionInput = z.infer<typeof inspectInput>;
export type DevelopmentCancellationMarketplacePauseInput = z.infer<typeof pauseInput>;
export type DevelopmentMobileCancellationMarketplaceUpgradeInput = z.infer<typeof mobileUpgradeInput>;
export type DevelopmentMobileCancellationMarketplaceCancellationInput = z.infer<typeof mobileCancelInput>;
export type DevelopmentMobileCancellationMarketplaceInspectionInput = z.infer<typeof mobileInspectInput>;
export type DevelopmentMobileCancellationMarketplacePauseInput = z.infer<typeof mobilePauseInput>;

type Options = { mode: "simulation-only"; store: WalletStore; clock?: () => number };
type CredentialInput = DevelopmentCancellationMarketplaceInspectionInput | DevelopmentMobileCancellationMarketplaceInspectionInput;
type Failure = "INVALID_INPUT" | "ACTOR" | "INTEGRITY" | "LOCKED" | "UNSUPPORTED" | "STALE" | "UPGRADE_REQUIRED"
  | "STORAGE_UNAVAILABLE" | "40001" | "40P01";
export class DevelopmentCancellationMarketplaceWalletError extends Error {
  constructor(readonly code: Failure, message: string) { super(message); this.name = "DevelopmentCancellationMarketplaceWalletError"; }
}
function check(value: unknown, code: Failure, message: string): asserts value {
  if (!value) throw new DevelopmentCancellationMarketplaceWalletError(code, message);
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  check(parsed.success, "INVALID_INPUT", "Invalid development cancellation marketplace input");
  return parsed.data;
}
function publicFailure(error: unknown): Error {
  if (error instanceof CommitOutcomeUnknownError) {
    return new CommitOutcomeUnknownError(new Error("Development cancellation transaction acknowledgement unavailable"));
  }
  if (error instanceof DevelopmentCancellationMarketplaceWalletError || error instanceof WalletAccessError
    || error instanceof WalletIntegrityError || error instanceof V4WalletError
    || error instanceof PrepaymentCancellationPlanningError || error instanceof AcceptedTermsPlanningError) return error;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "40001" || code === "40P01") {
    return new DevelopmentCancellationMarketplaceWalletError(code, "Development cancellation transaction retries were exhausted");
  }
  // Sanitize only after the real outer owner has applied its retry rules.
  return new DevelopmentCancellationMarketplaceWalletError("STORAGE_UNAVAILABLE", "Development cancellation marketplace storage could not complete the operation");
}
export const cancellationMarketplaceUpgradeFingerprint = (actorUserId: string, requestId: string) => walletDigest({
  kind: "alpha-wallet-initial-cancellation-upgrade-v1", actorUserId, requestId,
});
export const cancellationMarketplaceRequestFingerprint = (actorUserId: string, requestId: string) => walletDigest({
  kind: "alpha-wallet-initial-cancellation-request-v1", actorUserId, requestId,
});
const checkpoint = (snapshot: V4WalletSnapshot) => ({ revision: snapshot.revision, eventHash: snapshot.eventHash,
  stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs });

export type DevelopmentCancellationMarketplaceUpgradeReceipt = {
  kind: "alpha-wallet-development-cancellation-marketplace-upgrade-v1"; mode: "simulation-only"; replayed: boolean;
  requestId: string; walletRevision: number; walletEventHash: string; sourceRevision: number; sourceEventHash: string;
  engineVersion: typeof WALLET_V4_ENGINE_VERSION; sourcePaused: boolean;
};
function upgradeReceipt(row: CancellationMarketplaceTransition, replayed: boolean): DevelopmentCancellationMarketplaceUpgradeReceipt {
  return { kind: "alpha-wallet-development-cancellation-marketplace-upgrade-v1", mode: "simulation-only", replayed,
    requestId: row.requestId, walletRevision: row.walletRevision, walletEventHash: row.walletEventHash,
    sourceRevision: row.walletCheckpoint.revision, sourceEventHash: row.walletCheckpoint.eventHash,
    engineVersion: WALLET_V4_ENGINE_VERSION, sourcePaused: row.continuation.sourceHaltReason !== null };
}
export type DevelopmentCancellationMarketplaceReceipt = {
  kind: "alpha-wallet-development-cancellation-marketplace-receipt-v1"; mode: "simulation-only"; replayed: boolean;
  requestId: string; platformListingId: string; platformTradeId: string; walletListingId: string; walletTradeId: string;
  cancellationKey: string; acceptanceKey: string; actorUserId: string; actorKind: "seller" | "buyer";
  cancelledAt: string; principalRaw: string; listingAvailableAfterRaw: string; termsDigest: string;
  walletRevision: number; walletEventHash: string; publicationId: string;
};
function cancellationReceipt(row: CancellationMarketplaceCancellation, replayed: boolean): DevelopmentCancellationMarketplaceReceipt {
  const receipt = row.receipt;
  return { kind: "alpha-wallet-development-cancellation-marketplace-receipt-v1", mode: "simulation-only", replayed,
    requestId: receipt.platformRequestId, platformListingId: receipt.platformListingId, platformTradeId: receipt.platformTradeId,
    walletListingId: receipt.walletListingId, walletTradeId: receipt.walletTradeId,
    cancellationKey: receipt.cancellationKey, acceptanceKey: receipt.acceptanceKey, actorUserId: receipt.actorUserId,
    actorKind: receipt.actorKind, cancelledAt: new Date(receipt.cancelledAtMs).toISOString(),
    principalRaw: receipt.principalRaw, listingAvailableAfterRaw: receipt.listingAvailableAfterRaw,
    termsDigest: receipt.termsDigest, walletRevision: row.walletRevision, walletEventHash: row.walletEventHash,
    publicationId: row.publicationId };
}
export type DevelopmentCancellationMarketplaceInspection = {
  kind: "alpha-wallet-development-cancellation-marketplace-inspection-v1"; mode: "simulation-only"; requestId: string;
  marketplace: { listingId: string; tradeId: string; status: PurchaseRequest["status"] };
  wallet: { revision: number; eventHash: string; engineVersion: typeof WALLET_V4_ENGINE_VERSION; halted: boolean };
  transition: DevelopmentCancellationMarketplaceUpgradeReceipt;
  acceptance: { acceptanceKey: string; principalRaw: string; walletRevision: number; walletEventHash: string; publicationId: string };
  cancellation: DevelopmentCancellationMarketplaceReceipt | null;
  reservation: { listingAvailableRaw: string; tradeReservedRaw: string };
};
export type DevelopmentCancellationMarketplacePauseReceipt = {
  kind: "alpha-wallet-development-cancellation-marketplace-pause-v1"; mode: "simulation-only"; replayed: boolean;
  halted: true; walletRevision: number; walletEventHash: string;
};
function v4Snapshot(snapshot: V4WalletSnapshot): V4WalletSnapshot & { state: V4State } {
  check(isV4State(snapshot.state), "UPGRADE_REQUIRED", "An explicit owner cancellation-profile upgrade is required");
  return { ...snapshot, state: snapshot.state };
}
function verifyPredecessor(activation: InitialMarketplaceActivation, acceptance: InitialMarketplaceAcceptance,
  request: PurchaseRequest, snapshot: V4WalletSnapshot) {
  const state = snapshot.state;
  check((isV3State(state) || isV4State(state)) && request.tradeId
    && activation.requestId === request.id && activation.platformListingId === request.listingId
    && activation.platformTradeId === request.tradeId && activation.sellerId === request.sellerId
    && activation.buyerId === request.buyerId, "INTEGRITY", "Cancellation predecessor and canonical identities disagree");
  const binding = state.initialBindings.get(request.id), original = state.initialAcceptanceReceipts.get(acceptance.receipt.acceptanceKey);
  check(binding && original && state.initialBindings.size === 1 && state.initialAcceptanceReceipts.size === 1
    && binding.walletTradeId === activation.walletTradeId && binding.walletListingId === activation.walletListingId
    && binding.assetId === activation.assetId && binding.acceptanceKey === acceptance.receipt.acceptanceKey
    && walletDigest(original) === walletDigest(acceptance.receipt)
    && acceptance.actorUserId === request.sellerId && acceptance.walletRevision === original.commandRevision
    && acceptance.walletCommandKey === original.commandKey, "INTEGRITY", "Original coordinated and financial acceptance disagree");
}
function verifyTransition(row: CancellationMarketplaceTransition, snapshot: V4WalletSnapshot & { state: V4State }, requestId: string) {
  check(row.requestId === requestId && row.inputDigest === cancellationMarketplaceUpgradeFingerprint(row.actorUserId, requestId)
    && walletDigest(row.continuation) === walletDigest(snapshot.state.cancellationContinuation)
    && walletDigest(row.walletCheckpoint) === walletDigest(row.continuation.checkpoint)
    && row.walletRevision === row.continuation.commandRevision && row.walletCommandKey === row.continuation.commandKey,
  "INTEGRITY", "Cancellation profile transition and original V4 continuation disagree");
}
function verifyCancellation(row: CancellationMarketplaceCancellation, snapshot: V4WalletSnapshot & { state: V4State }, request: PurchaseRequest) {
  const receipt = row.receipt, original = snapshot.state.initialCancellationReceipts.get(receipt.cancellationKey);
  check(original && request.status === "cancelled" && receipt.platformRequestId === request.id
    && receipt.platformTradeId === request.tradeId && receipt.actorUserId === row.actorUserId
    && row.inputDigest === cancellationMarketplaceRequestFingerprint(row.actorUserId, request.id)
    && row.walletRevision === receipt.commandRevision && row.walletCommandKey === receipt.commandKey
    && walletDigest(original) === walletDigest(receipt), "INTEGRITY", "Coordinated cancellation and original financial receipt disagree");
}

type Attempt = { tx: WalletSql; participant: DevelopmentCancellationMarketplaceParticipant;
  request: PurchaseRequest & { tradeId: string }; context: CancellationMarketplaceContext;
  principal: DevelopmentCancellationMarketplacePrincipal };

/** Every nested participant shares the earliest physical transaction certificate. */
async function inCancellationAttempt<T>(mode: "simulation-only", raw: WalletSql,
  work: (tx: WalletSql) => Promise<T>): Promise<T> {
  let originalId: string | undefined;
  const assertOwner = async () => {
    const rows = (await raw.query<{ transaction_id: string; isolation: string; read_only: string; development_mode: string | null }>(
      `SELECT txid_current()::text AS transaction_id,current_setting('transaction_isolation') AS isolation,
        current_setting('transaction_read_only') AS read_only,current_setting('alpha_wallet.development_schema',true) AS development_mode
        /* cancellation coordinator: original attempt owner */`)).rows;
    const current = rows[0];
    check(rows.length === 1 && typeof current?.transaction_id === "string" && /^[1-9][0-9]*$/.test(current.transaction_id),
      "INTEGRITY", "Cancellation coordinator requires a physical transaction identity");
    check(originalId === undefined || originalId === current.transaction_id,
      "INTEGRITY", "Cancellation coordinator transaction identity changed or ended");
    originalId ??= current.transaction_id;
    check(current.isolation === "serializable" && current.read_only === "off" && current.development_mode === mode,
      "INTEGRITY", "Cancellation coordinator requires its original writable SERIALIZABLE simulation transaction");
    assertSimulationRuntime(mode);
  };
  const tx: WalletSql = {
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      await assertOwner(); const result = await raw.query<Row>(sql, values); await assertOwner(); return result;
    },
    async exec(sql: string) { await assertOwner(); await raw.exec(sql); await assertOwner(); },
  };
  try {
    await assertOwner(); await assertOwner();
    const result = await work(tx);
    await assertOwner();
    return result;
  } catch (error) {
    if (originalId !== undefined) {
      try {
        const rows = (await raw.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows;
        if (rows.length === 1 && rows[0]?.transaction_id === originalId) {
          await raw.query("SELECT 1 / 0 /* abort failed cancellation coordinator attempt */");
        }
      } catch { /* Preserve the initiating failure; a replacement is never a cleanup owner. */ }
    }
    throw error;
  }
}

/** Private stored-session coordinator. It installs no route, sender or signer. */
function createCoordinator(options: Options, credentialKind: "web" | "mobile") {
  assertSimulationRuntime(options.mode);
  const { mode, store } = options, suppliedClock = options.clock ?? Date.now;
  let previousClock: number | undefined;
  const clock = () => {
    assertSimulationRuntime(mode);
    const at = suppliedClock();
    check(Number.isSafeInteger(at) && at >= 0 && Number.isFinite(new Date(at).getTime())
      && (previousClock === undefined || at >= previousClock), "INVALID_INPUT", "Invalid or regressed development cancellation clock");
    previousClock = at;
    return at;
  };
  const walletAt = (context: CancellationMarketplaceContext, commandClock = clock) =>
    createCoordinatedV4DurableWallet({ mode, context, clock: commandClock });
  async function run<T>(input: CredentialInput, operation: CancellationMarketplaceOperation, work: (attempt: Attempt) => Promise<T>) {
    assertSimulationRuntime(mode);
    return store.transaction(raw => inCancellationAttempt(mode, raw, async tx => {
      let principal: DevelopmentCancellationMarketplacePrincipal | undefined;
      let context: CancellationMarketplaceContext | undefined;
      const result = await withDevelopmentCancellationMarketplaceInTransaction({ mode, tx, requestId: input.requestId }, async participant => {
        const request = participant.canonical.request;
        check(request.id === input.requestId && request.tradeId, "INTEGRITY", "One exact retained cancellation request and trade are required");
        principal = await resolveDevelopmentCancellationMarketplacePrincipal({ mode, tx, requestId: input.requestId, operation,
          credentials: "sessionToken" in input ? { kind: "web", sessionToken: input.sessionToken }
            : { kind: "mobile", accessToken: input.accessToken, metadata: input.metadata }, clock });
        context = await registerCancellationMarketplaceContext({ mode, tx, requestId: input.requestId,
          operation, actorUserId: principal.userId });
        const answer = await work({ tx, participant, request: request as PurchaseRequest & { tradeId: string }, context, principal });
        await principal.assertFresh();
        return answer;
      });
      check(principal && context, "INTEGRITY", "Cancellation coordinator did not complete its original transaction");
      await assertCancellationMarketplaceCoherence(context);
      await principal.assertFresh();
      return structuredClone(result);
    })).catch(error => { throw publicFailure(error); });
  }
  return Object.freeze({
    async upgradeRequest(raw: unknown): Promise<DevelopmentCancellationMarketplaceUpgradeReceipt> {
      const input = credentialKind === "web" ? parse(upgradeInput, raw) : parse(mobileUpgradeInput, raw);
      return run(input, "upgrade", async ({ participant, request, principal, context }) => {
        const inputDigest = cancellationMarketplaceUpgradeFingerprint(principal.userId, request.id);
        const old = await readCancellationMarketplaceTransition(context);
        const predecessor = await readCancellationMarketplacePredecessor(context);
        const snapshot = await walletAt(context).snapshot();
        verifyPredecessor(predecessor.activation, predecessor.acceptance, request, snapshot);
        if (old) {
          check(old.inputDigest === inputDigest && old.actorUserId === principal.userId, "STALE", "Cancellation upgrade identity was reused by a different owner");
          verifyTransition(old, v4Snapshot(snapshot), request.id);
          return upgradeReceipt(old, true);
        }
        check(isV3State(snapshot.state) && request.status === "accepted", "UNSUPPORTED", "Only the original accepted initial profile can be explicitly upgraded");
        const at = clock();
        check(at >= snapshot.lastCommandAtMs && at < principal.sessionExpiresAtMs, "LOCKED", "Current owner authority cannot authorize this continuation timestamp");
        const command = v4Command("continueFromV3", { kind: "operator", id: principal.userId }, input.operationId,
          { checkpoint: checkpoint(snapshot) });
        await bindCancellationMarketplaceCommand(context, command);
        await participant.authorizeUpgrade(context);
        const execution = await upgradeCoordinatedDurableWalletV4({ mode, context, command,
          acknowledgeVersionUpgrade: true, clock: () => at });
        check(!execution.replayed, "INTEGRITY", "A standalone continuation cannot authorize a new coordinated profile");
        return upgradeReceipt(await insertCancellationMarketplaceTransition(context, { inputDigest, execution }), false);
      });
    },
    async cancelRequest(raw: unknown): Promise<DevelopmentCancellationMarketplaceReceipt> {
      const input = credentialKind === "web" ? parse(cancelInput, raw) : parse(mobileCancelInput, raw);
      return run(input, "cancel", async ({ participant, request, principal, context }) => {
        const transition = await readCancellationMarketplaceTransition(context);
        check(transition, "UPGRADE_REQUIRED", "Explicit owner upgrade of this accepted request is required");
        const predecessor = await readCancellationMarketplacePredecessor(context);
        const snapshot = v4Snapshot(await walletAt(context).snapshot());
        verifyPredecessor(predecessor.activation, predecessor.acceptance, request, snapshot);
        verifyTransition(transition, snapshot, request.id);
        const inputDigest = cancellationMarketplaceRequestFingerprint(principal.userId, request.id);
        const old = await readCancellationMarketplaceCancellation(context);
        if (old) {
          check(old.inputDigest === inputDigest && old.actorUserId === principal.userId
            && old.receipt.actorKind === principal.actorKind, "STALE", "Cancellation identity was already used by a different participant");
          verifyCancellation(old, snapshot, request);
          return cancellationReceipt(old, true);
        }
        const cancelledAtMs = clock();
        check(cancelledAtMs < principal.sessionExpiresAtMs, "LOCKED", "Current participant authority cannot authorize this cancellation timestamp");
        const plan = planDevelopmentMarketplaceCancellation({ mode, actorUserId: principal.userId, requestId: request.id,
          operationId: input.operationId, cancelledAtMs, marketplace: participant.marketplace, canonical: participant.canonical,
          basis: participant.basis, digests: participant.digests, activation: predecessor.activation,
          acceptance: predecessor.acceptance, wallet: snapshot });
        check(plan.command.actor.kind === principal.actorKind, "ACTOR", "Current cancellation party and financial actor disagree");
        await bindCancellationMarketplaceCommand(context, plan.command);
        const execution = await walletAt(context, () => cancelledAtMs).execute(plan.command);
        check(!execution.replayed, "INTEGRITY", "A standalone financial result cannot authorize canonical cancellation");
        const canonical = await participant.cancel(context, plan.canonicalDecision);
        check(walletDigest(canonical) === walletDigest(plan.canonicalResult), "INTEGRITY", "Canonical cancellation differs from its original complete plan");
        return cancellationReceipt(await insertCancellationMarketplaceCancellation(context, { inputDigest, execution, canonical }), false);
      });
    },
    async inspect(raw: unknown): Promise<DevelopmentCancellationMarketplaceInspection> {
      const input = credentialKind === "web" ? parse(inspectInput, raw) : parse(mobileInspectInput, raw);
      return run(input, "inspect", async ({ request, context }) => {
        const transition = await readCancellationMarketplaceTransition(context);
        check(transition, "UPGRADE_REQUIRED", "Explicit owner cancellation-profile upgrade is required");
        const predecessor = await readCancellationMarketplacePredecessor(context);
        const snapshot = v4Snapshot(await walletAt(context).snapshot());
        verifyPredecessor(predecessor.activation, predecessor.acceptance, request, snapshot);
        verifyTransition(transition, snapshot, request.id);
        const cancelled = await readCancellationMarketplaceCancellation(context);
        if (cancelled) verifyCancellation(cancelled, snapshot, request);
        const { activation, acceptance } = predecessor;
        return { kind: "alpha-wallet-development-cancellation-marketplace-inspection-v1", mode, requestId: request.id,
          marketplace: { listingId: request.listingId, tradeId: request.tradeId, status: request.status },
          wallet: { revision: snapshot.revision, eventHash: snapshot.eventHash, engineVersion: WALLET_V4_ENGINE_VERSION,
            halted: snapshot.state.haltReason !== null }, transition: upgradeReceipt(transition, true),
          acceptance: { acceptanceKey: acceptance.receipt.acceptanceKey, principalRaw: acceptance.receipt.principalRaw,
            walletRevision: acceptance.walletRevision, walletEventHash: acceptance.walletEventHash, publicationId: acceptance.publicationId },
          cancellation: cancelled ? cancellationReceipt(cancelled, true) : null,
          reservation: { listingAvailableRaw: balance(snapshot.state, activation.assetId, `listing:${activation.walletListingId}`).toString(),
            tradeReservedRaw: balance(snapshot.state, activation.assetId, `trade:${activation.walletTradeId}`).toString() } };
      });
    },
    async pause(raw: unknown): Promise<DevelopmentCancellationMarketplacePauseReceipt> {
      const input = credentialKind === "web" ? parse(pauseInput, raw) : parse(mobilePauseInput, raw);
      return run(input, "pause", async ({ context, principal }) => {
        const wallet = walletAt(context);
        v4Snapshot(await wallet.snapshot());
        const command = v4Command("pause", { kind: "operator", id: principal.userId }, input.operationId, null);
        await bindCancellationMarketplaceCommand(context, command);
        const execution = await wallet.execute(command);
        return { kind: "alpha-wallet-development-cancellation-marketplace-pause-v1", mode, replayed: execution.replayed,
          halted: true, walletRevision: execution.revision, walletEventHash: execution.eventHash };
      });
    },
  });
}

export function createDevelopmentCancellationMarketplaceWalletCoordinator(options: Options) {
  const coordinator = createCoordinator(options, "web");
  return Object.freeze({
    upgradeRequest: (input: DevelopmentCancellationMarketplaceUpgradeInput) => coordinator.upgradeRequest(input),
    cancelRequest: (input: DevelopmentCancellationMarketplaceCancellationInput) => coordinator.cancelRequest(input),
    inspect: (input: DevelopmentCancellationMarketplaceInspectionInput) => coordinator.inspect(input),
    pause: (input: DevelopmentCancellationMarketplacePauseInput) => coordinator.pause(input),
  });
}
export function createDevelopmentMobileCancellationMarketplaceWalletCoordinator(options: Options) {
  const coordinator = createCoordinator(options, "mobile");
  return Object.freeze({
    upgradeRequest: (input: DevelopmentMobileCancellationMarketplaceUpgradeInput) => coordinator.upgradeRequest(input),
    cancelRequest: (input: DevelopmentMobileCancellationMarketplaceCancellationInput) => coordinator.cancelRequest(input),
    inspect: (input: DevelopmentMobileCancellationMarketplaceInspectionInput) => coordinator.inspect(input),
    pause: (input: DevelopmentMobileCancellationMarketplacePauseInput) => coordinator.pause(input),
  });
}
