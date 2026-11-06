import "server-only";

import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { validateUploadContent } from "@/lib/file-content-validation";
import { assertNoDirectContactContent } from "@/lib/privacy-redaction";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import type { AlphaExchangeNotification, AuditLogEntry, MarketplaceListing, PurchaseRequest, TradeDisputeCase, TradeEvidenceFile } from "@/types/alpha-exchange";
import { describeDevelopmentTradeTerms } from "./accepted-terms";
import { parseUnits } from "./amounts";
import type { DevelopmentPrepaymentCancellationMarketplace } from "./prepayment-cancellation";
import { assertSimulationRuntime } from "./runtime";

/** Canonical mechanics only. These functions grant no login, wallet or delivery authority. */
export type DevelopmentPaymentMarketplace = DevelopmentPrepaymentCancellationMarketplace;
export const DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;
export const developmentPaymentEvidenceUploadSchema = z.strictObject({
  mimeType: z.enum(["image/png", "image/jpeg", "application/pdf"]),
  contentBase64: z.string().min(1).max(Math.ceil(DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES / 3) * 4),
});
export type DevelopmentPaymentEvidenceUpload = z.infer<typeof developmentPaymentEvidenceUploadSchema>;
export type DevelopmentPaymentEvidence = Readonly<{
  metadata: TradeEvidenceFile;
  /** Exact private bytes. Never include this field in a financial or public receipt. */
  contentBase64: string;
  contentDigest: string;
}>;
export type DevelopmentPaymentClaimDecision = Readonly<{
  requestId: string; tradeId: string; actorUserId: string; claimedAtMs: number;
  evidence?: DevelopmentPaymentEvidenceUpload;
}>;
export type DevelopmentPaymentDisputeDecision = Readonly<{
  requestId: string; tradeId: string; actorUserId: string; openedAtMs: number; reason: string;
}>;
export type DevelopmentPaymentTrade = {
  id: string; purchaseRequestId: string; listingId: string; sellerId: string; buyerId: string;
  status: "accepted" | "payment_sent" | "cancelled"; createdAt: string; updatedAt: string;
  timeline: PurchaseRequest["timeline"];
};
/** New-profile audit vocabulary; frozen production/V3 audit contracts stay unchanged. */
export type DevelopmentPaymentAuditLogEntry = Omit<AuditLogEntry, "action"> & {
  action: "trade_payment_claimed" | "trade_dispute_opened";
};
export type DevelopmentPaymentMarketplaceResult = {
  kind: "claim" | "dispute";
  request: PurchaseRequest; listing: MarketplaceListing; trade: DevelopmentPaymentTrade;
  /** Exact new inserts only; retained evidence is unchanged by opening a dispute. */
  evidence: DevelopmentPaymentEvidence[];
  disputes: TradeDisputeCase[];
  notifications: AlphaExchangeNotification[];
  notificationUpdates: AlphaExchangeNotification[];
  auditLogs: DevelopmentPaymentAuditLogEntry[];
};
export type DevelopmentPaymentCanonicalCommitment = Omit<DevelopmentPaymentMarketplaceResult, "evidence"> & {
  evidence: Array<Omit<DevelopmentPaymentEvidence, "contentBase64">>;
};

export class PaymentMarketplacePlanningError extends Error {
  constructor(readonly code: "INVALID" | "UNSUPPORTED" | "ACTOR" | "STALE" | "LOCKED" | "INTEGRITY", message: string) {
    super(message); this.name = "PaymentMarketplacePlanningError";
  }
}
function check(value: unknown, code: PaymentMarketplacePlanningError["code"], message: string): asserts value {
  if (!value) throw new PaymentMarketplacePlanningError(code, `Payment marketplace ${message}.`);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const time = z.string().refine(value => Number.isFinite(Date.parse(value)) && Date.parse(value) > 0 && new Date(value).toISOString() === value);
const clock = z.number().int().positive().max(8_640_000_000_000_000);
const role = z.enum(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"]);
const row = z.record(z.string(), z.unknown());
const claimDecision = z.strictObject({ requestId: id, tradeId: id, actorUserId: id, claimedAtMs: clock,
  evidence: developmentPaymentEvidenceUploadSchema.optional() });
const disputeDecision = z.strictObject({ requestId: id, tradeId: id, actorUserId: id, openedAtMs: clock, reason: z.string().max(2000) });
const marketplaceShape = z.strictObject({ users: z.array(row), marketplaceListings: z.array(row), purchaseRequests: z.array(row),
  commissionRecords: z.array(row), sellerReviews: z.array(row), marketplaceEnforcementRecords: z.array(row),
  tradeEvidenceFiles: z.array(row), disputes: z.array(row), notifications: z.array(row) });
const requestShape = z.object({ id, tradeId: id.optional(), listingId: id, sellerId: id, buyerId: id, status: z.string(),
  usdtAmount: z.string(), fiatAmount: z.string(), currency: z.string(), network: z.string(), paymentMethod: z.string(),
  createdAt: time, updatedAt: time, tradeCreatedAt: time.optional(),
  timeline: z.array(z.object({ id, type: z.string(), actorUserId: id.optional(), actorRole: role, message: z.string(), createdAt: time }).passthrough()),
  messages: z.array(z.object({ id, createdAt: time, credentialKind: z.literal("cardless_code").optional() }).passthrough()).optional(),
  sensitivePaymentKind: z.enum(["bank_details", "cardless_code"]).optional(), sensitivePaymentSharedAt: time.optional(),
  paymentSentAt: time.optional(), actionReminderState: row.optional(), inactivityWarningSentAt: time.optional(),
}).passthrough();
const listingShape = z.object({ id, sellerId: id, status: z.string(), originalAmount: z.string(), availableAmount: z.string(),
  price: z.string(), currency: z.string(), network: z.string(), minimumTrade: z.string(), maximumTrade: z.string(),
  activeTradeRequestId: id.optional(), lockedAt: time.optional(), expiresAt: time.optional(), createdAt: time, updatedAt: time,
}).passthrough();
const evidenceShape = z.strictObject({ id, purchaseRequestId: id, side: z.enum(["buyer", "seller"]), uploadedByUserId: id,
  uploadedAt: time, fileName: z.string(), mimeType: developmentPaymentEvidenceUploadSchema.shape.mimeType,
  sizeBytes: z.number().int().positive().max(DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES), storagePath: z.string(), status: z.enum(["uploaded", "replaced"]) });
const notificationShape = z.object({ id, userId: id, category: z.string(), title: z.string(), message: z.string(),
  isRead: z.boolean(), createdAt: time, updatedAt: time.optional(), archivedAt: time.optional(),
  relatedRequestId: id.optional(), relatedTradeId: id.optional(), relatedListingId: id.optional(),
  state: z.enum(["unread", "read", "archived"]).optional(), reason: z.string().optional(),
}).passthrough();
const advancedEvents = new Set<PurchaseRequest["timeline"][number]["type"]>([
  "seller_confirmed_funds", "buyer_confirmed_funds", "usdt_release_started", "usdt_sent", "trade_completed",
  "buyer_confirmed_receipt", "seller_evidence_uploaded", "request_cancelled", "request_declined", "trade_timed_out",
  "trade_locked", "review_unlocked", "dispute_opened", "dispute_resolved", "commission_recorded", "commission_paid",
  "buyer_confirmation_overdue", "trade_closed_manually",
]);
function unique<T extends { id: string }>(items: readonly T[], key: string, label: string): T {
  const matches = items.filter(item => item.id === key);
  check(matches.length === 1, "INTEGRITY", `requires one exact ${label}`); return matches[0]!;
}
function validateRows(items: readonly { id: string }[], shape: z.ZodType, label: string) {
  const seen = new Set<string>();
  for (const item of items) {
    check(shape.safeParse(item).success, "INVALID", `has a malformed ${label}`);
    check(!seen.has(item.id), "INTEGRITY", `has a duplicate ${label} identity`); seen.add(item.id);
  }
}

function isStrictBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  // A repeated-group regexp over an allowed eight MiB upload exhausts the JS stack.
  // The schema bounds this linear scan; the decode/re-encode check below still
  // enforces canonical padding bits and the exact decoded-byte limit.
  for (let i = 0; i < value.length - padding; i++) {
    const code = value.charCodeAt(i);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122)
      || (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  return true;
}

/** Strict canonical base64 and the existing upload signature validation, with a fixed development bound. */
export function normalizeDevelopmentPaymentEvidenceInput(input: unknown) {
  const parsed = developmentPaymentEvidenceUploadSchema.safeParse(input);
  check(parsed.success, "INVALID", "requires bounded supported evidence input without caller metadata");
  const { mimeType, contentBase64 } = parsed.data;
  check(isStrictBase64(contentBase64),
    "INVALID", "requires strict base64 evidence bytes");
  const bytes = Buffer.from(contentBase64, "base64");
  check(bytes.length > 0 && bytes.length <= DEVELOPMENT_PAYMENT_EVIDENCE_MAX_BYTES && bytes.toString("base64") === contentBase64,
    "INVALID", "requires exact bounded evidence bytes");
  check(validateUploadContent(bytes, mimeType), "INVALID", "evidence content does not match its declared file type");
  return freeze({ mimeType, contentBase64, sizeBytes: bytes.length,
    contentDigest: createHash("sha256").update(bytes).digest("hex") });
}

export function normalizeDevelopmentPaymentDisputeReason(input: string): string {
  check(typeof input === "string", "INVALID", "requires a textual dispute reason");
  const reason = input.trim();
  check(reason.length >= 1 && reason.length <= 500, "INVALID", "requires a dispute reason of 1 to 500 characters");
  try { assertNoDirectContactContent(reason); }
  catch { throw new PaymentMarketplacePlanningError("INVALID", "Payment marketplace dispute reason contains unsupported contact details."); }
  return reason;
}
function extension(mimeType: DevelopmentPaymentEvidenceUpload["mimeType"]) {
  return { "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" }[mimeType];
}
function makeEvidence(request: PurchaseRequest, upload: DevelopmentPaymentEvidenceUpload, at: string): DevelopmentPaymentEvidence {
  const content = normalizeDevelopmentPaymentEvidenceInput(upload);
  const evidenceId = `evidence-${createHash("sha256").update(`${request.id}\0${request.buyerId}\0buyer\0${content.mimeType}\0`)
    .update(Buffer.from(content.contentBase64, "base64")).digest("hex").slice(0, 32)}`;
  const metadata: TradeEvidenceFile = { id: evidenceId, purchaseRequestId: request.id, side: "buyer", uploadedByUserId: request.buyerId,
    uploadedAt: at, fileName: `buyer-payment-evidence.${extension(content.mimeType)}`, mimeType: content.mimeType,
    sizeBytes: content.sizeBytes, storagePath: `db://alpha-exchange-evidence/${request.id}/buyer-${evidenceId}.${extension(content.mimeType)}`,
    status: "uploaded" };
  return freeze({ metadata, contentBase64: content.contentBase64, contentDigest: content.contentDigest });
}

/** Validate the exact stored bytes, neutral metadata and content-derived identity before reuse or export. */
export function assertDevelopmentPaymentEvidence(input: DevelopmentPaymentEvidence, request: PurchaseRequest): void {
  check(input && evidenceShape.safeParse(input.metadata).success && typeof input.contentDigest === "string",
    "INTEGRITY", "requires exact retained evidence metadata");
  const mimeType = developmentPaymentEvidenceUploadSchema.shape.mimeType.parse(input.metadata.mimeType);
  const expected = makeEvidence(request, { mimeType, contentBase64: input.contentBase64 }, input.metadata.uploadedAt);
  check(isDeepStrictEqual(expected, input), "INTEGRITY", "retained evidence bytes, digest or derived identity disagree");
  check(request.paymentMethod === "Bank Transfer" && request.paymentSentAt === input.metadata.uploadedAt
    && Date.parse(input.metadata.uploadedAt) <= Date.parse(request.updatedAt), "INTEGRITY", "retained evidence chronology differs from the buyer claim");
}

/** Byte-free canonical proof for financial commitments and immutable coordination rows. */
export function paymentCanonicalCommitment(result: DevelopmentPaymentMarketplaceResult): DevelopmentPaymentCanonicalCommitment {
  const copy = structuredClone(result);
  return freeze({ ...copy, evidence: copy.evidence.map(({ metadata, contentDigest }) => ({ metadata, contentDigest })) });
}

function base(input: DevelopmentPaymentMarketplace, decision: { requestId: string; tradeId: string; actorUserId: string }, atMs: number,
  stage: "accepted" | "payment_sent") {
  check(marketplaceShape.safeParse(input).success, "INVALID", "requires explicit complete canonical collections");
  check(Object.values(input).reduce((sum, rows) => sum + rows.length, 0) <= 10000, "UNSUPPORTED", "exceeds its bounded read scope");
  validateRows(input.users, z.object({ id, role, disabled: z.boolean().optional(), createdAt: time, updatedAt: time }).passthrough(), "account");
  validateRows(input.marketplaceListings, listingShape, "listing");
  validateRows(input.purchaseRequests, requestShape, "request");
  validateRows(input.notifications, notificationShape, "notification");
  validateRows(input.tradeEvidenceFiles, evidenceShape, "evidence");
  validateRows(input.disputes, z.object({ id, purchaseRequestId: id, tradeId: id, status: z.enum(["open", "resolved"]) }).passthrough(), "dispute");
  for (const collection of [input.commissionRecords, input.marketplaceEnforcementRecords, input.sellerReviews]) {
    validateRows(collection, z.object({ id }).passthrough(), "retained dependency");
  }
  const request = unique(input.purchaseRequests, decision.requestId, "request");
  const listing = unique(input.marketplaceListings, request.listingId, "listing");
  const buyer = unique(input.users, request.buyerId, "buyer account"), seller = unique(input.users, request.sellerId, "seller account");
  check(buyer.id !== seller.id && listing.sellerId === seller.id && request.tradeId === decision.tradeId,
    "INTEGRITY", "requires unchanged request, trade and party identities");
  check(decision.actorUserId === buyer.id && buyer.disabled !== true, "ACTOR", "requires the enabled retained buyer; seller and owner overrides are excluded");
  check(request.status === stage, "UNSUPPORTED", `requires the exact ${stage} lifecycle stage`);
  check(atMs > Date.parse(request.updatedAt) && (stage !== "accepted" || atMs > Date.parse(listing.updatedAt))
    && Date.parse(request.createdAt) <= Date.parse(request.tradeCreatedAt ?? "")
    && Date.parse(request.tradeCreatedAt ?? "") <= Date.parse(request.updatedAt)
    && Date.parse(listing.createdAt) <= Date.parse(listing.updatedAt), "STALE", "requires a strictly later explicit clock and retained acceptance chronology");
  const unsupported: (keyof PurchaseRequest)[] = ["usdtDemandId", "usdtDemandOfferId", "priceOfferAcceptedAt", "termsProposal",
    "fundsReceivedAt", "usdtReleaseStartedAt", "usdtReleaseDeadlineAt", "usdtSentAt", "completedAt", "timedOutAt", "timeoutReason",
    "buyerConfirmationArchivedAt", "lockedAt", "reviewUnlockedAt", "buyerReview", "sellerBuyerReview", "sellerResponse", "closedAt",
    "closedByUserId", "closeReason", "closeExplanation", "completionReceipt", "historicalCompletion", "buyerVolumeCredit", "trustReconciliation",
    "sellerEvidence", "sellerWiseAccountId", "buyerWiseAccountId", "sellerWiseAccountSnapshot", "buyerWiseAccountSnapshot"];
  check(unsupported.every(field => request[field] === undefined) && request.currency === "ILS"
    && (request.network === "TRC20" || request.network === "BEP20") && request.priceMode === "listing_price"
    && request.feePolicyVersion === "buyer_seller_1pct_v1" && request.commissionCalculationVersion === "usdt_6dp_v2"
    && (request.amountAdjustmentCount === undefined || request.amountAdjustmentCount === 0)
    && (!request.counterPrices || request.counterPrices.length === 0)
    && ["Bank Transfer", "Face-to-Face", "Face-to-Face (Meet in Person)"].includes(request.paymentMethod)
    && request.bankTransferProvider !== "wise" && request.sensitivePaymentKind !== "cardless_code"
    && request.cardlessCodeAwaitingBuyerConfirmation !== true && !request.messages?.some(message => message.credentialKind === "cardless_code"),
  "UNSUPPORTED", "is outside the unchanged initial Bank/F2F terms and unpaid-or-claimed scope");
  check(listing.status === (stage === "accepted" ? "matched" : "in_trade") && listing.activeTradeRequestId === request.id && !!listing.lockedAt
    && listing.currency === request.currency && listing.network === request.network && listing.bankTransferProvider !== "wise" && !listing.wiseAccountId
    && !listing.closedAt && !listing.expiredAt && !listing.cancelledAt && !listing.completedAt,
  "INTEGRITY", "requires the exact retained representative listing lock");
  // expiresAt is deliberately preserved, including elapsed listing lifetimes.
  // Acceptance already reserved principal; the clock grants no inventory return.
  const tradeIds = input.purchaseRequests.flatMap(item => item.tradeId === undefined ? [] : [item.tradeId]);
  check(new Set(tradeIds).size === tradeIds.length, "INTEGRITY", "has duplicate canonical trade identities");
  check(input.purchaseRequests.filter(item => item.listingId === listing.id).every(item => item.sellerId === seller.id)
    && !input.purchaseRequests.some(item => item.id !== request.id && item.listingId === listing.id && isDemandReservedTrade(item)),
  "UNSUPPORTED", "refuses competing or inconsistent listing reservations");
  check(!input.commissionRecords.some(item => item.purchaseRequestId === request.id || item.tradeId === request.tradeId),
    "LOCKED", "refuses a retained target commission");
  check(!input.disputes.some(item => item.purchaseRequestId === request.id || (item as { tradeId?: string }).tradeId === request.tradeId),
    "LOCKED", "requires no existing target dispute or contradictory dispute linkage");
  check(new Set(request.timeline.map(event => event.id)).size === request.timeline.length
    && request.timeline.every(event => Date.parse(event.createdAt) >= Date.parse(request.createdAt)
      && Date.parse(event.createdAt) <= Date.parse(request.updatedAt) && !advancedEvents.has(event.type)),
  "INTEGRITY", "requires consistent retained timeline chronology without later lifecycle progress");
  const terms = describeDevelopmentTradeTerms({ mode: "simulation-only", request,
    assetId: request.network === "TRC20" ? "tron-sim-usdt" : "bsc-sim-binance-peg-usdt", walletListingId: listing.id });
  check(terms.terms.listingPriceAtRequest === terms.terms.pricePerUsdt
    && parseUnits(listing.availableAmount, 6) >= parseUnits(request.usdtAmount, 6), "INTEGRITY", "requires unchanged listing-price terms and retained covered principal");
  return { request, listing, buyer, seller, at: new Date(atMs).toISOString() };
}
function suffix(kind: "claim" | "dispute", request: PurchaseRequest) {
  return createHash("sha256").update(JSON.stringify([`initial_payment_${kind}`, request.id, request.tradeId])).digest("hex");
}
function physicalTrade(request: PurchaseRequest): DevelopmentPaymentTrade {
  check(request.status === "payment_sent", "INTEGRITY", "requires the claimed trade projection");
  return { id: request.tradeId!, purchaseRequestId: request.id, listingId: request.listingId, sellerId: request.sellerId,
    buyerId: request.buyerId, status: "payment_sent", createdAt: request.tradeCreatedAt!, updatedAt: request.updatedAt,
    timeline: structuredClone(request.timeline) };
}
function reminders(marketplace: DevelopmentPaymentMarketplace, request: PurchaseRequest, at: string, allParties: boolean) {
  return marketplace.notifications.filter(item => item.reason === "automatic_trade_action_reminder" && item.relatedRequestId === request.id
    && (item.userId === request.buyerId || (allParties && item.userId === request.sellerId)) && item.state !== "archived")
    .map(item => ({ ...structuredClone(item), state: "archived" as const, isRead: true, archivedAt: at, updatedAt: at }));
}
function assertFreshEffects(marketplace: DevelopmentPaymentMarketplace, before: PurchaseRequest, result: DevelopmentPaymentMarketplaceResult) {
  const ids = result.request.timeline.slice(before.timeline.length).map(item => item.id);
  check(!before.timeline.some(item => ids.includes(item.id)), "INTEGRITY", "already has a deterministic lifecycle event identity");
  check(!marketplace.notifications.some(item => result.notifications.some(next => next.id === item.id)),
    "INTEGRITY", "already has a deterministic lifecycle notification identity");
}

/** One buyer assertion. It does not verify receipt of fiat or authorize any USDT release. */
export function planDevelopmentPaymentClaim(marketplaceInput: DevelopmentPaymentMarketplace,
  decisionInput: DevelopmentPaymentClaimDecision): DevelopmentPaymentMarketplaceResult {
  assertSimulationRuntime("simulation-only");
  let marketplace: DevelopmentPaymentMarketplace, decision: DevelopmentPaymentClaimDecision;
  try { marketplace = structuredClone(marketplaceInput); decision = structuredClone(decisionInput); }
  catch { throw new PaymentMarketplacePlanningError("INVALID", "Payment marketplace requires cloneable retained claim data."); }
  check(claimDecision.safeParse(decision).success, "INVALID", "requires its narrow retained buyer claim decision");
  const { request: before, listing: beforeListing, buyer, seller, at } = base(marketplace, decision, decision.claimedAtMs, "accepted");
  check(before.paymentSentAt === undefined && before.buyerEvidence === undefined
    && !marketplace.tradeEvidenceFiles.some(item => item.purchaseRequestId === before.id)
    && !before.timeline.some(item => item.type === "payment_sent" || item.type === "buyer_evidence_uploaded"),
  "LOCKED", "refuses already retained payment or evidence progress");
  const bank = before.paymentMethod === "Bank Transfer";
  check(bank ? decision.evidence !== undefined : decision.evidence === undefined,
    "INVALID", bank ? "requires Bank Transfer buyer evidence" : "does not accept photo evidence for Face-to-Face claims");
  const evidence = bank ? [makeEvidence(before, decision.evidence!, at)] : [];
  const key = suffix("claim", before);
  const timeline: PurchaseRequest["timeline"] = [...structuredClone(before.timeline),
    ...(bank ? [{ id: `payment-claim-evidence-event-${key}`, type: "buyer_evidence_uploaded" as const, actorUserId: buyer.id,
      actorRole: buyer.role, message: "Buyer uploaded payment evidence", createdAt: at }] : []),
    { id: `payment-claim-event-${key}`, type: "payment_sent", actorUserId: buyer.id, actorRole: buyer.role,
      message: bank ? "Buyer marked payment sent" : "Buyer confirmed the cash was handed to the seller", createdAt: at }];
  const request: PurchaseRequest = { ...structuredClone(before), status: "payment_sent", paymentSentAt: at, updatedAt: at, timeline,
    actionReminderState: undefined, inactivityWarningSentAt: undefined,
    ...(bank ? { buyerEvidence: structuredClone(evidence[0].metadata) } : {}) };
  const listing: MarketplaceListing = { ...structuredClone(beforeListing), status: "in_trade", updatedAt: at };
  const notifications: AlphaExchangeNotification[] = [{ id: `payment-claim-notification-seller-${key}`, userId: seller.id,
    category: "trade", title: bank ? "Buyer marked payment sent" : "Buyer handed over cash",
    message: bank ? "Buyer marked payment as sent. Please verify the funds in your bank account."
      : "Buyer confirmed the cash was handed over. Confirm receipt before sending USDT.", isRead: false, state: "unread",
    relatedRequestId: before.id, relatedTradeId: before.tradeId, relatedListingId: before.listingId,
    relatedHref: `/trade-room/${encodeURIComponent(before.id)}`, createdAt: at }];
  const auditLogs: DevelopmentPaymentAuditLogEntry[] = [{ id: `payment-claim-audit-${key}`, action: "trade_payment_claimed",
    actorUserId: buyer.id, targetUserId: seller.id, listingId: before.listingId, purchaseRequestId: before.id,
    details: "Buyer payment claim recorded; principal remains reserved.", oldValue: { status: before.status },
    newValue: { status: "payment_sent", ...(bank ? { buyerEvidenceId: evidence[0].metadata.id } : {}) }, createdAt: at }];
  const result: DevelopmentPaymentMarketplaceResult = { kind: "claim", request, listing, trade: physicalTrade(request), evidence,
    disputes: [], notifications, notificationUpdates: reminders(marketplace, before, at, false), auditLogs };
  assertFreshEffects(marketplace, before, result);
  return freeze(result);
}

/**
 * Open one buyer dispute only after the exact private profile claim. The coordinator
 * also verifies the immutable V5 claim receipt; this planner verifies its canonical
 * payment/evidence shape. The request stays payment_sent and principal stays held.
 */
export function planDevelopmentPaymentDispute(marketplaceInput: DevelopmentPaymentMarketplace,
  decisionInput: DevelopmentPaymentDisputeDecision, retainedEvidenceInput: readonly DevelopmentPaymentEvidence[]): DevelopmentPaymentMarketplaceResult {
  assertSimulationRuntime("simulation-only");
  let marketplace: DevelopmentPaymentMarketplace, decision: DevelopmentPaymentDisputeDecision, retainedEvidence: DevelopmentPaymentEvidence[];
  try { marketplace = structuredClone(marketplaceInput); decision = structuredClone(decisionInput); retainedEvidence = structuredClone([...retainedEvidenceInput]); }
  catch { throw new PaymentMarketplacePlanningError("INVALID", "Payment marketplace requires cloneable retained dispute data."); }
  check(disputeDecision.safeParse(decision).success, "INVALID", "requires its narrow retained buyer dispute decision");
  const reason = normalizeDevelopmentPaymentDisputeReason(decision.reason);
  const { request: before, listing, buyer, seller, at } = base(marketplace, decision, decision.openedAtMs, "payment_sent");
  check(time.safeParse(before.paymentSentAt).success && Date.parse(before.paymentSentAt!) <= Date.parse(before.updatedAt)
    && Date.parse(before.paymentSentAt!) > Date.parse(before.tradeCreatedAt!), "INTEGRITY", "requires the retained payment claim chronology");
  const bank = before.paymentMethod === "Bank Transfer";
  const stored = marketplace.tradeEvidenceFiles.filter(item => item.purchaseRequestId === before.id);
  if (bank) {
    check(stored.length === 1 && retainedEvidence.length === 1 && before.buyerEvidence !== undefined,
      "INTEGRITY", "requires the one exact claimed Bank Transfer evidence object");
    assertDevelopmentPaymentEvidence(retainedEvidence[0], before);
    check(isDeepStrictEqual(stored[0], retainedEvidence[0].metadata) && isDeepStrictEqual(before.buyerEvidence, stored[0]),
      "INTEGRITY", "embedded, normalized and retained buyer evidence disagree");
  } else check(stored.length === 0 && retainedEvidence.length === 0 && before.buyerEvidence === undefined,
    "INTEGRITY", "Face-to-Face claim must not carry evidence");
  const paymentEvents = before.timeline.filter(item => item.type === "payment_sent");
  const evidenceEvents = before.timeline.filter(item => item.type === "buyer_evidence_uploaded");
  const claimKey = suffix("claim", before);
  check(paymentEvents.length === 1 && paymentEvents[0].id === `payment-claim-event-${claimKey}`
    && paymentEvents[0].actorUserId === buyer.id && paymentEvents[0].createdAt === before.paymentSentAt
    && evidenceEvents.length === (bank ? 1 : 0)
    && evidenceEvents.every(item => item.id === `payment-claim-evidence-event-${claimKey}`
      && item.actorUserId === buyer.id && item.createdAt === before.paymentSentAt),
  "INTEGRITY", "requires the exact original payment claim timeline linkage");
  const key = suffix("dispute", before);
  const dispute: TradeDisputeCase = { id: `payment-dispute-${key}`, purchaseRequestId: before.id, tradeId: before.tradeId!,
    openedByUserId: buyer.id, buyerId: buyer.id, sellerId: seller.id, reason,
    ...(bank ? { buyerEvidenceId: stored[0].id } : {}), status: "open", createdAt: at, updatedAt: at };
  const request: PurchaseRequest = { ...structuredClone(before), updatedAt: at,
    actionReminderState: undefined, inactivityWarningSentAt: undefined,
    timeline: [...structuredClone(before.timeline), { id: `payment-dispute-event-${key}`, type: "dispute_opened",
      actorUserId: buyer.id, actorRole: buyer.role, message: "Dispute opened for this trade.", createdAt: at }] };
  const notifications: AlphaExchangeNotification[] = [buyer, seller].map(recipient => ({
    id: `payment-dispute-notification-${recipient.id === buyer.id ? "buyer" : "seller"}-${key}`, userId: recipient.id,
    category: "dispute", title: "Dispute opened", message: `A dispute was opened for trade ${before.tradeId}.`,
    isRead: false, state: "unread", relatedRequestId: before.id, relatedTradeId: before.tradeId, relatedListingId: before.listingId,
    relatedHref: `/trade-room/${encodeURIComponent(before.id)}`, createdAt: at,
  }));
  const auditLogs: DevelopmentPaymentAuditLogEntry[] = [{ id: `payment-dispute-audit-${key}`, action: "trade_dispute_opened",
    actorUserId: buyer.id, targetUserId: seller.id, listingId: before.listingId, purchaseRequestId: before.id,
    details: "Buyer dispute opened; principal remains reserved and lifecycle is frozen.",
    oldValue: { status: before.status }, newValue: { status: "payment_sent", disputeId: dispute.id }, createdAt: at }];
  const result: DevelopmentPaymentMarketplaceResult = { kind: "dispute", request, listing: structuredClone(listing), trade: physicalTrade(request),
    evidence: [], disputes: [dispute], notifications, notificationUpdates: reminders(marketplace, before, at, true), auditLogs };
  assertFreshEffects(marketplace, before, result);
  return freeze(result);
}
