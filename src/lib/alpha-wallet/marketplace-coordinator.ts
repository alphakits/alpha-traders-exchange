import "server-only";

import { z } from "zod";
import { mutateDevelopmentFocusedTradeInTransaction } from "@/lib/alpha-exchange-repository";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import type { AlphaExchangeDb, PurchaseRequest } from "@/types/alpha-exchange";
import {
  AcceptedTermsPlanningError, DEVELOPMENT_TERMS_BINDING_VERSION, describeDevelopmentTradeTerms, planAcceptedAmountTerms,
  type DevelopmentTradeTerms, type DevelopmentTermsBinding,
} from "./accepted-terms";
import { walletDigest } from "./commands";
import { WalletAccessError } from "./access";
import { WalletIntegrityError } from "./durable";
import { CommitOutcomeUnknownError, type WalletSql, type WalletStore } from "./durable-store";
import { balance } from "./ledger";
import { resolveDevelopmentMarketplaceWebPrincipal, type DevelopmentMarketplaceWebPrincipal } from "./marketplace-auth";
import {
  assertMarketplaceCoherence, bindMarketplaceCommand, insertMarketplaceAcceptance, insertMarketplaceEnrollment,
  readMarketplaceAcceptance, readMarketplaceEnrollment, registerMarketplaceContext,
  type MarketplaceAcceptance, type MarketplaceContext, type MarketplaceEnrollment,
} from "./marketplace-coordination-store";
import { assertSimulationRuntime } from "./runtime";
import { acceptanceInputFromPlan, v2Command, type V2Command } from "./v2-commands";
import { isV2State, planningBindingFor, V2WalletError, type V2AcceptanceReceipt, type V2State } from "./v2-engine";
import { createVersionedDurableWallet, type VersionedWalletSnapshot } from "./versioned-durable";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const credentials = { sessionToken: z.string().min(1).max(512), requestId: id };
const operation = { ...credentials, operationId: id };
const enrollmentInput = z.strictObject({ ...operation, walletListingId: id, walletTradeId: id,
  assetId: z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]) });
const acceptanceInput = z.strictObject({ ...operation, proposalId: id, expectedBindingRevision: z.number().int().min(0).max(2) });
const inspectInput = z.strictObject(credentials);
const pauseInput = z.strictObject(operation);

export type DevelopmentMarketplaceEnrollmentInput = z.infer<typeof enrollmentInput>;
export type DevelopmentMarketplaceAcceptanceInput = z.infer<typeof acceptanceInput>;
export type DevelopmentMarketplaceInspectionInput = z.infer<typeof inspectInput>;
export type DevelopmentMarketplacePauseInput = z.infer<typeof pauseInput>;

type Failure = "INVALID_INPUT" | "ACTOR" | "INTEGRITY" | "LOCKED" | "UNSUPPORTED" | "STALE" | "ENROLLMENT_REQUIRED"
  | "STORAGE_UNAVAILABLE" | "40001" | "40P01";
export class DevelopmentMarketplaceWalletError extends Error {
  constructor(readonly code: Failure, message: string) { super(message); this.name = "DevelopmentMarketplaceWalletError"; }
}
function check(value: unknown, code: Failure, message: string): asserts value {
  if (!value) throw new DevelopmentMarketplaceWalletError(code, message);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  check(parsed.success, "INVALID_INPUT", "Invalid development marketplace wallet input");
  return parsed.data;
}
function publicFailure(error: unknown): Error {
  if (error instanceof CommitOutcomeUnknownError) {
    return new CommitOutcomeUnknownError(new Error("Underlying development transaction acknowledgement unavailable"));
  }
  if (error instanceof DevelopmentMarketplaceWalletError || error instanceof WalletAccessError
    || error instanceof AcceptedTermsPlanningError || error instanceof V2WalletError || error instanceof WalletIntegrityError) return error;
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "40001" || code === "40P01") {
    return new DevelopmentMarketplaceWalletError(code, "Development marketplace transaction retries were exhausted");
  }
  // SQL drivers may attach parameters, row details and canonical bank snapshots.
  // Only the completed outer owner's failure crosses this boundary, so native
  // retry classification and unknown-COMMIT handling keep their existing rules.
  return new DevelopmentMarketplaceWalletError("STORAGE_UNAVAILABLE", "Development marketplace storage could not complete the operation");
}
function enrollmentFingerprint(actorUserId: string, input: Pick<DevelopmentMarketplaceEnrollmentInput,
  "requestId" | "walletListingId" | "walletTradeId" | "assetId">) {
  return walletDigest({ kind: "marketplace-enrollment-v1", actorUserId, requestId: input.requestId,
    walletListingId: input.walletListingId, walletTradeId: input.walletTradeId, assetId: input.assetId });
}
function acceptanceFingerprint(actorUserId: string, input: Pick<DevelopmentMarketplaceAcceptanceInput,
  "requestId" | "proposalId" | "expectedBindingRevision">) {
  return walletDigest({ kind: "marketplace-amount-acceptance-v1", actorUserId, requestId: input.requestId,
    proposalId: input.proposalId, expectedBindingRevision: input.expectedBindingRevision });
}

/** Receipt terms deliberately exclude receiving destinations and private payment instructions. */
export type DevelopmentMarketplacePublicTerms = Pick<DevelopmentTradeTerms,
  "assetId" | "currency" | "paymentMethod" | "usdtAmount" | "pricePerUsdt" | "fiatAmount"
  | "principalRaw" | "buyerFeeRaw" | "sellerFeeRaw" | "totalFeeRaw" | "fiatTotalMinor">;
function publicTerms(terms: DevelopmentTradeTerms): DevelopmentMarketplacePublicTerms {
  return { assetId: terms.assetId, currency: terms.currency, paymentMethod: terms.paymentMethod,
    usdtAmount: terms.usdtAmount, pricePerUsdt: terms.pricePerUsdt, fiatAmount: terms.fiatAmount,
    principalRaw: terms.principalRaw, buyerFeeRaw: terms.buyerFeeRaw, sellerFeeRaw: terms.sellerFeeRaw,
    totalFeeRaw: terms.totalFeeRaw, fiatTotalMinor: terms.fiatTotalMinor };
}

export type DevelopmentMarketplaceEnrollmentReceipt = {
  kind: "alpha-wallet-development-marketplace-enrollment-v1"; mode: "simulation-only"; replayed: boolean;
  requestId: string; listingId: string; walletListingId: string; walletTradeId: string;
  bindingRevision: number; termsDigest: string; walletRevision: number; walletEventHash: string;
  terms: DevelopmentMarketplacePublicTerms;
};
function enrollmentReceipt(row: MarketplaceEnrollment, replayed: boolean): DevelopmentMarketplaceEnrollmentReceipt {
  return { kind: "alpha-wallet-development-marketplace-enrollment-v1", mode: "simulation-only", replayed,
    requestId: row.binding.platformRequestId, listingId: row.binding.platformListingId,
    walletListingId: row.binding.walletListingId, walletTradeId: row.binding.walletTradeId,
    bindingRevision: row.binding.revision, termsDigest: row.binding.termsDigest,
    walletRevision: row.walletRevision, walletEventHash: row.walletEventHash, terms: publicTerms(row.binding.terms) };
}

export type DevelopmentMarketplaceAcceptanceReceipt = {
  kind: "alpha-wallet-development-marketplace-acceptance-v1"; mode: "simulation-only"; replayed: boolean;
  acceptanceKey: string; requestId: string; proposalId: string; walletTradeId: string;
  bindingRevision: number; termsDigest: string; walletRevision: number; walletEventHash: string;
  principalDeltaRaw: string; transferAmountRaw: string; acceptedAt: string; publicationId: string;
  terms: DevelopmentMarketplacePublicTerms;
};
function acceptanceReceipt(row: MarketplaceAcceptance, replayed: boolean): DevelopmentMarketplaceAcceptanceReceipt {
  const receipt = row.receipt;
  return { kind: "alpha-wallet-development-marketplace-acceptance-v1", mode: "simulation-only", replayed,
    acceptanceKey: receipt.acceptanceKey, requestId: receipt.platformRequestId, proposalId: receipt.proposalId,
    walletTradeId: receipt.walletTradeId, bindingRevision: receipt.bindingRevision, termsDigest: receipt.acceptedTermsDigest,
    walletRevision: row.walletRevision, walletEventHash: row.walletEventHash,
    principalDeltaRaw: receipt.principalDeltaRaw, transferAmountRaw: receipt.transferAmountRaw,
    acceptedAt: new Date(receipt.acceptedAtMs).toISOString(), publicationId: row.publicationId, terms: publicTerms(receipt.terms) };
}

export type DevelopmentMarketplaceInspection = {
  kind: "alpha-wallet-development-marketplace-inspection-v1"; mode: "simulation-only"; requestId: string;
  marketplace: { listingId: string; status: PurchaseRequest["status"]; proposalId: string | null; proposalStatus: string | null };
  wallet: { revision: number; eventHash: string; engineVersion: V2State["engineVersion"]; halted: boolean;
    haltReason: string | null; nonterminalTradeCount: number; unfinishedPayoutCount: number };
  enrollment: { walletListingId: string; walletTradeId: string; bindingRevision: number; termsDigest: string;
    listingAvailableRaw: string; tradeReservedRaw: string; terms: DevelopmentMarketplacePublicTerms } | null;
};
export type DevelopmentMarketplacePauseReceipt = {
  kind: "alpha-wallet-development-marketplace-pause-v1"; mode: "simulation-only"; replayed: boolean;
  halted: true; walletRevision: number; walletEventHash: string;
};

function v2Snapshot(snapshot: VersionedWalletSnapshot): VersionedWalletSnapshot & { state: V2State } {
  check(isV2State(snapshot.state), "UNSUPPORTED", "Explicit development v2 continuation is required");
  return { ...snapshot, state: snapshot.state };
}
function checkpoint(snapshot: VersionedWalletSnapshot) {
  return { revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state),
    lastCommandAtMs: snapshot.lastCommandAtMs };
}
const boundStore = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
const nonterminalTrades = (state: V2State) => [...state.trades.values()].filter(trade => !["completed", "cancelled"].includes(trade.status));
const unfinishedPayouts = (state: V2State) => [...state.payouts.values()].filter(payout => !["confirmed", "failed_final"].includes(payout.state));
function canonicalRequest(db: AlphaExchangeDb, requestId: string) {
  const matches = db.purchaseRequests.filter(request => request.id === requestId);
  check(matches.length === 1, "INTEGRITY", "A canonical request ID, not a trade alias, is required");
  return matches[0]!;
}
function canonicalPlanningData(db: AlphaExchangeDb) {
  // SQL aggregation order is unspecified. Sort copies without changing the
  // focused participant's strictly preserved collection order.
  const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { purchaseRequests: sorted(db.purchaseRequests), marketplaceListings: sorted(db.marketplaceListings),
    tradeEvidenceFiles: sorted(db.tradeEvidenceFiles), disputes: sorted(db.disputes) };
}

/** Prove that the seller-scoped canonical reader did not omit another listing reservation. */
async function assertCompleteListing(tx: WalletSql, db: AlphaExchangeDb, request: PurchaseRequest) {
  const inventory = db.purchaseRequests.filter(item => item.listingId === request.listingId);
  const rows = (await tx.query<{ id: string; trade_id: string | null; listing_id: string; seller_id: string; buyer_id: string; status: string }>(
    `SELECT id,trade_id,listing_id,seller_id,buyer_id,status FROM alpha_exchange.purchase_requests WHERE listing_id=$1 ORDER BY id`,
    [request.listingId])).rows;
  check(rows.length === inventory.length && new Set(inventory.map(item => item.id)).size === rows.length,
    "INTEGRITY", "Canonical listing inventory is incomplete");
  for (const row of rows) {
    const item = inventory.find(candidate => candidate.id === row.id);
    check(item && row.listing_id === item.listingId && row.seller_id === item.sellerId && row.buyer_id === item.buyerId
      && row.status === item.status && row.trade_id === (item.tradeId ?? null) && item.sellerId === request.sellerId,
    "INTEGRITY", "Canonical inventory payload and normalized identity disagree");
  }
  const listings = db.marketplaceListings.filter(listing => listing.id === request.listingId);
  const listingRows = (await tx.query<{ id: string; seller_id: string; normalized: Record<string, unknown> }>(
    "SELECT id,seller_id,to_jsonb(l) AS normalized FROM alpha_exchange.listings l WHERE id=$1", [request.listingId])).rows;
  check(listings.length === 1 && listingRows.length === 1 && listingRows[0].seller_id === request.sellerId,
    "INTEGRITY", "Canonical listing ownership disagrees");
  const normalized = listingRows[0].normalized;
  check((!Object.hasOwn(normalized, "status") || normalized.status === listings[0].status)
    && (!Object.hasOwn(normalized, "active_trade_request_id")
      || normalized.active_trade_request_id === (listings[0].activeTradeRequestId ?? null)),
  "INTEGRITY", "Canonical listing normalized status or active reservation disagrees with its payload");
  check(db.tradeEvidenceFiles.length === 0, "LOCKED", "Canonical evidence locks amount correction");
  check(db.disputes.every(dispute => dispute.purchaseRequestId === request.id),
    "INTEGRITY", "Canonical dispute identity disagrees");
  // A seller-scoped payload read cannot prove absence when retained normalized
  // identities disagree. Read all physical target links before declaring clean.
  const commissions = await tx.query(`SELECT id FROM alpha_exchange.commissions WHERE purchase_request_id=$1
    OR payload->>'purchaseRequestId'=$1 OR payload->>'tradeId'=$2`, [request.id, request.tradeId ?? request.id]);
  check(commissions.rows.length === 0, "LOCKED", "Canonical commission progress locks amount correction");
  const trades = (await tx.query<{ id: string; purchase_request_id: string; listing_id: string; seller_id: string;
    buyer_id: string; status: string; completed_at: string | null; payload: Record<string, unknown> }>(
    `SELECT id,purchase_request_id,listing_id,seller_id,buyer_id,status,payload,to_jsonb(t)->>'completed_at' AS completed_at
      FROM alpha_exchange.trades t WHERE purchase_request_id=$1 OR payload->>'purchaseRequestId'=$1
      OR id=$2 OR payload->>'id'=$2`, [request.id, request.tradeId ?? request.id])).rows;
  check(trades.length <= 1, "INTEGRITY", "Canonical trade projection identity is ambiguous");
  for (const trade of trades) {
    const payload = trade.payload;
    check(payload && typeof payload === "object" && !Array.isArray(payload)
      && trade.id === (request.tradeId ?? request.id) && trade.purchase_request_id === request.id
      && trade.listing_id === request.listingId && trade.seller_id === request.sellerId && trade.buyer_id === request.buyerId
      && trade.status === request.status && trade.completed_at === null
      && payload.id === trade.id && payload.purchaseRequestId === request.id && payload.listingId === request.listingId
      && payload.sellerId === request.sellerId && payload.buyerId === request.buyerId && payload.status === request.status
      && (payload.completedAt === undefined || payload.completedAt === null)
      && walletDigest(payload.timeline ?? []) === walletDigest(request.timeline ?? []),
    "INTEGRITY", "Canonical trade projection contradicts the clean reservation");
  }
}

function supportedTerms(terms: DevelopmentTradeTerms) {
  check(terms.paymentMethod === "Bank Transfer" || terms.paymentMethod === "Face-to-Face (Meet in Person)",
    "UNSUPPORTED", "The initial development cohort supports bank transfer and face-to-face amount corrections only");
}

function verifyEnrollment(row: MarketplaceEnrollment, state: V2State, request: PurchaseRequest) {
  const binding = state.termsBindings.get(request.id);
  check(binding && row.binding.platformRequestId === request.id && row.binding.platformListingId === request.listingId
    && row.binding.terms.buyerId === request.buyerId && row.binding.terms.sellerId === request.sellerId
    && row.binding.revision === 0 && row.walletRevision === row.binding.enrollmentCommandRevision
    && row.walletCommandKey === row.binding.enrollmentCommandKey
    && binding.enrollmentCommandRevision === row.walletRevision && binding.enrollmentCommandKey === row.walletCommandKey
    && binding.enrollmentTermsDigest === row.binding.termsDigest && binding.walletTradeId === row.binding.walletTradeId
    && binding.walletListingId === row.binding.walletListingId && binding.assetId === row.binding.assetId,
  "INTEGRITY", "Marketplace enrollment and verified wallet history disagree");
  check(row.inputDigest === enrollmentFingerprint(row.actorUserId, { requestId: row.binding.platformRequestId,
    walletListingId: row.binding.walletListingId, walletTradeId: row.binding.walletTradeId, assetId: row.binding.assetId }),
  "INTEGRITY", "Retained marketplace enrollment input digest disagrees with its verified binding");
  return binding;
}
function verifyAcceptance(row: MarketplaceAcceptance, state: V2State, request: PurchaseRequest, actorUserId: string) {
  const receipt = state.acceptanceReceipts.get(row.receipt.acceptanceKey);
  check(receipt && walletDigest(receipt) === walletDigest(row.receipt) && receipt.platformRequestId === request.id
    && receipt.actorUserId === actorUserId && row.actorUserId === actorUserId && receipt.terms.buyerId === request.buyerId
    && receipt.terms.sellerId === request.sellerId && receipt.terms.platformListingId === request.listingId
    && row.walletRevision === receipt.commandRevision && row.walletCommandKey === receipt.commandKey,
  "INTEGRITY", "Marketplace acceptance and verified wallet history disagree");
  check(row.inputDigest === acceptanceFingerprint(receipt.actorUserId, { requestId: receipt.platformRequestId,
    proposalId: receipt.proposalId, expectedBindingRevision: receipt.bindingRevision - 1 }),
  "INTEGRITY", "Retained marketplace acceptance input digest disagrees with its verified receipt");
}

function acceptCanonicalRequest(db: AlphaExchangeDb, request: PurchaseRequest, receipt: V2AcceptanceReceipt) {
  const proposal = request.termsProposal;
  check(proposal && proposal.id === receipt.proposalId && proposal.status === "pending" && proposal.kind === "amount_correction",
    "STALE", "The canonical pending amount proposal changed");
  const actor = db.users.filter(user => user.id === receipt.actorUserId);
  check(actor.length === 1, "INTEGRITY", "Canonical buyer profile is missing or ambiguous");
  const at = new Date(receipt.acceptedAtMs).toISOString();
  check(Date.parse(at) > Date.parse(request.updatedAt), "INTEGRITY", "Accepted terms require a later canonical timestamp");
  const messageId = `wallet-message-${receipt.acceptanceKey}`;
  const notificationId = `wallet-notification-${receipt.acceptanceKey}`;
  const auditId = `wallet-audit-${receipt.acceptanceKey}`;
  const message = `Trade terms accepted: ${receipt.terms.usdtAmount} USDT for ${receipt.terms.currency} ${receipt.terms.fiatAmount}.`;
  request.usdtAmount = receipt.terms.usdtAmount;
  request.fiatAmount = receipt.terms.fiatAmount;
  request.pricePerUsdt = receipt.terms.pricePerUsdt;
  proposal.status = "accepted";
  proposal.resolvedAt = at;
  request.updatedAt = at;
  // request.messages is the canonical persisted history. The legacy in-memory
  // tradeMessages fallback is deliberately outside this focused write set.
  request.messages = [{ id: messageId, purchaseRequestId: request.id, kind: "system", senderUserId: receipt.actorUserId,
    senderRole: actor[0].role, message, createdAt: at, readByUserIds: [] }, ...(request.messages ?? [])];
  db.notifications.push({ id: notificationId, userId: request.sellerId, category: "trade", title: "Trade proposal updated",
    message, isRead: false, relatedRequestId: request.id, relatedTradeId: request.tradeId,
    relatedListingId: request.listingId, createdAt: at });
  db.auditLogs.push({ id: auditId, actorUserId: receipt.actorUserId, action: "trade_amount_correction_accepted", purchaseRequestId: request.id,
    listingId: request.listingId, details: message, reason: "development_wallet_amount_acceptance", createdAt: at });
  return { notificationIds: [notificationId], auditId, messageId };
}

type Attempt = {
  tx: WalletSql; db: AlphaExchangeDb; request: PurchaseRequest;
  principal: DevelopmentMarketplaceWebPrincipal; context: MarketplaceContext;
};

/**
 * Private, explicitly development-only transaction owner. It never initializes
 * storage, activates a route, sends a notification, invokes a provider, upgrades
 * the wallet, or accepts caller-created identity/financial terms.
 *
 * The first cohort has one active canonical reservation on its listing and one
 * nonterminal wallet trade globally. A valid stored amount proposal must already
 * exist. Unsupported lifecycle/proposal writers remain fenced after enrollment.
 */
export function createDevelopmentMarketplaceWalletCoordinator(options: {
  mode: "simulation-only"; store: WalletStore; clock?: () => number;
}) {
  assertSimulationRuntime(options.mode);
  const { mode, store } = options;
  const suppliedClock = options.clock ?? Date.now;
  const clock = () => {
    assertSimulationRuntime(mode);
    const at = suppliedClock();
    check(Number.isSafeInteger(at) && at >= 0 && Number.isFinite(new Date(at).getTime()), "INVALID_INPUT", "Invalid development coordinator clock");
    return at;
  };
  const walletAt = (tx: WalletSql, commandClock = clock) => createVersionedDurableWallet({ mode, store: boundStore(tx), clock: commandClock });

  async function run<T>(input: DevelopmentMarketplaceInspectionInput, operationName: "enroll" | "accept" | "inspect" | "pause",
    work: (attempt: Attempt) => Promise<T>): Promise<T> {
    assertSimulationRuntime(mode);
    return store.transaction(async tx => {
      // Attempt-local values cannot escape a failed SERIALIZABLE retry.
      let principal: DevelopmentMarketplaceWebPrincipal | undefined;
      let context: MarketplaceContext | undefined;
      let result: T | undefined;
      await mutateDevelopmentFocusedTradeInTransaction({ mode, tx, requestId: input.requestId }, async db => {
        const request = canonicalRequest(db, input.requestId);
        principal = await resolveDevelopmentMarketplaceWebPrincipal({ mode, tx, token: input.sessionToken, clock });
        if (operationName === "accept") check(principal.canBuy && principal.userId === request.buyerId,
          "ACTOR", "Only the freshly authenticated canonical buyer may accept this proposal");
        else check(principal.isOwner, "ACTOR", "This development operation requires the authenticated owner");
        context = await registerMarketplaceContext({ mode, tx, requestId: request.id, operation: operationName, actorUserId: principal.userId });
        result = await work({ tx, db, request, principal, context });
        await principal.assertFresh();
        return db;
      });
      check(context && principal && result !== undefined, "INTEGRITY", "Development coordinator did not complete its owned transaction");
      // These checks run after the actual marketplace UPDATE/events and before
      // the only owner may COMMIT. Unknown COMMIT outcomes propagate unchanged.
      await assertMarketplaceCoherence(context);
      await principal.assertFresh();
      return structuredClone(result);
    }).catch(error => { throw publicFailure(error); });
  }

  return Object.freeze({
    async enrollReservedTrade(raw: DevelopmentMarketplaceEnrollmentInput): Promise<DevelopmentMarketplaceEnrollmentReceipt> {
      const input = parse(enrollmentInput, raw);
      return run(input, "enroll", async ({ tx, db, request, principal, context }) => {
        const inputDigest = enrollmentFingerprint(principal.userId, input);
        const old = await readMarketplaceEnrollment(context);
        const wallet = walletAt(tx);
        const snapshot = v2Snapshot(await wallet.snapshot());
        if (old) {
          check(old.inputDigest === inputDigest && old.actorUserId === principal.userId, "STALE", "Enrollment identity was reused with different input");
          verifyEnrollment(old, snapshot.state, request);
          return enrollmentReceipt(old, true);
        }
        check(request.status === "accepted", "UNSUPPORTED", "Initial enrollment requires an already accepted request");
        check(!snapshot.state.termsBindings.has(request.id), "INTEGRITY", "A standalone wallet enrollment cannot become canonical marketplace authority");
        const live = nonterminalTrades(snapshot.state);
        check(live.length === 1 && live[0].id === input.walletTradeId, "UNSUPPORTED", "The initial cohort requires one nonterminal wallet trade globally");
        check(unfinishedPayouts(snapshot.state).length === 0, "LOCKED", "Unfinished payouts must be resolved before cohort enrollment");
        await assertCompleteListing(tx, db, request);
        check(!db.purchaseRequests.some(other => other.id !== request.id && other.listingId === request.listingId && isDemandReservedTrade(other)),
          "UNSUPPORTED", "The initial listing cohort supports only its single canonical reservation");
        const description = describeDevelopmentTradeTerms({ mode, request, assetId: input.assetId, walletListingId: input.walletListingId });
        supportedTerms(description.terms);
        const trade = snapshot.state.trades.get(input.walletTradeId);
        check(trade, "INTEGRITY", "Canonical enrollment requires its existing wallet reservation");
        const binding: DevelopmentTermsBinding = { version: DEVELOPMENT_TERMS_BINDING_VERSION, platformRequestId: request.id,
          platformListingId: request.listingId, walletListingId: input.walletListingId, assetId: input.assetId, revision: 0,
          termsDigest: description.digest, reservation: { kind: "reserved", walletTradeId: input.walletTradeId, walletTradeDigest: walletDigest(trade) } };
        check(request.termsProposal?.status === "pending" && request.termsProposal.kind === "amount_correction",
          "UNSUPPORTED", "Initial enrollment requires an existing pending amount correction");
        // This planner result authorizes nothing. It validates the existing
        // canonical proposal/cohort before owner enrollment; buyer consent is
        // separately authenticated inside acceptAmountCorrection.
        planAcceptedAmountTerms({ mode, actorUserId: request.buyerId, requestId: request.id, proposalId: request.termsProposal.id,
          expectedBindingRevision: 0, marketplace: canonicalPlanningData(db), wallet: snapshot, binding });
        const command = v2Command("enrollReservedTrade", { kind: "operator", id: principal.userId }, input.operationId,
          { walletTradeId: input.walletTradeId, terms: description.terms, termsDigest: description.digest,
            expectedWallet: checkpoint(snapshot), walletTradeDigest: walletDigest(trade) });
        await bindMarketplaceCommand(context, command);
        const execution = await wallet.execute(command);
        check(!execution.replayed, "INTEGRITY", "A prior wallet-only command cannot enroll canonical marketplace rows");
        return enrollmentReceipt(await insertMarketplaceEnrollment(context, { inputDigest, execution }), false);
      });
    },

    async acceptAmountCorrection(raw: DevelopmentMarketplaceAcceptanceInput): Promise<DevelopmentMarketplaceAcceptanceReceipt> {
      const input = parse(acceptanceInput, raw);
      return run(input, "accept", async ({ tx, db, request, principal, context }) => {
        const inputDigest = acceptanceFingerprint(principal.userId, input);
        const enrollment = await readMarketplaceEnrollment(context);
        check(enrollment, "ENROLLMENT_REQUIRED", "Explicit canonical marketplace enrollment is required");
        // Immutable public-input identity is checked before current proposal,
        // payment, pause, revision or amount eligibility. Transport IDs may vary.
        const old = await readMarketplaceAcceptance(context, input.proposalId);
        const snapshot = v2Snapshot(await walletAt(tx).snapshot());
        verifyEnrollment(enrollment, snapshot.state, request);
        if (old) {
          check(old.inputDigest === inputDigest, "STALE", "Acceptance identity was reused with different input");
          verifyAcceptance(old, snapshot.state, request, principal.userId);
          return acceptanceReceipt(old, true);
        }
        check(request.status === "accepted", "UNSUPPORTED", "Only an already reserved accepted request may accept a correction");
        await assertCompleteListing(tx, db, request);
        const binding = planningBindingFor(snapshot.state, request.id);
        supportedTerms(snapshot.state.termsBindings.get(request.id)!.terms);
        const plan = planAcceptedAmountTerms({ mode, actorUserId: principal.userId, requestId: request.id, proposalId: input.proposalId,
          expectedBindingRevision: input.expectedBindingRevision, marketplace: canonicalPlanningData(db), wallet: snapshot, binding });
        const command = v2Command("acceptAmountCorrection", { kind: "buyer", id: principal.userId }, input.operationId, acceptanceInputFromPlan(plan));
        await bindMarketplaceCommand(context, command);
        const commandClock = () => {
          const at = clock();
          check(at > Date.parse(request.updatedAt), "STALE", "The trusted acceptance clock must be later than the canonical proposal update");
          check(at < principal.sessionExpiresAtMs, "LOCKED", "The authenticated session cannot authorize this acceptance timestamp");
          return at;
        };
        const execution = await walletAt(tx, commandClock).execute(command);
        check(!execution.replayed, "INTEGRITY", "A prior wallet-only acceptance cannot authorize canonical marketplace mutation");
        const publication = acceptCanonicalRequest(db, request, execution.result);
        return acceptanceReceipt(await insertMarketplaceAcceptance(context, { inputDigest, execution, publication }), false);
      });
    },

    async inspect(raw: DevelopmentMarketplaceInspectionInput): Promise<DevelopmentMarketplaceInspection> {
      const input = parse(inspectInput, raw);
      return run(input, "inspect", async ({ tx, request, context }) => {
        const row = await readMarketplaceEnrollment(context);
        const snapshot = v2Snapshot(await walletAt(tx).snapshot());
        const binding = row ? verifyEnrollment(row, snapshot.state, request) : undefined;
        return { kind: "alpha-wallet-development-marketplace-inspection-v1", mode, requestId: request.id,
          marketplace: { listingId: request.listingId, status: request.status, proposalId: request.termsProposal?.id ?? null,
            proposalStatus: request.termsProposal?.status ?? null },
          wallet: { revision: snapshot.revision, eventHash: snapshot.eventHash, engineVersion: snapshot.state.engineVersion,
            halted: snapshot.state.haltReason !== null, haltReason: snapshot.state.haltReason,
            nonterminalTradeCount: nonterminalTrades(snapshot.state).length, unfinishedPayoutCount: unfinishedPayouts(snapshot.state).length },
          enrollment: binding ? { walletListingId: binding.walletListingId, walletTradeId: binding.walletTradeId,
            bindingRevision: binding.revision, termsDigest: binding.termsDigest,
            listingAvailableRaw: balance(snapshot.state, binding.assetId, `listing:${binding.walletListingId}`).toString(),
            tradeReservedRaw: balance(snapshot.state, binding.assetId, `trade:${binding.walletTradeId}`).toString(), terms: publicTerms(binding.terms) } : null };
      });
    },

    async pause(raw: DevelopmentMarketplacePauseInput): Promise<DevelopmentMarketplacePauseReceipt> {
      const input = parse(pauseInput, raw);
      return run(input, "pause", async ({ tx, principal, context }) => {
        const wallet = walletAt(tx);
        v2Snapshot(await wallet.snapshot());
        const command: V2Command = v2Command("pause", { kind: "operator", id: principal.userId }, input.operationId, null);
        await bindMarketplaceCommand(context, command);
        const execution = await wallet.execute(command);
        return { kind: "alpha-wallet-development-marketplace-pause-v1", mode, replayed: execution.replayed,
          halted: true, walletRevision: execution.revision, walletEventHash: execution.eventHash };
      });
    },
  });
}

export type DevelopmentMarketplaceWalletCoordinator = ReturnType<typeof createDevelopmentMarketplaceWalletCoordinator>;
