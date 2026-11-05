import "server-only";

import { z } from "zod";
import { hasAdultConfirmation } from "@/lib/age-eligibility";
import { normalizeMarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import { isAccountPhoneVerificationExempt } from "@/lib/phone-verification-exemptions";
import { MAX_SELLER_ACTIVE_TRADES } from "@/lib/requestable-listing";
import { hasRole } from "@/lib/roles";
import { hasSellerOperationalAccess } from "@/lib/seller-approval-verification";
import { areTradeAmountsLocked } from "@/lib/trade-amount-lock";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import { hasVerifiedPhone } from "@/lib/verification-bypass";
import type {
  AlphaExchangeUser, CommissionRecord, MarketplaceEnforcementRecord, MarketplaceListing, PurchaseRequest,
  SellerReviewRecord, TradeDisputeCase, TradeEvidenceFile,
} from "@/types/alpha-exchange";
import { AcceptedTermsPlanningError, describeDevelopmentTradeTerms, type DevelopmentTermsDescription } from "./accepted-terms";
import { assetFor, parseUnits, ZERO, type AssetId } from "./amounts";
import { walletDigest } from "./commands";
import { assertLedgerInvariants, balance } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import type { State } from "./types";
import { assertV2Invariants, isV2State } from "./v2-engine";
import { assertV3Invariants, isV3State } from "./v3-engine";

export const DEVELOPMENT_INITIAL_ACCEPTANCE_VERSION = "alpha-wallet-development-initial-acceptance-plan-v1" as const;
type Frozen<T> = T extends object ? { readonly [K in keyof T]: Frozen<T[K]> } : T;

/**
 * Explicit dependencies, never optional/default-empty collections. A transaction
 * reader must supply all of the seller's listings and requests, all of the
 * buyer's requests across sellers, both parties' commissions, their accounts,
 * seller enforcement, and the target's evidence/disputes. Legacy in-memory
 * reviews must be supplied explicitly; canonical SQL reviews are embedded in
 * requests and there is no seller_reviews table.
 *
 * Structural validation cannot prove that a caller supplied every row. A future
 * coordinator must own a fenced read and verified wallet replay, authenticate
 * the seller, and revalidate these exact dependencies before any execution.
 */
export type DevelopmentInitialAcceptanceMarketplace = {
  users: readonly AlphaExchangeUser[];
  marketplaceListings: readonly MarketplaceListing[];
  purchaseRequests: readonly PurchaseRequest[];
  commissionRecords: readonly CommissionRecord[];
  sellerReviews: readonly SellerReviewRecord[];
  marketplaceEnforcementRecords: readonly MarketplaceEnforcementRecord[];
  tradeEvidenceFiles: readonly Pick<TradeEvidenceFile, "id" | "purchaseRequestId" | "side">[];
  disputes: readonly Pick<TradeDisputeCase, "id" | "purchaseRequestId" | "status">[];
};

export type DevelopmentInitialAcceptanceContext = {
  mode: "simulation-only";
  actorUserId: string;
  requestId: string;
  /** Transport metadata only; excluded from business acceptance identity/digests. */
  operationId: string;
  /** Explicit trusted planner clock. No wall-clock read occurs in this module. */
  acceptedAtMs: number;
  safetyAcknowledged: boolean;
  mapping: { assetId: AssetId; walletListingId: string; walletTradeId: string };
  marketplace: DevelopmentInitialAcceptanceMarketplace;
  wallet: { state: State; revision: number; eventHash: string };
};

export type DevelopmentInitialAcceptanceDecision = {
  requestId: string; actorUserId: string; tradeId: string; acceptedAtMs: number; safetyAcknowledged?: true;
};

export type DevelopmentInitialAcceptancePlan = Frozen<{
  kind: typeof DEVELOPMENT_INITIAL_ACCEPTANCE_VERSION;
  mode: "simulation-only";
  executionAuthority: false;
  /** Neither the action nor retained request provenance is an authentication proof or signature. */
  requiredExecutionContract: "seller-initial-acceptance-not-implemented" | "seller-initial-acceptance-v3";
  acceptanceKey: string;
  inputDigest: string;
  actorUserId: string;
  requestId: string;
  plannedAtMs: number;
  canonicalAcceptance: DevelopmentInitialAcceptanceDecision;
  terms: DevelopmentTermsDescription;
  sellerAction: {
    kind: "initial_seller_acceptance"; requestedByUserId: string; requestId: string;
    faceToFaceSafetyAcknowledged: boolean;
  };
  buyerRequestEvidence: {
    kind: "retained_canonical_request"; requestId: string; tradeId: string; buyerId: string; createdAt: string;
    requestDigest: string; submissionTimelineEntryId: string; submissionTimelineDigest: string; termsDigest: string;
    feePolicyVersion: string; commissionCalculationVersion: string; buyerSafetyAcknowledged: boolean;
  };
  pricing: { source: "retained_request"; walletListingPrice: string; requiresFrozenPriceTransition: boolean };
  preconditions: {
    requestUpdatedAt: string; requestDigest: string; listingDigest: string; marketplaceDigest: string;
    usersDigest: string; sellerInventoryDigest: string; buyerHistoryDigest: string; commissionsDigest: string;
    legacyReviewsDigest: string; enforcementDigest: string; evidenceDigest: string; disputesDigest: string;
    walletRevision: number; walletEventHash: string; walletStateDigest: string; walletListingDigest: string;
    sellerActiveTradeCount: number; walletSellerActiveTradeCount: number;
  };
  reservation: {
    action: "reserve"; assetId: AssetId; walletListingId: string; walletTradeId: string;
    principalRaw: string; transferAmountRaw: string; fromAccount: string; toAccount: string;
    expectedListingAvailableRaw: string; expectedTradeReservedRaw: "0"; availableForRequestRaw: string;
  };
}>;

export class InitialAcceptancePlanningError extends Error {
  constructor(readonly code: "INVALID" | "UNSUPPORTED" | "ACTOR" | "STALE" | "LOCKED" | "INTEGRITY" | "UNAVAILABLE", message: string) {
    super(message); this.name = "InitialAcceptancePlanningError";
  }
}
function reject(code: InitialAcceptancePlanningError["code"], message: string): never { throw new InitialAcceptancePlanningError(code, message); }
function check(value: unknown, code: InitialAcceptancePlanningError["code"], message: string): asserts value {
  if (!value) reject(code, message);
}
function freeze<T>(value: T): Frozen<T> {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value as Frozen<T>;
}
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const timestamp = z.string().datetime({ offset: true }).refine(value => Date.parse(value) > 0);
const roles = z.enum(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"]);
const statuses = z.enum(["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "completed", "locked", "review_open", "declined", "cancelled"]);
const row = z.record(z.string(), z.unknown());
const contextShape = z.strictObject({
  mode: z.literal("simulation-only"), actorUserId: id, requestId: id, operationId: id,
  acceptedAtMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).refine(value => Number.isFinite(new Date(value).getTime())),
  safetyAcknowledged: z.boolean(),
  mapping: z.strictObject({ assetId: z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]), walletListingId: id, walletTradeId: id }),
  marketplace: z.strictObject({ users: z.array(row), marketplaceListings: z.array(row), purchaseRequests: z.array(row),
    commissionRecords: z.array(row), sellerReviews: z.array(row), marketplaceEnforcementRecords: z.array(row),
    tradeEvidenceFiles: z.array(row), disputes: z.array(row) }),
  wallet: z.strictObject({ state: row, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), eventHash: z.string().regex(/^[a-f0-9]{64}$/) }),
});
const accountShape = z.object({ id, email: z.string().min(1), role: roles, roles: z.array(roles).optional(),
  sellerStatus: z.enum(["buyer", "pending_seller_approval", "approved_seller", "rejected", "suspended"]),
  disabled: z.boolean().optional(), emailVerified: z.boolean().optional(), isProfileHidden: z.boolean().optional(),
  availabilityStatus: z.enum(["available", "away", "vacation"]), blockedUserIds: z.array(id).optional(),
  verifiedPhone: z.string().optional(), phoneVerifiedAt: timestamp.optional(),
  ageEligibility: z.object({ method: z.literal("self_attestation_v1"), confirmedAt: timestamp }).strict().optional(),
  createdAt: timestamp, updatedAt: timestamp,
}).passthrough();
const requestShape = z.object({ id, listingId: id, sellerId: id, buyerId: id, tradeId: id.optional(), status: statuses,
  usdtAmount: z.string(), currency: z.string(), network: z.enum(["TRC20", "BEP20", "ERC20", "SOL"]),
  paymentMethod: z.string(), usdtDemandId: id.optional(), usdtDemandOfferId: id.optional(),
  bankTransferProvider: z.enum(["israeli_bank", "wise"]).optional(),
  buyerConfirmationArchivedAt: timestamp.optional(), buyerSafetyAcknowledged: z.boolean().optional(), sellerSafetyAcknowledged: z.boolean().optional(),
  sensitivePaymentKind: z.enum(["bank_details", "cardless_code"]).optional(), sensitivePaymentSharedAt: timestamp.optional(),
  cardlessCodeAwaitingBuyerConfirmation: z.boolean().optional(),
  buyerReview: z.object({ reviewerUserId: id, rating: z.number().int().min(1).max(5), comment: z.string(), createdAt: timestamp }).passthrough().optional(),
  createdAt: timestamp, updatedAt: timestamp,
}).passthrough();
const listingShape = z.object({ id, sellerId: id, originalAmount: z.string(), availableAmount: z.string(), price: z.string(),
  currency: z.string(), network: z.enum(["TRC20", "BEP20", "ERC20", "SOL"]), status: z.string(), minimumTrade: z.string(), maximumTrade: z.string(),
  activeTradeRequestId: id.optional(), lockedAt: timestamp.optional(), expiresAt: timestamp.optional(),
  createdAt: timestamp, updatedAt: timestamp,
}).passthrough();
const reviewShape = z.object({ id, tradeId: id, buyerId: id, sellerId: id, rating: z.number().int().min(1).max(5),
  comment: z.string(), createdAt: timestamp, updatedAt: timestamp }).passthrough();
const commissionShape = z.object({ id, sellerId: id, paymentStatus: z.enum(["pending", "overdue", "paid"]),
  purchaseRequestId: id.optional(), tradeId: id.optional(), buyerId: id.optional(), createdAt: timestamp, updatedAt: timestamp,
}).passthrough();
const enforcementShape = z.object({ id, sellerId: id, status: z.enum(["active", "resolved_paid", "resolved_removed", "revoked"]),
  issuedAt: timestamp, createdAt: timestamp, updatedAt: timestamp }).passthrough();
const evidenceShape = z.object({ id, purchaseRequestId: id, side: z.enum(["buyer", "seller"]) }).passthrough();
const disputeShape = z.object({ id, purchaseRequestId: id, status: z.enum(["open", "resolved"]) }).passthrough();

function validateRows<T extends { id: string }>(items: readonly T[], schema: z.ZodType, label: string, at: number) {
  const seen = new Set<string>();
  for (const item of items) {
    check(schema.safeParse(item).success, "INVALID", `Malformed canonical ${label}`);
    check(!seen.has(item.id), "INTEGRITY", `Duplicate canonical ${label} identity`); seen.add(item.id);
    const record = item as Record<string, unknown>;
    if (record.createdAt !== undefined) {
      const created = Date.parse(record.createdAt as string), updated = Date.parse(record.updatedAt as string);
      check(created <= updated && updated < at, "STALE", `Canonical ${label} chronology is outside the acceptance clock`);
    }
  }
}
function unique<T extends { id: string }>(items: readonly T[], identity: string, label: string): T {
  const matches = items.filter(item => item.id === identity);
  check(matches.length === 1, "INTEGRITY", `Exactly one canonical ${label} is required`); return matches[0]!;
}
const sorted = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id, "en"));
function quantity(value: string, label: string) {
  try {
    const amount = parseUnits(value, 6);
    check(value.split(".")[0]!.length <= 9, "UNSUPPORTED", `${label} exceeds marketplace precision`);
    return amount;
  } catch (error) {
    if (error instanceof InitialAcceptancePlanningError) throw error;
    return reject("INVALID", `Invalid exact ${label}`);
  }
}
function accountEligible(account: AlphaExchangeUser, at: number) {
  check(account.disabled !== true && account.emailVerified === true, "LOCKED", "Both participants need enabled email-verified accounts");
  check(hasAdultConfirmation(account), "LOCKED", "Both participants need retained adult confirmation");
  check(hasVerifiedPhone(account) || isAccountPhoneVerificationExempt(account), "LOCKED", "Both participants need canonical phone verification or an exact account exemption");
  check(Date.parse(account.ageEligibility!.confirmedAt) <= at
    && (!account.phoneVerifiedAt || Date.parse(account.phoneVerifiedAt) <= at), "STALE", "Participant verification is dated after the acceptance clock");
}

function validateWalletShape(state: State) {
  for (const key of ["accounts", "depositIntents", "deposits", "listings", "trades", "payouts", "commissions", "receipts", "evidenceOwners", "idempotency", "reconciliations"] as const) {
    check(state[key] instanceof Map, "INVALID", "Malformed wallet replay maps");
  }
  const assetId = z.enum(["tron-sim-usdt", "bsc-sim-binance-peg-usdt"]);
  for (const [key, amount] of state.accounts) {
    check(typeof key === "string" && /^(tron-sim-usdt|bsc-sim-binance-peg-usdt)\|[^|]+$/.test(key)
      && typeof amount === "bigint", "INVALID", "Malformed wallet account entry");
  }
  for (const [key, value] of state.listings) check(z.object({ id, sellerId: id, assetId, currency: z.literal("ILS"),
    amountRaw: z.bigint().positive(), price: z.string(), approved: z.boolean(), funded: z.boolean(), closed: z.boolean() }).strict().safeParse(value).success
    && key === value.id, "INVALID", "Malformed wallet listing entry");
  for (const [key, value] of state.trades) check(z.object({ id, listingId: id, sellerId: id, buyerId: id, assetId,
    currency: z.literal("ILS"), destination: z.string().min(1), amountRaw: z.bigint().positive(), buyerFeeRaw: z.bigint().nonnegative(),
    sellerFeeRaw: z.bigint().nonnegative(), totalFeeRaw: z.bigint().nonnegative(), fiatTotalMinor: z.bigint().positive(), disputed: z.boolean(),
    status: z.enum(["reserved", "payment_reported", "payment_verified", "release_authorized", "payout_pending", "completed", "cancelled"]),
  }).passthrough().safeParse(value).success && key === value.id && value.sellerId !== value.buyerId
    && value.totalFeeRaw === value.buyerFeeRaw + value.sellerFeeRaw, "INVALID", "Malformed wallet trade entry");
  for (const [key, value] of state.commissions) check(z.object({ tradeId: id, sellerId: id, assetId, amountRaw: z.bigint().positive(),
    paid: z.boolean() }).strict().safeParse(value).success && key === value.tradeId, "INVALID", "Malformed wallet commission entry");
  for (const [key, value] of state.payouts) check(z.object({ id: z.string().min(1), assetId, sellerId: id,
    kind: z.enum(["trade", "withdrawal"]), tradeId: id.optional(), amountRaw: z.bigint().positive(), destination: z.string().min(1),
    state: z.enum(["queued", "submitting", "submission_unknown", "broadcast", "confirmed", "failed_final"]),
  }).passthrough().safeParse(value).success && key === value.id, "INVALID", "Malformed wallet payout entry");
}

/**
 * Groundwork only: no mutation, authentication, command, receipt or event is
 * performed. The initial cohort excludes Wise, cash withdrawal credentials,
 * demand matches, buyer price offers, counter-offers, legacy missing identities,
 * archived buyer-history exceptions, historical fee policies and cross-network wallet mappings. Existing same-listing
 * reservations/settlement history and unpaired active wallet seller trades need
 * durable one-to-one canonical mappings before they can join this cohort. Such requests may
 * be valid canonical marketplace requests and are reported as UNSUPPORTED.
 */
export function planDevelopmentInitialAcceptance(context: DevelopmentInitialAcceptanceContext): DevelopmentInitialAcceptancePlan {
  assertSimulationRuntime(context?.mode);
  check(contextShape.safeParse(context).success, "INVALID", "Explicit complete initial-acceptance context is required");
  const { marketplace, wallet, mapping, acceptedAtMs: at } = context;
  validateRows(marketplace.users, accountShape, "account", at);
  validateRows(marketplace.purchaseRequests, requestShape, "request", at);
  validateRows(marketplace.marketplaceListings, listingShape, "listing", at);
  validateRows(marketplace.commissionRecords, commissionShape, "commission", at);
  validateRows(marketplace.sellerReviews, reviewShape, "legacy review", at);
  validateRows(marketplace.marketplaceEnforcementRecords, enforcementShape, "enforcement", at);
  validateRows(marketplace.tradeEvidenceFiles, evidenceShape, "evidence", at);
  validateRows(marketplace.disputes, disputeShape, "dispute", at);
  // Fail closed on executable/cyclic/non-JSON canonical payloads before deriving a decision.
  let marketplaceDigest: string;
  try { marketplaceDigest = walletDigest(Object.fromEntries(Object.entries(marketplace).map(([name, items]) => [name, sorted<{ id: string }>(items)]))); }
  catch { return reject("INVALID", "Canonical marketplace dependencies cannot be fingerprinted"); }
  const request = unique(marketplace.purchaseRequests, context.requestId, "request");
  const listing = unique(marketplace.marketplaceListings, request.listingId, "listing");
  const seller = unique(marketplace.users, request.sellerId, "seller");
  const buyer = unique(marketplace.users, request.buyerId, "buyer");
  check(context.actorUserId === seller.id && request.sellerId !== request.buyerId, "ACTOR", "Only the distinct canonical seller may request first acceptance");
  check(request.status === "pending", "LOCKED", "First acceptance requires the original pending request");
  check(request.tradeId && id.safeParse(request.tradeId).success, "UNSUPPORTED", "The canonical preallocated trade identity is required");
  const tradeIds = marketplace.purchaseRequests.filter(item => item.tradeId !== undefined).map(item => item.tradeId);
  check(new Set(tradeIds).size === tradeIds.length, "INTEGRITY", "Canonical trade identities must be unique");
  check(request.priceMode === "listing_price" && !request.usdtDemandId && !request.usdtDemandOfferId
    && request.termsProposal === undefined && (request.amountAdjustmentCount === undefined || request.amountAdjustmentCount === 0)
    && (request.counterPrices === undefined || (Array.isArray(request.counterPrices) && request.counterPrices.length === 0))
    && request.firstSellerResponseAt === undefined && request.priceOfferDiscount === undefined,
    "UNSUPPORTED", "Negotiation and demand histories require separate initial transitions");
  const method = normalizeMarketplacePaymentMethod(request.paymentMethod);
  check((method === "Bank Transfer" || method === "Face-to-Face (Meet in Person)")
    && ["Bank Transfer", "Face-to-Face", "Face-to-Face (Meet in Person)"].includes(request.paymentMethod),
  "UNSUPPORTED", "Only ordinary bank and face-to-face acceptance is planned");
  const receivingNetwork = mapping.assetId === "tron-sim-usdt" ? "TRC20" : "BEP20";
  check(request.network === receivingNetwork && listing.network === receivingNetwork, "UNSUPPORTED", "This canonical receiving network has no same-asset initial wallet mapping");
  check(listing.sellerId === request.sellerId, "INTEGRITY", "Canonical listing and request seller disagree");
  check(listing.currency === "ILS" && listing.bankTransferProvider !== "wise" && !listing.wiseAccountId,
    "UNSUPPORTED", "This listing is outside the initial ILS wallet cohort");
  check(listing.approvalStatus === "approved", "LOCKED", "Canonical owner listing approval is required");
  check(["active", "matched", "in_trade"].includes(listing.status) && !listing.closedAt && !listing.expiredAt
    && !listing.cancelledAt && !listing.completedAt && (!listing.expiresAt || Date.parse(listing.expiresAt) > at),
    "UNSUPPORTED", "Closed, expired or unapproved listing lifecycles require separate handling");
  check(!listing.newRequestBlockReason && !listing.blockingReason, "LOCKED", "The canonical listing has an unresolved acceptance restriction");
  accountEligible(seller, at); accountEligible(buyer, at);
  check(hasSellerOperationalAccess(seller) && seller.isProfileHidden !== true && seller.availabilityStatus !== "vacation",
    "LOCKED", "Canonical seller approval and availability are required");
  check(hasRole(buyer, "buyer") || hasRole(buyer, "approved_seller") || hasRole(buyer, "admin") || hasRole(buyer, "owner"),
    "LOCKED", "Canonical buyer eligibility is required");
  check(!seller.blockedUserIds?.some(value => value.trim() === buyer.id) && !buyer.blockedUserIds?.some(value => value.trim() === seller.id),
    "LOCKED", "A bilateral account block prevents first acceptance");
  check(!marketplace.marketplaceEnforcementRecords.some(record => record.sellerId === seller.id && record.status === "active"),
    "LOCKED", "Active marketplace enforcement prevents first acceptance");
  check(!marketplace.commissionRecords.some(record => [seller.id, buyer.id].includes(record.sellerId) && record.paymentStatus !== "paid"),
    "LOCKED", "Both participants must clear every unpaid seller commission");
  check(!marketplace.commissionRecords.some(record => record.purchaseRequestId === request.id || record.tradeId === request.tradeId),
    "LOCKED", "The pending request already has commission progress");
  check(!marketplace.tradeEvidenceFiles.some(file => file.purchaseRequestId === request.id)
    && !marketplace.disputes.some(dispute => dispute.purchaseRequestId === request.id), "LOCKED", "The initial request must have no retained evidence or dispute history");
  const absentProgress: Array<keyof PurchaseRequest> = ["tradeCreatedAt", "priceOfferAcceptedAt", "paymentSentAt", "fundsReceivedAt",
    "usdtReleaseStartedAt", "usdtReleaseDeadlineAt", "usdtSentAt", "completedAt", "lockedAt", "reviewUnlockedAt", "timedOutAt", "closedAt",
    "buyerConfirmationArchivedAt", "buyerEvidence", "sellerEvidence", "buyerReview", "sellerBuyerReview", "sellerResponse", "completionReceipt",
    "historicalCompletion", "historicalCompletionSummary", "buyerVolumeCredit", "buyerVolumeCreditSummary", "trustReconciliation",
    "timeoutReason", "closedByUserId", "closeReason", "closeExplanation"];
  check(!areTradeAmountsLocked(request) && absentProgress.every(key => request[key] === undefined)
    && request.cardlessCodeAwaitingBuyerConfirmation !== true, "LOCKED", "First acceptance cannot reopen prior trade progress");
  check(request.actionReminderState === undefined && request.inactivityWarningSentAt === undefined,
    "UNSUPPORTED", "Reminder histories require a separate initial-acceptance cohort");
  check([request.sellerWiseAccountId, request.buyerWiseAccountId, request.sellerWiseAccountSnapshot, request.buyerWiseAccountSnapshot]
    .every(value => value === undefined), "UNSUPPORTED", "Wise payment provenance requires a separate initial-acceptance cohort");
  if (request.sensitivePaymentSharedAt !== undefined || request.sensitivePaymentKind !== undefined) {
    check(method === "Bank Transfer" && request.sensitivePaymentKind === "bank_details" && request.sensitivePaymentSharedAt
      && Date.parse(request.sensitivePaymentSharedAt) >= Date.parse(request.createdAt)
      && Date.parse(request.sensitivePaymentSharedAt) <= Date.parse(request.updatedAt),
    "INTEGRITY", "Retained payment disclosure is inconsistent with this pending request");
    reject("UNSUPPORTED", "Prior bank-detail disclosure needs a separate initial-acceptance cohort");
  }
  check(Array.isArray(request.timeline) && request.timeline.length > 0, "INVALID", "Retained buyer submission evidence is required");
  const timelineIds = new Set<string>();
  for (const entry of request.timeline) {
    check(z.object({ id, type: z.enum(["request_submitted", "bank_details_revealed", "trade_inactivity_warning_sent"]), actorUserId: id,
      actorRole: roles, message: z.string(), createdAt: timestamp }).strict().safeParse(entry).success,
    "LOCKED", "The retained timeline is outside an unaccepted request");
    check(!timelineIds.has(entry.id), "INTEGRITY", "Duplicate timeline identity"); timelineIds.add(entry.id);
    check(entry.type !== "bank_details_revealed" || method === "Bank Transfer", "INTEGRITY", "Bank disclosure requires bank-transfer terms");
    check(Date.parse(entry.createdAt) >= Date.parse(request.createdAt) && Date.parse(entry.createdAt) <= Date.parse(request.updatedAt),
      "STALE", "Retained timeline chronology disagrees with the request");
  }
  const submissions = request.timeline.filter(entry => entry.type === "request_submitted");
  check(request.timeline.length === 1 && submissions.length === 1, "UNSUPPORTED", "Only the original submission timeline is in the first acceptance cohort");
  check(submissions.length === 1 && submissions[0]!.actorUserId === buyer.id
    && ["buyer", "approved_seller", "admin", "owner"].includes(submissions[0]!.actorRole)
    && Date.parse(submissions[0]!.createdAt) === Date.parse(request.createdAt), "INTEGRITY", "The exact retained buyer submission is required");
  if (request.messages !== undefined) {
    check(Array.isArray(request.messages), "INVALID", "Malformed retained request messages");
    const messageIds = new Set<string>();
    for (const message of request.messages) {
      check(z.object({ id, purchaseRequestId: id, kind: z.enum(["user", "system"]), senderUserId: id, senderRole: roles,
        message: z.string(), createdAt: timestamp, readByUserIds: z.array(id) }).passthrough().safeParse(message).success,
      "INVALID", "Malformed retained request message");
      check(!messageIds.has(message.id), "INTEGRITY", "Duplicate retained message identity"); messageIds.add(message.id);
      check(message.purchaseRequestId === request.id && !message.credentialKind
        && !/^Seller proposed .+ Buyer confirmation required\.$/.test(message.message),
      "LOCKED", "Credentials or prior proposal history cannot enter first acceptance");
      check(Date.parse(message.createdAt) >= Date.parse(request.createdAt) && Date.parse(message.createdAt) <= Date.parse(request.updatedAt),
        "STALE", "Retained message chronology disagrees with the request");
    }
  }
  check(request.buyerSafetyAcknowledged === true, "LOCKED", "Retained buyer request consent is required");
  check(method !== "Face-to-Face (Meet in Person)" || context.safetyAcknowledged === true,
    "LOCKED", "The seller must explicitly acknowledge face-to-face safety for this action");
  if (method === "Bank Transfer") {
    const bank = request.sellerBankAccountSnapshot;
    check(z.object({ accountHolderName: z.string().trim().min(1), bankName: z.string().trim().min(1),
      branchNumber: z.string().regex(/^\d+$/), accountNumber: z.string().regex(/^\d+$/), accountLast4: z.string().min(1) }).strict().safeParse(bank).success,
    "INTEGRITY", "Frozen bank instructions must be complete and internally consistent");
    check(bank && /^\d+$/.test(bank.branchNumber) && /^\d+$/.test(bank.accountNumber)
      && bank.accountLast4 === bank.accountNumber.slice(-4), "INTEGRITY", "Frozen bank instructions must be complete and internally consistent");
  }
  const buyerHistory = marketplace.purchaseRequests.filter(item => item.buyerId === buyer.id && item.id !== request.id);
  for (const other of buyerHistory) {
    check(other.buyerConfirmationArchivedAt === undefined, "UNSUPPORTED", "Buyer archived-history exceptions require a separate initial-acceptance cohort");
    check(!isDemandReservedTrade(other), "LOCKED", "The buyer has another active trade or completion obligation");
    if (["completed", "locked", "review_open"].includes(other.status)) {
      const embedded = other.buyerReview;
      check(!embedded || embedded.reviewerUserId === buyer.id, "INTEGRITY", "Embedded review belongs to another buyer");
      check(!embedded || (Date.parse(embedded.createdAt) >= Date.parse(other.createdAt)
        && Date.parse(embedded.createdAt) <= Date.parse(other.updatedAt)), "STALE", "Embedded review chronology disagrees with its trade");
      const reviews = marketplace.sellerReviews.filter(review => review.tradeId === (other.tradeId ?? other.id));
      check(reviews.every(review => review.buyerId === buyer.id && review.sellerId === other.sellerId), "INTEGRITY", "Legacy review provenance disagrees with the trade");
      check(embedded || reviews.length > 0, "LOCKED", "The buyer must review the previous completed trade");
    }
  }
  const sellerRequests = marketplace.purchaseRequests.filter(item => item.sellerId === seller.id && item.id !== request.id);
  const activeSellerRequests = sellerRequests.filter(isDemandReservedTrade);
  check(activeSellerRequests.length < MAX_SELLER_ACTIVE_TRADES, "UNAVAILABLE", "The seller already has three active reservations");
  for (const other of activeSellerRequests) {
    const otherListing = unique(marketplace.marketplaceListings, other.listingId, "seller inventory listing");
    check(otherListing.sellerId === seller.id && other.buyerId !== seller.id && quantity(other.usdtAmount, "reserved principal") > ZERO,
      "INTEGRITY", "Seller reservation inventory is inconsistent");
  }
  const inventory = marketplace.purchaseRequests.filter(item => item.listingId === listing.id);
  check(inventory.every(item => item.sellerId === seller.id), "INTEGRITY", "Canonical listing inventory has another seller");
  const scale = BigInt(10) ** BigInt(assetFor(mapping.assetId).decimals - 6);
  let available = quantity(listing.availableAmount, "listing inventory") * scale;
  for (const other of inventory.filter(item => item.id !== request.id && isDemandReservedTrade(item))) {
    check(other.network === receivingNetwork && other.currency === "ILS", "UNSUPPORTED", "Competing inventory requires a different wallet mapping");
    available -= quantity(other.usdtAmount, "competing principal") * scale;
  }
  const activeInventory = inventory.filter(item => item.id !== request.id && isDemandReservedTrade(item));
  // Equal aggregate principal does not prove that two reservations belong to
  // the same request, buyer, destination or frozen quote. This first contract
  // maps only the target, so it cannot reconcile competing identities safely.
  check(activeInventory.length === 0, "UNSUPPORTED", "Competing reservations on this listing require explicit durable identity mappings");
  check(listing.status === "active" && listing.activeTradeRequestId === undefined,
    "INTEGRITY", "An unreserved listing cannot retain a different active trade lock");
  let terms: DevelopmentTermsDescription;
  try { terms = describeDevelopmentTradeTerms({ mode: context.mode, request, assetId: mapping.assetId, walletListingId: mapping.walletListingId }); }
  catch (error) { if (error instanceof AcceptedTermsPlanningError) return reject(error.code, error.message); return reject("INVALID", "Frozen request terms cannot be derived"); }
  check(terms.terms.listingPriceAtRequest !== null && terms.terms.listingPriceAtRequest === terms.terms.pricePerUsdt,
    "UNSUPPORTED", "Ordinary first acceptance requires its original listing-price quote");
  const state = wallet.state;
  validateWalletShape(state);
  check(Array.isArray(state.journal) && state.gasReady instanceof Set && state.haltReason === null, "LOCKED", "A complete unpaused wallet replay is required");
  try {
    if (isV3State(state)) assertV3Invariants(state);
    else if (isV2State(state)) assertV2Invariants(state);
    else { check(!("engineVersion" in state), "UNSUPPORTED", "Unknown wallet continuation"); assertLedgerInvariants(state); }
  }
  catch (error) { if (error instanceof InitialAcceptancePlanningError) throw error; return reject("INTEGRITY", "Wallet replay invariants failed"); }
  if (isV2State(state) || isV3State(state)) check(!state.termsBindings.has(request.id)
    && ![...state.termsBindings.values()].some(binding => binding.walletTradeId === mapping.walletTradeId)
    && ![...state.acceptanceReceipts.values()].some(receipt => receipt.platformRequestId === request.id),
  "LOCKED", "The initial request already has versioned wallet history");
  if (isV3State(state)) check(!state.initialBindings.has(request.id)
    && ![...state.initialBindings.values()].some(binding => binding.walletTradeId === mapping.walletTradeId || binding.platformTradeId === request.tradeId)
    && ![...state.initialAcceptanceReceipts.values()].some(receipt => receipt.platformRequestId === request.id),
  "LOCKED", "The initial request already has seller-native wallet history");
  check(!state.trades.has(mapping.walletTradeId) && ![...state.payouts.values()].some(payout => payout.tradeId === mapping.walletTradeId)
    && ![...state.commissions.values()].some(commission => commission.tradeId === mapping.walletTradeId)
    && ![...state.evidenceOwners.values()].includes(mapping.walletTradeId), "LOCKED", "The planned wallet trade identity already has history");
  const walletListing = state.listings.get(mapping.walletListingId);
  check(walletListing && walletListing.id === mapping.walletListingId && walletListing.sellerId === seller.id
    && walletListing.assetId === mapping.assetId && walletListing.currency === "ILS", "INTEGRITY", "Wallet listing identity disagrees with the canonical mapping");
  check(walletListing.approved === true && walletListing.funded === true && walletListing.closed === false,
    "LOCKED", "The wallet listing must be fully funded, owner-approved and open");
  check(walletListing.amountRaw === quantity(listing.originalAmount, "original listing principal") * scale,
    "INTEGRITY", "Fully funded wallet principal must match the original canonical listing");
  const walletActive = [...state.trades.values()].filter(trade => trade.status !== "completed" && trade.status !== "cancelled");
  const walletSellerActive = walletActive.filter(trade => trade.sellerId === seller.id);
  check(walletSellerActive.length < MAX_SELLER_ACTIVE_TRADES, "UNAVAILABLE", "The wallet seller already has three active reservations");
  check(![...state.trades.values()].some(trade => trade.listingId === mapping.walletListingId && trade.status !== "cancelled"),
    "UNSUPPORTED", "Prior wallet trade history on this listing requires explicit durable canonical mappings");
  // Canonical and wallet counts are separate policy checks. Without a durable
  // pairing, treating two unrelated sets as the same commitments can exceed
  // the seller's overall capacity even when each individual count is below 3.
  check(walletSellerActive.length === 0, "UNSUPPORTED", "Active wallet seller trades require explicit durable canonical identity mappings");
  check(!walletActive.some(trade => trade.buyerId === buyer.id), "LOCKED", "The wallet buyer already has an active trade");
  check(![...state.commissions.values()].some(commission => [seller.id, buyer.id].includes(commission.sellerId) && commission.paid !== true),
    "LOCKED", "Retained wallet commission obligations prevent a new commitment");
  const listingAvailable = balance(state, mapping.assetId, `listing:${mapping.walletListingId}`);
  check(available >= ZERO && listingAvailable === available, "INTEGRITY", "Complete canonical reservations and wallet listing inventory disagree");
  check([...state.accounts].every(([key, amount]) => !key.endsWith(`|trade:${mapping.walletTradeId}`) || amount === ZERO),
    "LOCKED", "The planned wallet trade account is already funded");
  const minimum = quantity(listing.minimumTrade, "minimum trade") * scale;
  const maximum = quantity(listing.maximumTrade === "" ? listing.availableAmount : listing.maximumTrade, "maximum trade") * scale;
  const principal = BigInt(terms.terms.principalRaw);
  check(maximum >= minimum && principal >= minimum && principal <= maximum && principal <= available,
    "UNAVAILABLE", "The full request principal must remain available within canonical limits");
  let walletPrice: bigint, walletStateDigest: string;
  try { walletPrice = parseUnits(walletListing.price, 2); walletStateDigest = walletDigest(state); }
  catch { return reject("INVALID", "Wallet replay cannot be fingerprinted with an exact price"); }
  check(walletPrice > ZERO, "INTEGRITY", "Wallet listing price must be positive");
  const requestDigest = walletDigest(request);
  const preconditions = {
    requestUpdatedAt: request.updatedAt, requestDigest, listingDigest: walletDigest(listing), marketplaceDigest,
    usersDigest: walletDigest(sorted(marketplace.users)), sellerInventoryDigest: walletDigest({
      listings: sorted(marketplace.marketplaceListings.filter(item => item.sellerId === seller.id)), requests: sorted(sellerRequests) }),
    buyerHistoryDigest: walletDigest(sorted(buyerHistory)), commissionsDigest: walletDigest(sorted(marketplace.commissionRecords)),
    legacyReviewsDigest: walletDigest(sorted(marketplace.sellerReviews)), enforcementDigest: walletDigest(sorted(marketplace.marketplaceEnforcementRecords)),
    evidenceDigest: walletDigest(sorted(marketplace.tradeEvidenceFiles)), disputesDigest: walletDigest(sorted(marketplace.disputes)),
    walletRevision: wallet.revision, walletEventHash: wallet.eventHash, walletStateDigest, walletListingDigest: walletDigest(walletListing),
    sellerActiveTradeCount: activeSellerRequests.length, walletSellerActiveTradeCount: walletSellerActive.length,
  };
  const sellerAction = { kind: "initial_seller_acceptance" as const, requestedByUserId: seller.id, requestId: request.id,
    faceToFaceSafetyAcknowledged: method === "Face-to-Face (Meet in Person)" && context.safetyAcknowledged };
  const acceptanceKey = walletDigest(["alpha-wallet-initial-seller-acceptance-v1", request.id, seller.id]);
  const inputDigest = walletDigest({ acceptanceKey, actorUserId: seller.id, mapping, termsDigest: terms.digest, sellerAction, preconditions });
  return freeze({ kind: DEVELOPMENT_INITIAL_ACCEPTANCE_VERSION, mode: "simulation-only", executionAuthority: false,
    requiredExecutionContract: isV3State(state) ? "seller-initial-acceptance-v3" : "seller-initial-acceptance-not-implemented",
    acceptanceKey, inputDigest, actorUserId: seller.id,
    requestId: request.id, plannedAtMs: at, canonicalAcceptance: { requestId: request.id, actorUserId: seller.id,
      tradeId: request.tradeId, acceptedAtMs: at, ...(sellerAction.faceToFaceSafetyAcknowledged ? { safetyAcknowledged: true as const } : {}) },
    terms, sellerAction, buyerRequestEvidence: { kind: "retained_canonical_request", requestId: request.id, tradeId: request.tradeId,
      buyerId: buyer.id, createdAt: request.createdAt, requestDigest, submissionTimelineEntryId: submissions[0]!.id,
      submissionTimelineDigest: walletDigest(submissions[0]), termsDigest: terms.digest, feePolicyVersion: terms.terms.feePolicyVersion,
      commissionCalculationVersion: terms.terms.commissionCalculationVersion, buyerSafetyAcknowledged: request.buyerSafetyAcknowledged },
    pricing: { source: "retained_request", walletListingPrice: walletListing.price,
      requiresFrozenPriceTransition: walletPrice !== parseUnits(terms.terms.pricePerUsdt, 2) },
    preconditions, reservation: { action: "reserve", assetId: mapping.assetId, walletListingId: mapping.walletListingId,
      walletTradeId: mapping.walletTradeId, principalRaw: terms.terms.principalRaw, transferAmountRaw: terms.terms.principalRaw,
      fromAccount: `listing:${mapping.walletListingId}`, toAccount: `trade:${mapping.walletTradeId}`,
      expectedListingAvailableRaw: listingAvailable.toString(), expectedTradeReservedRaw: "0", availableForRequestRaw: available.toString() } });
}
