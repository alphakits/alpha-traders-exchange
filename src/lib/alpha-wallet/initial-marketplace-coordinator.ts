import "server-only";

import { z } from "zod";
import {
  withDevelopmentInitialAcceptanceInTransaction, type DevelopmentInitialAcceptanceMarketplace,
  type DevelopmentInitialAcceptanceParticipant,
} from "@/lib/alpha-exchange-repository";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { AcceptedTermsPlanningError, describeDevelopmentTradeTerms, type DevelopmentTradeTerms } from "./accepted-terms";
import { WalletAccessError } from "./access";
import { assetFor, parseUnits } from "./amounts";
import { walletDigest } from "./commands";
import { WalletIntegrityError } from "./durable";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import { InitialAcceptancePlanningError, planDevelopmentInitialAcceptance } from "./initial-acceptance";
import {
  assertInitialMarketplaceCoherence, bindInitialMarketplaceCommand, insertInitialMarketplaceAcceptance,
  insertInitialMarketplaceActivation, readInitialMarketplaceAcceptance, readInitialMarketplaceActivation,
  registerInitialMarketplaceContext, type InitialMarketplaceAcceptance, type InitialMarketplaceActivation,
  type InitialMarketplaceContext, type InitialMarketplaceMapping, type InitialMarketplaceOperation,
} from "./initial-marketplace-coordination-store";
import { balance } from "./ledger";
import { resolveDevelopmentMarketplaceWebPrincipal, type DevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";
import { developmentMarketplaceMobileCredentialsSchema, resolveDevelopmentMarketplaceMobilePrincipal } from "./marketplace-mobile-auth";
import { assertSimulationRuntime } from "./runtime";
import { initialInputFromPlan, v3Command, WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { createV3DurableWallet, type V3WalletSnapshot } from "./v3-durable";
import { isV3State, V3WalletError, type V3State } from "./v3-engine";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const credentials = { sessionToken: z.string().min(1).max(512), requestId: id };
const operation = { ...credentials, operationId: id };
const activateInput = z.strictObject({ ...operation, walletListingId: id, walletTradeId: id,
  assetId: z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]) });
const acceptInput = z.strictObject({ ...operation, safetyAcknowledged: z.literal(true).optional() });
const inspectInput = z.strictObject(credentials);
const pauseInput = z.strictObject(operation);
const mobileCredentials = developmentMarketplaceMobileCredentialsSchema.shape;
const mobileActivateInput = z.strictObject({ ...activateInput.shape, ...mobileCredentials }).omit({ sessionToken: true });
const mobileAcceptInput = z.strictObject({ ...acceptInput.shape, ...mobileCredentials }).omit({ sessionToken: true });
const mobileInspectInput = z.strictObject({ ...mobileCredentials, requestId: id });
const mobilePauseInput = z.strictObject({ ...mobileCredentials, requestId: id, operationId: id });

export type DevelopmentInitialMarketplaceActivationInput = z.infer<typeof activateInput>;
export type DevelopmentInitialMarketplaceAcceptanceInput = z.infer<typeof acceptInput>;
export type DevelopmentInitialMarketplaceInspectionInput = z.infer<typeof inspectInput>;
export type DevelopmentInitialMarketplacePauseInput = z.infer<typeof pauseInput>;
export type DevelopmentMobileInitialMarketplaceActivationInput = z.infer<typeof mobileActivateInput>;
export type DevelopmentMobileInitialMarketplaceAcceptanceInput = z.infer<typeof mobileAcceptInput>;
export type DevelopmentMobileInitialMarketplaceInspectionInput = z.infer<typeof mobileInspectInput>;
export type DevelopmentMobileInitialMarketplacePauseInput = z.infer<typeof mobilePauseInput>;

type CoordinatorOptions = { mode: "simulation-only"; store: WalletStore; clock?: () => number };
type CredentialInput = DevelopmentInitialMarketplaceInspectionInput | DevelopmentMobileInitialMarketplaceInspectionInput;
type Failure = "INVALID_INPUT" | "ACTOR" | "INTEGRITY" | "LOCKED" | "UNSUPPORTED" | "STALE" | "ACTIVATION_REQUIRED"
  | "STORAGE_UNAVAILABLE" | "40001" | "40P01";
export class DevelopmentInitialMarketplaceWalletError extends Error {
  constructor(readonly code: Failure, message: string) { super(message); this.name = "DevelopmentInitialMarketplaceWalletError"; }
}
function check(value: unknown, code: Failure, message: string): asserts value {
  if (!value) throw new DevelopmentInitialMarketplaceWalletError(code, message);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  check(result.success, "INVALID_INPUT", "Invalid development initial marketplace input");
  return result.data;
}
function publicFailure(error: unknown): Error {
  if (error instanceof CommitOutcomeUnknownError) {
    return new CommitOutcomeUnknownError(new Error("Underlying development transaction acknowledgement unavailable"));
  }
  if (error instanceof DevelopmentInitialMarketplaceWalletError || error instanceof WalletAccessError
    || error instanceof InitialAcceptancePlanningError || error instanceof AcceptedTermsPlanningError
    || error instanceof V3WalletError || error instanceof WalletIntegrityError) return error;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "40001" || code === "40P01") {
    return new DevelopmentInitialMarketplaceWalletError(code, "Development initial marketplace transaction retries were exhausted");
  }
  // Driver errors may contain bank snapshots or authentication parameters. Only
  // the completed outer owner's failure is mapped, after its native retry rules.
  return new DevelopmentInitialMarketplaceWalletError("STORAGE_UNAVAILABLE", "Development initial marketplace storage could not complete the operation");
}
const activationFingerprint = (actorUserId: string, requestId: string, mapping: InitialMarketplaceMapping) => walletDigest({
  kind: "alpha-wallet-initial-marketplace-activation-v1", actorUserId, requestId,
  assetId: mapping.assetId, walletListingId: mapping.walletListingId, walletTradeId: mapping.walletTradeId,
});
const acceptanceFingerprint = (actorUserId: string, requestId: string, safetyAcknowledged: boolean) => walletDigest({
  kind: "alpha-wallet-initial-marketplace-acceptance-v1", actorUserId, requestId, safetyAcknowledged,
});

/** Explicit public projection: no sessions, full request, bank data or destination. */
export type DevelopmentInitialMarketplacePublicTerms = Pick<DevelopmentTradeTerms,
  "assetId" | "currency" | "paymentMethod" | "usdtAmount" | "pricePerUsdt" | "fiatAmount"
  | "principalRaw" | "buyerFeeRaw" | "sellerFeeRaw" | "totalFeeRaw" | "fiatTotalMinor">;
function publicTerms(terms: DevelopmentTradeTerms): DevelopmentInitialMarketplacePublicTerms {
  return { assetId: terms.assetId, currency: terms.currency, paymentMethod: terms.paymentMethod,
    usdtAmount: terms.usdtAmount, pricePerUsdt: terms.pricePerUsdt, fiatAmount: terms.fiatAmount,
    principalRaw: terms.principalRaw, buyerFeeRaw: terms.buyerFeeRaw, sellerFeeRaw: terms.sellerFeeRaw,
    totalFeeRaw: terms.totalFeeRaw, fiatTotalMinor: terms.fiatTotalMinor };
}
export type DevelopmentInitialMarketplaceActivationReceipt = {
  kind: "alpha-wallet-development-initial-marketplace-activation-v1"; mode: "simulation-only"; replayed: boolean;
  requestId: string; platformListingId: string; platformTradeId: string; walletListingId: string; walletTradeId: string;
  assetId: InitialMarketplaceMapping["assetId"]; walletRevision: number; walletEventHash: string;
};
function activationReceipt(row: InitialMarketplaceActivation, replayed: boolean): DevelopmentInitialMarketplaceActivationReceipt {
  return { kind: "alpha-wallet-development-initial-marketplace-activation-v1", mode: "simulation-only", replayed,
    requestId: row.requestId, platformListingId: row.platformListingId, platformTradeId: row.platformTradeId,
    walletListingId: row.walletListingId, walletTradeId: row.walletTradeId, assetId: row.assetId,
    walletRevision: row.walletCheckpoint.revision, walletEventHash: row.walletCheckpoint.eventHash };
}
export type DevelopmentInitialMarketplaceAcceptanceReceipt = {
  kind: "alpha-wallet-development-initial-marketplace-acceptance-v1"; mode: "simulation-only"; replayed: boolean;
  requestId: string; platformTradeId: string; walletTradeId: string; acceptanceKey: string; acceptedAt: string;
  walletRevision: number; walletEventHash: string; principalRaw: string; termsDigest: string; publicationId: string;
  terms: DevelopmentInitialMarketplacePublicTerms;
};
function acceptanceReceipt(row: InitialMarketplaceAcceptance, replayed: boolean): DevelopmentInitialMarketplaceAcceptanceReceipt {
  const receipt = row.receipt;
  return { kind: "alpha-wallet-development-initial-marketplace-acceptance-v1", mode: "simulation-only", replayed,
    requestId: receipt.platformRequestId, platformTradeId: receipt.platformTradeId, walletTradeId: receipt.walletTradeId,
    acceptanceKey: receipt.acceptanceKey, acceptedAt: new Date(receipt.acceptedAtMs).toISOString(),
    walletRevision: row.walletRevision, walletEventHash: row.walletEventHash, principalRaw: receipt.principalRaw,
    termsDigest: receipt.termsDigest, publicationId: row.publicationId, terms: publicTerms(receipt.input.terms) };
}
export type DevelopmentInitialMarketplaceInspection = {
  kind: "alpha-wallet-development-initial-marketplace-inspection-v1"; mode: "simulation-only"; requestId: string;
  marketplace: { listingId: string; tradeId: string; status: PurchaseRequest["status"] };
  wallet: { revision: number; eventHash: string; engineVersion: typeof WALLET_V3_ENGINE_VERSION; halted: boolean;
    haltReason: string | null; nonterminalTradeCount: number; unfinishedPayoutCount: number };
  activation: DevelopmentInitialMarketplaceActivationReceipt | null;
  acceptance: DevelopmentInitialMarketplaceAcceptanceReceipt | null;
  reservation: { listingAvailableRaw: string; tradeReservedRaw: string } | null;
};
export type DevelopmentInitialMarketplacePauseReceipt = {
  kind: "alpha-wallet-development-initial-marketplace-pause-v1"; mode: "simulation-only"; replayed: boolean;
  halted: true; walletRevision: number; walletEventHash: string;
};
const boundStore = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
function v3Snapshot(snapshot: V3WalletSnapshot): V3WalletSnapshot & { state: V3State } {
  check(isV3State(snapshot.state), "UNSUPPORTED", "Explicit development v3 continuation is required");
  return { ...snapshot, state: snapshot.state };
}
const checkpoint = (snapshot: V3WalletSnapshot) => ({ revision: snapshot.revision, eventHash: snapshot.eventHash,
  stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs });
function canonicalRequest(marketplace: DevelopmentInitialAcceptanceMarketplace, requestId: string) {
  const matches = marketplace.purchaseRequests.filter(request => request.id === requestId);
  check(matches.length === 1 && matches[0].tradeId, "INTEGRITY", "One exact canonical request with its retained trade identity is required");
  return matches[0] as PurchaseRequest & { tradeId: string };
}
function verifyActivation(row: InitialMarketplaceActivation, request: PurchaseRequest, snapshot: V3WalletSnapshot & { state: V3State }) {
  check(row.requestId === request.id && row.platformTradeId === request.tradeId && row.platformListingId === request.listingId
    && row.sellerId === request.sellerId && row.buyerId === request.buyerId
    && row.inputDigest === activationFingerprint(row.actorUserId, request.id, row)
    && row.walletCheckpoint.revision <= snapshot.revision, "INTEGRITY", "Initial activation and canonical wallet identities disagree");
  const listing = snapshot.state.listings.get(row.walletListingId);
  check(listing && listing.sellerId === row.sellerId && listing.assetId === row.assetId,
    "INTEGRITY", "The initial activated wallet listing no longer agrees");
}
function verifyAcceptance(row: InitialMarketplaceAcceptance, activation: InitialMarketplaceActivation, state: V3State, request: PurchaseRequest) {
  const receipt = row.receipt, replayed = state.initialAcceptanceReceipts.get(receipt.acceptanceKey);
  const binding = state.initialBindings.get(request.id);
  check(replayed && walletDigest(replayed) === walletDigest(receipt) && binding && binding.acceptanceKey === receipt.acceptanceKey
    && receipt.platformRequestId === request.id && receipt.platformTradeId === request.tradeId
    && receipt.actorUserId === request.sellerId && row.actorUserId === request.sellerId && receipt.buyerId === request.buyerId
    && receipt.walletTradeId === activation.walletTradeId && receipt.input.terms.walletListingId === activation.walletListingId
    && receipt.input.terms.assetId === activation.assetId && row.walletRevision === receipt.commandRevision
    && row.walletCommandKey === receipt.commandKey
    && row.inputDigest === acceptanceFingerprint(row.actorUserId, request.id, receipt.input.sellerAction.faceToFaceSafetyAcknowledged),
  "INTEGRITY", "Initial coordinated receipt and original wallet acceptance disagree");
}

/** Activation selects and freezes a mapping. Seller consent remains a later action. */
function validateActivation(marketplace: DevelopmentInitialAcceptanceMarketplace, request: PurchaseRequest,
  mapping: InitialMarketplaceMapping, snapshot: V3WalletSnapshot & { state: V3State }, atMs: number) {
  const state = snapshot.state, listing = state.listings.get(mapping.walletListingId);
  const canonical = marketplace.marketplaceListings.filter(row => row.id === request.listingId);
  check(request.status === "pending" && request.priceMode === "listing_price" && request.tradeId
    && canonical.length === 1 && canonical[0].status === "active" && canonical[0].approvalStatus === "approved"
    && canonical[0].activeTradeRequestId === undefined && canonical[0].sellerId === request.sellerId,
  "UNSUPPORTED", "Initial activation requires its ordinary unreserved approved canonical listing");
  const progressed: (keyof PurchaseRequest)[] = ["tradeCreatedAt", "usdtDemandId", "usdtDemandOfferId", "termsProposal", "priceOfferAcceptedAt",
    "firstSellerResponseAt", "paymentSentAt", "sensitivePaymentSharedAt", "sensitivePaymentKind", "fundsReceivedAt",
    "usdtReleaseStartedAt", "usdtReleaseDeadlineAt", "usdtSentAt", "completedAt", "timedOutAt", "timeoutReason",
    "buyerConfirmationArchivedAt", "lockedAt", "reviewUnlockedAt", "buyerEvidence", "sellerEvidence", "buyerReview",
    "sellerBuyerReview", "sellerResponse", "closedAt", "closedByUserId", "closeReason", "closeExplanation", "completionReceipt",
    "historicalCompletion", "buyerVolumeCredit", "trustReconciliation", "actionReminderState", "inactivityWarningSentAt",
    "sellerWiseAccountId", "buyerWiseAccountId", "sellerWiseAccountSnapshot", "buyerWiseAccountSnapshot"];
  check(progressed.every(key => request[key] === undefined) && request.cardlessCodeAwaitingBuyerConfirmation !== true
    && (request.amountAdjustmentCount === undefined || request.amountAdjustmentCount === 0)
    && (request.counterPrices === undefined || request.counterPrices.length === 0)
    && Array.isArray(request.timeline) && request.timeline.length === 1 && request.timeline[0].type === "request_submitted"
    && request.timeline[0].actorUserId === request.buyerId && request.timeline[0].createdAt === request.createdAt
    && request.buyerSafetyAcknowledged === true && request.bankTransferProvider !== "wise",
  "UNSUPPORTED", "Initial activation cannot freeze a request with prior negotiation or lifecycle progress");
  check(marketplace.tradeEvidenceFiles.length === 0 && marketplace.disputes.length === 0
    && !marketplace.commissionRecords.some(row => row.purchaseRequestId === request.id || row.tradeId === request.tradeId),
  "LOCKED", "Initial activation requires no target evidence, dispute or commission progress");
  const sourceListing = canonical[0];
  check(!sourceListing.closedAt && !sourceListing.expiredAt && !sourceListing.cancelledAt && !sourceListing.completedAt
    && !sourceListing.newRequestBlockReason && !sourceListing.blockingReason
    && (!sourceListing.expiresAt || Date.parse(sourceListing.expiresAt) > atMs),
  "LOCKED", "Initial activation requires an open unrestricted canonical listing");
  check(!marketplace.purchaseRequests.some(other => other.id !== request.id && other.listingId === request.listingId && isDemandReservedTrade(other)),
    "UNSUPPORTED", "Competing target-listing reservations require separate identity bindings");
  check(state.haltReason === null && state.initialBindings.size === 0 && state.initialAcceptanceReceipts.size === 0,
    "LOCKED", "Initial activation requires an unpaused v3 wallet without standalone initial acceptance");
  check(listing && listing.sellerId === request.sellerId && listing.assetId === mapping.assetId
    && listing.approved && listing.funded && !listing.closed && !state.trades.has(mapping.walletTradeId),
  "INTEGRITY", "Initial activation requires its approved and funded same-seller wallet listing and unused trade identity");
  const scale = BigInt(10) ** BigInt(assetFor(mapping.assetId).decimals - 6);
  check(balance(state, mapping.assetId, `listing:${mapping.walletListingId}`) === parseUnits(canonical[0].availableAmount, 6) * scale,
    "INTEGRITY", "Initial activation requires equal complete canonical and funded wallet inventory");
  check(![...state.payouts.values()].some(payout => !["confirmed", "failed_final"].includes(payout.state)),
    "LOCKED", "Unfinished payouts must be resolved before initial activation");
  const terms = describeDevelopmentTradeTerms({ mode: "simulation-only", request,
    assetId: mapping.assetId, walletListingId: mapping.walletListingId }).terms;
  check((terms.paymentMethod === "Bank Transfer" || terms.paymentMethod === "Face-to-Face (Meet in Person)")
    && terms.platformTradeId === request.tradeId && terms.listingPriceAtRequest === terms.pricePerUsdt,
  "UNSUPPORTED", "Initial activation requires retained ordinary bank or face-to-face terms");
}

type Attempt = {
  tx: WalletSql; participant: DevelopmentInitialAcceptanceParticipant; request: PurchaseRequest & { tradeId: string };
  principal: DevelopmentMarketplaceWebPrincipal; context: InitialMarketplaceContext;
};

/**
 * Private, separately versioned development coordinator. Stored web/mobile
 * authority, complete canonical evidence and v3 replay share one transaction.
 * No endpoint, live migration, provider, actual account or delivery is installed.
 */
function createCoordinator(options: CoordinatorOptions, credentialKind: "web" | "mobile") {
  assertSimulationRuntime(options.mode);
  const { mode, store } = options;
  const suppliedClock = options.clock ?? Date.now;
  let lastClock: number | undefined;
  const clock = () => {
    assertSimulationRuntime(mode);
    const at = suppliedClock();
    check(Number.isSafeInteger(at) && at >= 0 && Number.isFinite(new Date(at).getTime())
      && (lastClock === undefined || at >= lastClock), "INVALID_INPUT", "Invalid or regressed development initial coordinator clock");
    lastClock = at;
    return at;
  };
  const walletAt = (tx: WalletSql, commandClock = clock) => createV3DurableWallet({ mode, store: boundStore(tx), clock: commandClock });
  async function run<T>(input: CredentialInput, operationName: InitialMarketplaceOperation, work: (attempt: Attempt) => Promise<T>) {
    assertSimulationRuntime(mode);
    return store.transaction(async tx => {
      let principal: DevelopmentMarketplaceWebPrincipal | undefined;
      let context: InitialMarketplaceContext | undefined;
      const result = await withDevelopmentInitialAcceptanceInTransaction({ mode, tx, requestId: input.requestId }, async participant => {
        const request = canonicalRequest(participant.marketplace, input.requestId);
        principal = "sessionToken" in input
          ? await resolveDevelopmentMarketplaceWebPrincipal({ mode, tx, token: input.sessionToken, clock })
          : await resolveDevelopmentMarketplaceMobilePrincipal({ mode, tx, accessToken: input.accessToken, metadata: input.metadata, clock });
        if (operationName === "accept") check(principal.canSell && principal.userId === request.sellerId,
          "ACTOR", "Only the freshly authenticated canonical seller with selling access may accept this request");
        else check(principal.isOwner, "ACTOR", "This development initial marketplace operation requires the authenticated owner");
        context = await registerInitialMarketplaceContext({ mode, tx, requestId: request.id,
          operation: operationName, actorUserId: principal.userId });
        const answer = await work({ tx, participant, request, principal, context });
        await principal.assertFresh();
        return answer;
      });
      check(context && principal, "INTEGRITY", "Initial coordinator did not complete its owned transaction");
      // The participant has now checked its complete dependency basis after the
      // actual canonical writes. Deferred SQL repeats financial coherence at COMMIT.
      await assertInitialMarketplaceCoherence(context);
      await principal.assertFresh();
      return structuredClone(result);
    }).catch(error => { throw publicFailure(error); });
  }
  return Object.freeze({
    async activateRequest(raw: unknown): Promise<DevelopmentInitialMarketplaceActivationReceipt> {
      const input = credentialKind === "web" ? parse(activateInput, raw) : parse(mobileActivateInput, raw);
      return run(input, "activate", async ({ tx, participant, request, principal, context }) => {
        const inputDigest = activationFingerprint(principal.userId, request.id, input);
        const old = await readInitialMarketplaceActivation(context);
        const snapshot = v3Snapshot(await walletAt(tx).snapshot());
        if (old) {
          check(old.inputDigest === inputDigest && old.actorUserId === principal.userId, "STALE", "Initial activation identity was reused with different input");
          verifyActivation(old, request, snapshot);
          return activationReceipt(old, true);
        }
        validateActivation(participant.marketplace, request, input, snapshot, clock());
        const row = await insertInitialMarketplaceActivation(context, { inputDigest,
          mapping: { assetId: input.assetId, walletListingId: input.walletListingId, walletTradeId: input.walletTradeId },
          walletCheckpoint: checkpoint(snapshot) });
        verifyActivation(row, request, snapshot);
        return activationReceipt(row, false);
      });
    },
    async acceptRequest(raw: unknown): Promise<DevelopmentInitialMarketplaceAcceptanceReceipt> {
      const input = credentialKind === "web" ? parse(acceptInput, raw) : parse(mobileAcceptInput, raw);
      return run(input, "accept", async ({ tx, participant, request, principal, context }) => {
        const activation = await readInitialMarketplaceActivation(context);
        check(activation, "ACTIVATION_REQUIRED", "Explicit owner activation of this initial request is required");
        check(request.paymentMethod !== "Bank Transfer" || input.safetyAcknowledged === undefined,
          "INVALID_INPUT", "Seller cash-meeting consent belongs only to a face-to-face request");
        const inputDigest = acceptanceFingerprint(principal.userId, request.id, input.safetyAcknowledged === true);
        const old = await readInitialMarketplaceAcceptance(context);
        const snapshot = v3Snapshot(await walletAt(tx).snapshot());
        verifyActivation(activation, request, snapshot);
        if (old) {
          check(old.inputDigest === inputDigest && old.actorUserId === principal.userId, "STALE", "Initial acceptance identity was reused with different input");
          verifyAcceptance(old, activation, snapshot.state, request);
          return acceptanceReceipt(old, true);
        }
        check(!snapshot.state.initialBindings.has(request.id), "INTEGRITY", "A wallet-only acceptance cannot authorize canonical marketplace mutation");
        const acceptedAtMs = clock();
        check(acceptedAtMs < principal.sessionExpiresAtMs, "LOCKED", "The stored seller session cannot authorize this acceptance timestamp");
        const plan = planDevelopmentInitialAcceptance({ mode, actorUserId: principal.userId, requestId: request.id,
          operationId: input.operationId, acceptedAtMs, safetyAcknowledged: input.safetyAcknowledged === true,
          mapping: { assetId: activation.assetId, walletListingId: activation.walletListingId, walletTradeId: activation.walletTradeId },
          marketplace: participant.marketplace,
          wallet: { state: snapshot.state, revision: snapshot.revision, eventHash: snapshot.eventHash } });
        check(plan.requiredExecutionContract === "seller-initial-acceptance-v3", "UNSUPPORTED", "The seller-native v3 contract is required");
        const command = v3Command("acceptInitialSellerRequest", { kind: "seller", id: principal.userId }, input.operationId, initialInputFromPlan(plan));
        await bindInitialMarketplaceCommand(context, command);
        const execution = await walletAt(tx, () => acceptedAtMs).execute(command);
        check(!execution.replayed, "INTEGRITY", "A prior standalone wallet command cannot authorize initial canonical acceptance");
        const canonical = await participant.accept(plan.canonicalAcceptance);
        const row = await insertInitialMarketplaceAcceptance(context, { inputDigest, execution, canonical });
        return acceptanceReceipt(row, false);
      });
    },
    async inspect(raw: unknown): Promise<DevelopmentInitialMarketplaceInspection> {
      const input = credentialKind === "web" ? parse(inspectInput, raw) : parse(mobileInspectInput, raw);
      return run(input, "inspect", async ({ tx, request, context }) => {
        const activation = await readInitialMarketplaceActivation(context);
        const accepted = await readInitialMarketplaceAcceptance(context);
        const snapshot = v3Snapshot(await walletAt(tx).snapshot());
        if (activation) verifyActivation(activation, request, snapshot);
        if (accepted) {
          check(activation, "INTEGRITY", "An initial receipt requires its original activation");
          verifyAcceptance(accepted, activation, snapshot.state, request);
        }
        return { kind: "alpha-wallet-development-initial-marketplace-inspection-v1", mode, requestId: request.id,
          marketplace: { listingId: request.listingId, tradeId: request.tradeId, status: request.status },
          wallet: { revision: snapshot.revision, eventHash: snapshot.eventHash, engineVersion: WALLET_V3_ENGINE_VERSION,
            halted: snapshot.state.haltReason !== null, haltReason: snapshot.state.haltReason,
            nonterminalTradeCount: [...snapshot.state.trades.values()].filter(trade => !["completed", "cancelled"].includes(trade.status)).length,
            unfinishedPayoutCount: [...snapshot.state.payouts.values()].filter(payout => !["confirmed", "failed_final"].includes(payout.state)).length },
          activation: activation ? activationReceipt(activation, true) : null,
          acceptance: accepted ? acceptanceReceipt(accepted, true) : null,
          reservation: activation ? { listingAvailableRaw: balance(snapshot.state, activation.assetId, `listing:${activation.walletListingId}`).toString(),
            tradeReservedRaw: balance(snapshot.state, activation.assetId, `trade:${activation.walletTradeId}`).toString() } : null };
      });
    },
    async pause(raw: unknown): Promise<DevelopmentInitialMarketplacePauseReceipt> {
      const input = credentialKind === "web" ? parse(pauseInput, raw) : parse(mobilePauseInput, raw);
      return run(input, "pause", async ({ tx, principal, context }) => {
        const wallet = walletAt(tx);
        v3Snapshot(await wallet.snapshot());
        const command = v3Command("pause", { kind: "operator", id: principal.userId }, input.operationId, null);
        await bindInitialMarketplaceCommand(context, command);
        const execution = await wallet.execute(command);
        return { kind: "alpha-wallet-development-initial-marketplace-pause-v1", mode, replayed: execution.replayed,
          halted: true, walletRevision: execution.revision, walletEventHash: execution.eventHash };
      });
    },
  });
}

/** Fixed stored web sessions; callers never supply actors, prices or wallet state. */
export function createDevelopmentInitialMarketplaceWalletCoordinator(options: CoordinatorOptions) {
  const coordinator = createCoordinator(options, "web");
  return Object.freeze({
    activateRequest: (input: DevelopmentInitialMarketplaceActivationInput) => coordinator.activateRequest(input),
    acceptRequest: (input: DevelopmentInitialMarketplaceAcceptanceInput) => coordinator.acceptRequest(input),
    inspect: (input: DevelopmentInitialMarketplaceInspectionInput) => coordinator.inspect(input),
    pause: (input: DevelopmentInitialMarketplacePauseInput) => coordinator.pause(input),
  });
}
/** Separate fixed mobile authority; refused mobile credentials never fall back to web. */
export function createDevelopmentMobileInitialMarketplaceWalletCoordinator(options: CoordinatorOptions) {
  const coordinator = createCoordinator(options, "mobile");
  return Object.freeze({
    activateRequest: (input: DevelopmentMobileInitialMarketplaceActivationInput) => coordinator.activateRequest(input),
    acceptRequest: (input: DevelopmentMobileInitialMarketplaceAcceptanceInput) => coordinator.acceptRequest(input),
    inspect: (input: DevelopmentMobileInitialMarketplaceInspectionInput) => coordinator.inspect(input),
    pause: (input: DevelopmentMobileInitialMarketplacePauseInput) => coordinator.pause(input),
  });
}
