import { createHash } from "crypto";
import type { AlphaExchangeDb, CommissionRecord, HistoricalTradeCompletion, PurchaseRequest } from "@/types/alpha-exchange";
import { hasRole } from "@/lib/roles";
import { normalizeDisplayNumber } from "@/lib/alpha-exchange-display";
import { calculateSellerCommissionAmount, calculateBuyerCommissionAmount, calculateSellerTotalAlphaDue, calculateTradePaymentTotal, canonicalizeTradeAmount, canonicalizeNonNegativeTradeAmount, subtractTradeAmounts, COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_CUTOVER_VERSION } from "@/lib/trade-amount";

export interface HistoricalTradeReconciliationInput {
  operationId: string;
  actorUserId: string;
  listingId: string;
  requestId: string;
  preservedCompletedRequestIds: string[];
  totalSoldUsdt: string;
  reason: string;
  offlineCompletionConfirmed: true;
  commissionSettledConfirmed: true;
}

export interface HistoricalTradeReconciliationSummary {
  listingId: string;
  requestId: string;
  sellerId: string;
  buyerId: string;
  preservedCompletedRequestIds: string[];
  totalSoldUsdt: string;
  preservedCompletedUsdt: string;
  correctedUsdtAmount: string;
  reconstructedFiatAmount: string;
  pricePerUsdt: string;
  currency: string;
  feePolicyVersion: string;
  commissionCalculationVersion: string;
  fiatAmountBasis: "saved_quote_reconstruction";
  commissionId: string;
  commissionDisplayNumber: number;
  sellerFeeAmount: number;
  buyerFeeCollectedAmount: number;
  commissionAmount: number;
  paymentStatus: "paid";
  settlementSource: "owner_attestation";
  listingStatus: "closed";
  listingAvailableAmount: "0";
}

export interface HistoricalTradeReconciliationPlan {
  snapshot: AlphaExchangeDb;
  changed: boolean;
  operationId: string;
  inputFingerprint: string;
  stateHash: string;
  planHash: string;
  recordedAt: string;
  summary: HistoricalTradeReconciliationSummary;
}

/** Stable across object key order and independently retrieved JSON payloads. */
export function historicalReconciliationHash(value: unknown): string {
  const stable = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)]));
    return item;
  };
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function fail(message: string): never { throw new Error(`Historical reconciliation: ${message}`); }

function normalizeInput(input: HistoricalTradeReconciliationInput): HistoricalTradeReconciliationInput {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,119}$/.test(input.operationId ?? "")) fail("a stable operation ID is required.");
  if (![input.actorUserId, input.listingId, input.requestId].every(value => typeof value === "string" && value.trim() === value && value.length > 0)) fail("exact actor, listing and request identities are required.");
  if (input.offlineCompletionConfirmed !== true || input.commissionSettledConfirmed !== true) fail("explicit owner attestations of completion and settled fees are required.");
  const reason = String(input.reason ?? "").trim();
  if (!reason || reason.length > 1000) fail("a reason of at most 1,000 characters is required.");
  const totalSoldUsdt = canonicalizeTradeAmount(input.totalSoldUsdt);
  if (!totalSoldUsdt || totalSoldUsdt !== input.totalSoldUsdt) fail("the total sold amount must be an exact positive six-decimal USDT amount.");
  if (!Array.isArray(input.preservedCompletedRequestIds) || !input.preservedCompletedRequestIds.length
    || input.preservedCompletedRequestIds.some(id => typeof id !== "string" || !id.trim() || id !== id.trim() || id === input.requestId)
    || new Set(input.preservedCompletedRequestIds).size !== input.preservedCompletedRequestIds.length) fail("distinct preserved completion identities are required.");
  return { operationId: input.operationId, actorUserId: input.actorUserId, listingId: input.listingId, requestId: input.requestId,
    preservedCompletedRequestIds: [...input.preservedCompletedRequestIds].sort(), totalSoldUsdt, reason,
    offlineCompletionConfirmed: true, commissionSettledConfirmed: true };
}

function completed(request: PurchaseRequest) {
  return ["completed", "review_open", "locked"].includes(request.status) || Boolean(request.completedAt);
}

/** This marker is written only by the reasoned owner reconciliation operation. */
export function isOwnerAttestedHistoricalCompletion(request: PurchaseRequest): boolean {
  const marker = request.historicalCompletion;
  return Boolean(marker?.source === "owner_attestation" && marker.offlineCompletionConfirmed === true
    && marker.operationId && /^[a-f0-9]{64}$/.test(marker.inputFingerprint)
    && marker.recordedByUserId && Number.isFinite(Date.parse(marker.recordedAt))
    && ["completed", "review_open", "locked"].includes(request.status) && marker.reconciledUsdtAmount === request.usdtAmount);
}

function commissionIdFor(operationId: string) {
  return `commission-historical-${historicalReconciliationHash(operationId).slice(0, 32)}`;
}

function financialRequest(request: PurchaseRequest) {
  return { id: request.id, sellerId: request.sellerId, buyerId: request.buyerId, listingId: request.listingId,
    status: request.status, usdtAmount: request.usdtAmount, fiatAmount: request.fiatAmount, pricePerUsdt: request.pricePerUsdt,
    currency: request.currency, network: request.network, feePolicyVersion: request.feePolicyVersion,
    commissionCalculationVersion: request.commissionCalculationVersion, termsProposal: request.termsProposal,
    amountAdjustmentCount: request.amountAdjustmentCount, createdAt: request.createdAt, completedAt: request.completedAt,
    tradeCreatedAt: request.tradeCreatedAt, paymentSentAt: request.paymentSentAt, fundsReceivedAt: request.fundsReceivedAt,
    usdtSentAt: request.usdtSentAt, usdtDemandId: request.usdtDemandId, historicalCompletion: request.historicalCompletion,
    buyerReview: request.buyerReview, acceptanceEvents: request.timeline.filter(event => ["request_accepted", "price_offer_accepted"].includes(event.type)) };
}

/** Only relevant facts enter the precondition; chat/read-receipt changes survive a rebase. */
function stateHashFor(db: AlphaExchangeDb, input: HistoricalTradeReconciliationInput, request: PurchaseRequest) {
  const actor = db.users.find(user => user.id === input.actorUserId)!;
  const seller = db.users.find(user => user.id === request.sellerId)!;
  return historicalReconciliationHash({
    actor: { id: actor.id, role: actor.role, roles: actor.roles, disabled: actor.disabled },
    seller: { id: seller.id, sellerStatus: seller.sellerStatus, lifetimeCompletedVolumeUsdt: seller.lifetimeCompletedVolumeUsdt,
      sellerPrestigeRank: seller.sellerPrestigeRank, sellerRankOverride: seller.sellerRankOverride,
      sellerPromotionHistory: seller.sellerPromotionHistory, sellerAchievements: seller.sellerAchievements,
      createdAt: seller.createdAt, sellerApprovalVerification: seller.sellerApprovalVerification,
      profilePresence: [seller.fullName, seller.whatsappNumber, seller.bio, seller.profilePhotoUrl].map(value => Boolean(value?.trim())) },
    listings: db.marketplaceListings.filter(listing => listing.sellerId === request.sellerId).sort((a, b) => a.id.localeCompare(b.id)),
    requests: db.purchaseRequests.filter(item => item.sellerId === request.sellerId || item.buyerId === request.buyerId)
      .map(financialRequest).sort((a, b) => a.id.localeCompare(b.id)),
    commissions: db.commissionRecords.filter(record => record.sellerId === request.sellerId).sort((a, b) => a.id.localeCompare(b.id)),
    commissionNumbers: db.commissionRecords.map(record => ({ id: record.id, displayNumber: record.displayNumber })).sort((a, b) => a.id.localeCompare(b.id)),
    disputes: db.disputes.filter(item => item.sellerId === request.sellerId || item.purchaseRequestId === request.id).sort((a, b) => a.id.localeCompare(b.id)),
    enforcement: (db.marketplaceEnforcementRecords ?? []).filter(item => item.sellerId === request.sellerId).sort((a, b) => a.id.localeCompare(b.id)),
    trust: sourceTrustSnapshot(db, request.sellerId),
    approvalDates: db.auditLogs.filter(entry => entry.targetUserId === request.sellerId && entry.action === "seller_approved").map(entry => entry.createdAt).sort(),
  });
}

function sourceTrustSnapshot(db: AlphaExchangeDb, sellerId: string) {
  return db.trustSnapshots.find(entry => entry.sellerId === sellerId);
}

function summaryFor(input: HistoricalTradeReconciliationInput, request: PurchaseRequest, commission: CommissionRecord,
  correctedAmount: string, correctedFiat: string): HistoricalTradeReconciliationSummary {
  return { listingId: input.listingId, requestId: input.requestId, sellerId: request.sellerId, buyerId: request.buyerId,
    preservedCompletedRequestIds: input.preservedCompletedRequestIds, totalSoldUsdt: input.totalSoldUsdt,
    preservedCompletedUsdt: subtractTradeAmounts(input.totalSoldUsdt, correctedAmount)!, correctedUsdtAmount: correctedAmount,
    reconstructedFiatAmount: correctedFiat, fiatAmountBasis: "saved_quote_reconstruction",
    pricePerUsdt: request.pricePerUsdt!, currency: request.currency, feePolicyVersion: request.feePolicyVersion!,
    commissionCalculationVersion: request.commissionCalculationVersion!,
    commissionId: commission.id, commissionDisplayNumber: commission.displayNumber!, sellerFeeAmount: commission.sellerFeeAmount!,
    buyerFeeCollectedAmount: commission.buyerFeeCollectedAmount!, commissionAmount: commission.commissionAmount,
    paymentStatus: "paid", settlementSource: "owner_attestation", listingStatus: "closed", listingAvailableAmount: "0" };
}

/** Pure, bounded historical bookkeeping. It never invokes live settlement or delivery. */
export function prepareHistoricalTradeReconciliation(source: AlphaExchangeDb, rawInput: HistoricalTradeReconciliationInput,
  recordedAt: string): HistoricalTradeReconciliationPlan {
  const input = normalizeInput(rawInput);
  const inputFingerprint = historicalReconciliationHash(input);
  const actor = source.users.find(user => user.id === input.actorUserId);
  if (!actor || actor.disabled || !hasRole(actor, "owner")) fail("enabled owner access is required.");
  const request = source.purchaseRequests.find(item => item.id === input.requestId);
  const listing = source.marketplaceListings.find(item => item.id === input.listingId);
  if (!request || !listing || request.listingId !== listing.id || request.sellerId !== listing.sellerId
    || !source.users.some(user => user.id === request.sellerId) || !source.users.some(user => user.id === request.buyerId)) fail("the recorded listing and participants do not match.");
  if (request.commissionCalculationVersion !== COMMISSION_CALCULATION_VERSION
    || request.feePolicyVersion !== MARKETPLACE_FEE_CUTOVER_VERSION || !request.pricePerUsdt) fail("the saved quote and supported fee policy are required.");
  const commissionId = commissionIdFor(input.operationId);
  const marker = request.historicalCompletion;
  if (marker) {
    const commission = source.commissionRecords.find(record => record.id === commissionId);
    const listingMarker = listing.historicalCompletionReconciliation;
    if (marker.operationId !== input.operationId || marker.inputFingerprint !== inputFingerprint) fail("this trade has a different historical reconciliation.");
    const sameAttestation = (stamp: CommissionRecord["ownerSettlementAttestation"]) => stamp?.source === "owner_attestation"
      && stamp.operationId === input.operationId && stamp.inputFingerprint === inputFingerprint && stamp.recordedAt === marker.recordedAt
      && stamp.recordedByUserId === input.actorUserId && stamp.reason === input.reason;
    if (!isOwnerAttestedHistoricalCompletion(request) || !sameAttestation(marker) || listing.status !== "closed" || listing.availableAmount !== "0"
      || request.pricePerUsdt !== marker.originalTerms.pricePerUsdt || request.fiatAmount !== marker.reconstructedFiatAmount
      || marker.fiatAmountBasis !== "saved_quote_reconstruction" || marker.listingTotalUsdt !== input.totalSoldUsdt
      || JSON.stringify(marker.preservedCompletedRequestIds) !== JSON.stringify(input.preservedCompletedRequestIds)
      || canonicalizeTradeAmount(listing.originalAmount) !== input.totalSoldUsdt
      || listingMarker?.operationId !== input.operationId || listingMarker.inputFingerprint !== inputFingerprint
      || listingMarker.requestId !== request.id || !sameAttestation(listingMarker)
      || !commission || commission.purchaseRequestId !== request.id || commission.paymentStatus !== "paid"
      || commission.source !== "trade" || commission.sellerId !== request.sellerId || commission.buyerId !== request.buyerId
      || commission.listingId !== listing.id || commission.grossCurrency !== request.currency || commission.grossAmount !== Number(request.fiatAmount)
      || commission.feePolicyVersion !== request.feePolicyVersion || commission.commissionCalculationVersion !== request.commissionCalculationVersion
      || !sameAttestation(commission.ownerSettlementAttestation)
      || source.commissionRecords.filter(record => record.purchaseRequestId === request.id).length !== 1) fail("the recorded reconciliation is incomplete or changed.");
    const summary = summaryFor(input, request, commission, marker.reconciledUsdtAmount, marker.reconstructedFiatAmount);
    if (historicalReconciliationHash({ inputFingerprint, stateHash: marker.stateHash, summary }) !== marker.planHash) fail("the reconciled financial plan has changed.");
    return { snapshot: structuredClone(source), changed: false, operationId: input.operationId, inputFingerprint,
      stateHash: marker.stateHash, planHash: marker.planHash, recordedAt: marker.recordedAt,
      summary };
  }
  if (source.purchaseRequests.some(item => item.historicalCompletion?.operationId === input.operationId)
    || source.marketplaceListings.some(item => item.historicalCompletionReconciliation?.operationId === input.operationId)
    || source.commissionRecords.some(record => record.id === commissionId || record.ownerSettlementAttestation?.operationId === input.operationId)) fail("the operation identity has already been used.");
  if (listing.status !== "closed" || !listing.closedAt || listing.activeTradeRequestId || listing.lockedAt
    || listing.historicalCompletionReconciliation) fail("the listing must remain closed without an active trade.");
  if (canonicalizeTradeAmount(listing.originalAmount) !== input.totalSoldUsdt) fail("the owner-attested total must equal the listing's original inventory.");
  if (!["declined", "cancelled", "pending"].includes(request.status) || completed(request) || request.usdtDemandId
    || request.termsProposal) fail("this request is not an uncompleted listing request eligible for the bounded correction.");
  if (source.commissionRecords.some(record => record.purchaseRequestId === request.id)) fail("a commission already exists for the target request.");
  if (source.disputes.some(dispute => dispute.purchaseRequestId === request.id)) fail("a disputed request needs its own explicit resolution.");
  const listingRequests = source.purchaseRequests.filter(item => item.listingId === listing.id);
  const completedIds = listingRequests.filter(completed).map(item => item.id).sort();
  if (JSON.stringify(completedIds) !== JSON.stringify(input.preservedCompletedRequestIds)) fail("the preserved completed trades do not match canonical listing history.");
  if (listingRequests.some(item => item.id !== request.id && !completed(item) && !["declined", "cancelled"].includes(item.status))) fail("another unresolved request remains on this listing.");
  let correctedAmount = input.totalSoldUsdt;
  for (const id of input.preservedCompletedRequestIds) {
    const anchor = listingRequests.find(item => item.id === id)!;
    if (anchor.sellerId !== request.sellerId) fail("a preserved trade belongs to another seller.");
    const remaining = subtractTradeAmounts(correctedAmount, anchor.usdtAmount);
    if (remaining === null) fail("recorded completions exceed the attested inventory.");
    correctedAmount = remaining;
  }
  if (!canonicalizeTradeAmount(correctedAmount) || canonicalizeNonNegativeTradeAmount(listing.availableAmount) !== correctedAmount
    || subtractTradeAmounts(listing.availableAmount, correctedAmount) !== "0") fail("the residual does not exactly match available inventory.");
  if (subtractTradeAmounts(request.usdtAmount, correctedAmount) === null) fail("the correction must not increase the requested amount.");
  const priorTimes = [listing.updatedAt, request.updatedAt, listing.closedAt].map(value => Date.parse(value));
  if (!Number.isFinite(Date.parse(recordedAt)) || new Date(recordedAt).toISOString() !== recordedAt || priorTimes.some(time => !Number.isFinite(time))
    || Date.parse(recordedAt) <= Math.max(...priorTimes)) fail("the recording time must follow the existing history.");
  const fiatAmount = calculateTradePaymentTotal(correctedAmount, request.pricePerUsdt, true);
  const sellerFeeAmount = calculateSellerCommissionAmount(correctedAmount);
  const buyerFeeCollectedAmount = calculateBuyerCommissionAmount(correctedAmount);
  const commissionAmount = calculateSellerTotalAlphaDue(correctedAmount);
  if (!fiatAmount || sellerFeeAmount === null || buyerFeeCollectedAmount === null || commissionAmount === null) fail("the saved quote cannot be reconstructed safely.");
  const numbered = source.commissionRecords.map(record => normalizeDisplayNumber(record.displayNumber));
  if (numbered.some(number => number === undefined)) fail("all existing commissions must be numbered before allocating a historical record.");
  const nextDisplayNumber = Math.max(0, ...numbered as number[]) + 1;
  if (!Number.isSafeInteger(nextDisplayNumber)) fail("the next commission display number is invalid.");
  const stateHash = stateHashFor(source, input, request);
  const stamp = { source: "owner_attestation" as const, operationId: input.operationId, inputFingerprint, recordedAt,
    recordedByUserId: input.actorUserId, reason: input.reason };
  const commission: CommissionRecord = { id: commissionId, displayNumber: nextDisplayNumber, source: "trade",
    purchaseRequestId: request.id, tradeId: request.tradeId, listingId: listing.id, sellerId: request.sellerId, buyerId: request.buyerId,
    commissionCalculationVersion: request.commissionCalculationVersion, feePolicyVersion: request.feePolicyVersion,
    rate: 0.01, grossAmount: Number(fiatAmount), grossCurrency: request.currency, sellerFeeAmount, buyerFeeCollectedAmount,
    commissionAmount, paymentStatus: "paid", ownerSettlementAttestation: stamp,
    paymentVerificationNotes: "Historical fee settlement recorded from the owner's attestation; no provider receipt or payment time was supplied.",
    createdAt: recordedAt, updatedAt: recordedAt };
  const summary = summaryFor(input, request, commission, correctedAmount, fiatAmount);
  const planHash = historicalReconciliationHash({ inputFingerprint, stateHash, summary });
  const historicalCompletion: HistoricalTradeCompletion = { ...stamp, offlineCompletionConfirmed: true,
    originalTerms: { status: request.status, usdtAmount: request.usdtAmount, fiatAmount: request.fiatAmount, pricePerUsdt: request.pricePerUsdt },
    reconciledUsdtAmount: correctedAmount, reconstructedFiatAmount: fiatAmount, fiatAmountBasis: "saved_quote_reconstruction",
    listingTotalUsdt: input.totalSoldUsdt, preservedCompletedRequestIds: input.preservedCompletedRequestIds, stateHash, planHash };
  const snapshot = structuredClone(source);
  const next = snapshot.purchaseRequests.find(item => item.id === request.id)!;
  Object.assign(next, { usdtAmount: correctedAmount, fiatAmount, status: "completed", historicalCompletion,
    reviewUnlockedAt: recordedAt, updatedAt: recordedAt });
  delete next.actionReminderState;
  next.timeline = [...next.timeline, { id: `timeline-historical-${historicalReconciliationHash(input.operationId).slice(0, 32)}`,
    type: "trade_completed", actorUserId: actor.id, actorRole: "owner", createdAt: recordedAt,
    message: "Owner recorded an externally completed trade and reconciled its amount. This is the recording time; the external completion time was not supplied." }];
  const nextListing = snapshot.marketplaceListings.find(item => item.id === listing.id)!;
  Object.assign(nextListing, { availableAmount: "0", updatedAt: recordedAt,
    historicalCompletionReconciliation: { ...stamp, requestId: request.id } });
  snapshot.commissionRecords.push(commission);
  snapshot.auditLogs.unshift({ id: `audit-historical-${historicalReconciliationHash(input.operationId).slice(0, 32)}`,
    action: "admin_override", actorUserId: actor.id, targetUserId: request.sellerId, listingId: listing.id, purchaseRequestId: request.id,
    createdAt: recordedAt, reason: input.reason,
    details: "Owner-attested historical completion and settled fees recorded without new transfers, provider verification, reviews, or participant acknowledgments.",
    oldValue: { kind: "historical_trade_reconciliation", request: financialRequest(request), listing: { status: listing.status,
      availableAmount: listing.availableAmount, originalAmount: listing.originalAmount, closedAt: listing.closedAt } },
    newValue: { kind: "historical_trade_reconciliation", operationId: input.operationId, inputFingerprint, stateHash, planHash, ...summary,
      externalCompletionTimeKnown: false, externalPaymentTimeKnown: false, providerReceiptVerified: false } });
  return { snapshot, changed: true, operationId: input.operationId, inputFingerprint, stateHash, planHash, recordedAt, summary };
}
