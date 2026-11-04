import "server-only";

import {
  calculateBuyerCommissionAmount,
  calculateSellerCommissionAmount,
  calculateSellerTotalAlphaDue,
  calculateTradeTermsQuote,
  COMMISSION_CALCULATION_VERSION,
  getTradeAmountAdjustmentCount,
  isNegotiatingQuantityFixed,
  MARKETPLACE_FEE_POLICY,
  MAX_TRADE_AMOUNT_ADJUSTMENTS,
} from "@alpha-traders/contracts";
import { normalizeMarketplacePaymentMethod, type MarketplacePaymentMethod } from "@/lib/marketplace-payment-methods";
import { areTradeAmountsLocked } from "@/lib/trade-amount-lock";
import { isDemandReservedTrade } from "@/lib/usdt-demand-policy";
import type { MarketplaceListing, PurchaseRequest, TradeDisputeCase, TradeEvidenceFile } from "@/types/alpha-exchange";
import { assetFor, formatUnits, parseUnits, quoteTrade, ZERO, type AssetId } from "./amounts";
import { walletDigest } from "./commands";
import { assertLedgerInvariants, balance } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import type { State, Trade } from "./types";

/** This is a development enrollment contract, not a v1 wallet command or event. */
export const DEVELOPMENT_TERMS_BINDING_VERSION = "alpha-wallet-development-terms-binding-v1" as const;

type Frozen<T> = T extends object ? { readonly [K in keyof T]: Frozen<T[K]> } : T;

export type DevelopmentTermsBinding = {
  version: typeof DEVELOPMENT_TERMS_BINDING_VERSION;
  platformRequestId: string;
  platformListingId: string;
  walletListingId: string;
  assetId: AssetId;
  revision: number;
  termsDigest: string;
  reservation: { kind: "unreserved" } | { kind: "reserved"; walletTradeId: string; walletTradeDigest: string };
};

export type DevelopmentTradeTerms = {
  platformRequestId: string;
  platformTradeId: string | null;
  platformListingId: string;
  walletListingId: string;
  sellerId: string;
  buyerId: string;
  assetId: AssetId;
  receivingNetwork: "TRC20" | "BEP20";
  destination: string;
  currency: "ILS";
  paymentMethod: MarketplacePaymentMethod;
  paymentInstructionsDigest: string;
  priceMode: "listing_price" | "buyer_offer" | null;
  listingPriceAtRequest: string | null;
  feePolicyVersion: typeof MARKETPLACE_FEE_POLICY;
  commissionCalculationVersion: typeof COMMISSION_CALCULATION_VERSION;
  usdtAmount: string;
  pricePerUsdt: string;
  fiatAmount: string;
  principalRaw: string;
  buyerFeeRaw: string;
  sellerFeeRaw: string;
  totalFeeRaw: string;
  fiatTotalMinor: string;
};

export type DevelopmentTermsDescription = Frozen<{
  executionAuthority: false;
  terms: DevelopmentTradeTerms;
  digest: string;
}>;

/**
 * All records must be read together by a trusted, fenced transaction coordinator.
 * These structural types cannot authenticate a caller, prove canonical provenance,
 * prove a complete inventory, or turn an arbitrary snapshot into verified replay.
 * No client-created accepted flag, quote, fees, or payment proof is an input.
 */
export type AcceptedAmountTermsContext = {
  mode: "simulation-only";
  actorUserId: string;
  requestId: string;
  proposalId: string;
  expectedBindingRevision: number;
  marketplace: {
    purchaseRequests: readonly PurchaseRequest[];
    marketplaceListings: readonly MarketplaceListing[];
    tradeEvidenceFiles: readonly Pick<TradeEvidenceFile, "id" | "purchaseRequestId" | "side">[];
    disputes: readonly Pick<TradeDisputeCase, "id" | "purchaseRequestId" | "status">[];
  };
  wallet: { revision: number; eventHash: string; state: State };
  binding: DevelopmentTermsBinding;
};

export type AcceptedAmountTermsPlan = Frozen<{
  kind: "alpha-wallet-development-accepted-amount-plan-v1";
  mode: "simulation-only";
  executionAuthority: false;
  acceptanceKey: string;
  inputDigest: string;
  actorUserId: string;
  requestId: string;
  proposalId: string;
  submittedAdjustmentCount: number;
  prior: DevelopmentTermsDescription;
  accepted: DevelopmentTermsDescription;
  termsPrincipalDeltaRaw: string;
  nextBindingRevision: number;
  invalidatePreparedCardlessCredentials: boolean;
  preconditions: {
    requestUpdatedAt: string;
    requestDigest: string;
    listingDigest: string;
    proposalDigest: string;
    bindingRevision: number;
    bindingDigest: string;
    walletRevision: number;
    walletEventHash: string;
    walletStateDigest: string;
    walletTradeDigest: string | null;
    inventoryDigest: string;
    evidenceDigest: string;
    disputesDigest: string;
  };
  reservation: {
    action: "no_reservation" | "increase" | "decrease" | "unchanged";
    assetId: AssetId;
    walletTradeId: string | null;
    principalDeltaRaw: string;
    transferAmountRaw: string;
    fromAccount: string | null;
    toAccount: string | null;
    expectedListingAvailableRaw: string;
    expectedTradeReservedRaw: string;
    availableForRequestRaw: string;
  };
}>;

export class AcceptedTermsPlanningError extends Error {
  constructor(readonly code: "INVALID" | "UNSUPPORTED" | "ACTOR" | "STALE" | "LOCKED" | "INTEGRITY" | "UNAVAILABLE", message: string) {
    super(message);
    this.name = "AcceptedTermsPlanningError";
  }
}

function reject(code: AcceptedTermsPlanningError["code"], message: string): never {
  throw new AcceptedTermsPlanningError(code, message);
}

function freeze<T>(value: T): Frozen<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Frozen<T>;
}

function identifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) reject("INVALID", `Invalid ${label}`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) reject("INVALID", `Invalid ${label}`);
}

function revision(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) reject("INVALID", `Invalid ${label}`);
}

/** No toFixed rounding, exponent expansion, locale coercion, or unsafe legacy numbers. */
function exactDecimal(value: unknown, decimals: number, label: string): { value: string; units: bigint } {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) reject("INVALID", `Invalid ${label}`);
  if (typeof raw !== "string") reject("INVALID", `Invalid ${label}`);
  let units: bigint;
  try { units = parseUnits(raw, decimals); } catch { return reject("INVALID", `Invalid exact ${label}`); }
  const canonical = formatUnits(units, decimals);
  if (typeof value === "number" && (units > BigInt(Number.MAX_SAFE_INTEGER) || Number(canonical) !== value)) {
    reject("INVALID", `Unsafe numeric ${label}`);
  }
  return { value: canonical, units };
}

function quantity(value: unknown, label: string) {
  const amount = exactDecimal(value, 6, label);
  if (amount.value.split(".")[0]!.length > 9) reject("UNSUPPORTED", `${label} exceeds the marketplace quote range`);
  return amount;
}

function price(value: unknown, label: string) {
  const amount = exactDecimal(value, 2, label);
  if (amount.units <= ZERO || amount.value.split(".")[0]!.length > 7) reject("UNSUPPORTED", `Unsupported ${label}`);
  return fixed(amount.units, 2);
}

function fixed(units: bigint, decimals: number) {
  const scale = BigInt(10) ** BigInt(decimals);
  return `${units / scale}.${(units % scale).toString().padStart(decimals, "0")}`;
}

function instructionsDigest(request: PurchaseRequest, method: MarketplacePaymentMethod) {
  if (request.bankTransferProvider && request.bankTransferProvider !== "israeli_bank") reject("UNSUPPORTED", "Unsupported payment provider");
  if (request.sellerWiseAccountId || request.buyerWiseAccountId || request.sellerWiseAccountSnapshot || request.buyerWiseAccountSnapshot) {
    reject("UNSUPPORTED", "Wise payment terms have no wallet mapping");
  }
  if (method === "Bank Transfer") {
    identifier(request.sellerBankAccountId, "frozen payment account ID");
    const snapshot = request.sellerBankAccountSnapshot;
    if (!snapshot || [snapshot.accountHolderName, snapshot.bankName, snapshot.branchNumber, snapshot.accountNumber, snapshot.accountLast4]
      .some(value => typeof value !== "string" || !value.trim())) reject("UNSUPPORTED", "Frozen bank payment instructions are required");
    // Private instructions are bound, never returned or used as payment evidence.
    return walletDigest({ method, accountId: request.sellerBankAccountId, provider: request.bankTransferProvider ?? null,
      bankName: request.bankName ?? null, snapshot: { accountHolderName: snapshot.accountHolderName, bankName: snapshot.bankName,
        branchNumber: snapshot.branchNumber, accountNumber: snapshot.accountNumber, accountLast4: snapshot.accountLast4 } });
  }
  if (method === "Cardless ATM Withdrawal" && (typeof request.bankName !== "string" || !request.bankName.trim())) {
    reject("UNSUPPORTED", "Cardless terms require their selected bank");
  }
  return walletDigest({ method, bankName: request.bankName ?? null, provider: request.bankTransferProvider ?? null,
    accountId: request.sellerBankAccountId ?? null });
}

function deriveTerms(request: PurchaseRequest, assetId: AssetId, walletListingId: string): DevelopmentTradeTerms {
  const asset = assetFor(assetId);
  for (const [label, value] of Object.entries({ requestId: request.id, listingId: request.listingId, walletListingId,
    buyerId: request.buyerId, sellerId: request.sellerId })) identifier(value, label);
  if (request.tradeId !== undefined) identifier(request.tradeId, "platform trade ID");
  if (request.sellerId === request.buyerId) reject("INTEGRITY", "Trade participants must be distinct");
  if (request.feePolicyVersion !== MARKETPLACE_FEE_POLICY || request.commissionCalculationVersion !== COMMISSION_CALCULATION_VERSION) {
    reject("UNSUPPORTED", "Only the current marketplace fee and commission policy is mapped");
  }
  if (request.currency !== "ILS") reject("UNSUPPORTED", "Only ILS terms are mapped");
  const receivingNetwork = assetId === "tron-sim-usdt" ? "TRC20" : "BEP20";
  if (request.network !== receivingNetwork) reject("INTEGRITY", "Receiving network and simulation asset disagree");
  const prefix = `sim://${assetId}/recipient/`;
  const destination = request.buyerReceivingWalletAddress;
  if (typeof destination !== "string" || !destination.startsWith(prefix) || !/^[A-Za-z0-9_-]{1,80}$/.test(destination.slice(prefix.length))) {
    reject("UNSUPPORTED", "Only the exact recorded simulation destination is mapped");
  }
  const paymentMethod = normalizeMarketplacePaymentMethod(request.paymentMethod);
  if (!paymentMethod) reject("UNSUPPORTED", "Unsupported payment method");
  const paymentInstructionsDigest = instructionsDigest(request, paymentMethod);
  if (request.priceMode !== undefined && request.priceMode !== "listing_price" && request.priceMode !== "buyer_offer") reject("UNSUPPORTED", "Unsupported price mode");
  // The current listing price is never a fallback for missing frozen request terms.
  const pricePerUsdt = price(request.pricePerUsdt, "locked price");
  const listingPriceAtRequest = request.listingPriceAtRequest === undefined ? null : price(request.listingPriceAtRequest, "original listing price");
  const usdtAmount = quantity(request.usdtAmount, "principal").value;
  const fiat = exactDecimal(request.fiatAmount, 2, "fiat amount");
  let quote: ReturnType<typeof quoteTrade>;
  try { quote = quoteTrade(assetId, usdtAmount, pricePerUsdt); } catch { return reject("UNSUPPORTED", "Unpayable wallet quote"); }
  const contractQuote = calculateTradeTermsQuote({ paymentMethod, currency: request.currency, usdtAmount,
    fiatAmount: fixed(fiat.units, 2), pricePerUsdt, feePolicyVersion: request.feePolicyVersion }, "propose_amount", usdtAmount);
  if (!contractQuote || contractQuote.usdtAmount !== usdtAmount || contractQuote.pricePerUsdt !== pricePerUsdt
    || exactDecimal(contractQuote.fiatAmount, 2, "contract fiat").units !== quote.fiatTotalMinor) {
    reject("UNSUPPORTED", "Marketplace and wallet quotes disagree");
  }
  if (fiat.units !== quote.fiatTotalMinor) reject("INTEGRITY", "Recorded fiat amount differs from the canonical quote");
  const scale = BigInt(10) ** BigInt(asset.decimals - 6);
  for (const [value, expected] of [
    [calculateBuyerCommissionAmount(usdtAmount), quote.buyerFeeRaw],
    [calculateSellerCommissionAmount(usdtAmount), quote.sellerFeeRaw],
    [calculateSellerTotalAlphaDue(usdtAmount), quote.totalFeeRaw],
  ] as const) {
    if (value === null || exactDecimal(value, 6, "contract commission").units * scale !== expected) {
      reject("INTEGRITY", "Marketplace and wallet commissions disagree");
    }
  }
  return { platformRequestId: request.id, platformTradeId: request.tradeId ?? null, platformListingId: request.listingId,
    walletListingId, sellerId: request.sellerId, buyerId: request.buyerId, assetId, receivingNetwork, destination,
    currency: "ILS", paymentMethod, paymentInstructionsDigest, priceMode: request.priceMode ?? null, listingPriceAtRequest,
    feePolicyVersion: MARKETPLACE_FEE_POLICY, commissionCalculationVersion: COMMISSION_CALCULATION_VERSION,
    usdtAmount, pricePerUsdt, fiatAmount: fixed(fiat.units, 2), principalRaw: quote.principalRaw.toString(),
    buyerFeeRaw: quote.buyerFeeRaw.toString(), sellerFeeRaw: quote.sellerFeeRaw.toString(), totalFeeRaw: quote.totalFeeRaw.toString(),
    fiatTotalMinor: quote.fiatTotalMinor.toString() };
}

function description(terms: DevelopmentTradeTerms): DevelopmentTermsDescription {
  return freeze({ executionAuthority: false as const, terms, digest: walletDigest(terms) });
}

/** Derivation aid for future explicit enrollment; this does not authorize enrollment. */
export function describeDevelopmentTradeTerms(input: {
  mode: "simulation-only"; request: PurchaseRequest; assetId: AssetId; walletListingId: string;
}): DevelopmentTermsDescription {
  assertSimulationRuntime(input.mode);
  return description(deriveTerms(input.request, input.assetId, input.walletListingId));
}

function unique<T extends { id: string }>(items: readonly T[], id: string, label: string) {
  const matches = items.filter(item => item.id === id);
  if (matches.length !== 1) reject("INTEGRITY", `Expected one canonical ${label}`);
  return matches[0]!;
}

function assertCleanReservation(trade: Trade, terms: DevelopmentTradeTerms, expectedDigest: string, state: State) {
  if (walletDigest(trade) !== expectedDigest) reject("STALE", "Wallet trade binding is stale");
  if (trade.status !== "reserved" || trade.disputed !== false || trade.evidence !== undefined
    || trade.authorization !== undefined || trade.payoutId !== undefined
    || [...state.evidenceOwners.values()].some(owner => owner === trade.id)
    || [...state.payouts.values()].some(payout => payout.tradeId === trade.id)
    || [...state.commissions.values()].some(commission => commission.tradeId === trade.id)) {
    reject("LOCKED", "Wallet reservation already has payment, dispute, authorization, or settlement progress");
  }
  if (trade.listingId !== terms.walletListingId || trade.sellerId !== terms.sellerId || trade.buyerId !== terms.buyerId
    || trade.assetId !== terms.assetId || trade.destination !== terms.destination || trade.currency !== terms.currency
    || trade.amountRaw.toString() !== terms.principalRaw || trade.buyerFeeRaw.toString() !== terms.buyerFeeRaw
    || trade.sellerFeeRaw.toString() !== terms.sellerFeeRaw || trade.totalFeeRaw.toString() !== terms.totalFeeRaw
    || trade.fiatTotalMinor.toString() !== terms.fiatTotalMinor) reject("INTEGRITY", "Wallet reservation does not match canonical prior terms");
}

/**
 * Plan buyer acceptance of a stored seller amount correction. This function writes
 * nothing: it cannot reserve, resize, accept, or disclose credentials. An eventual
 * versioned transition needs one outer transaction, durable acceptance receipts,
 * complete enrolled context, and revalidation of every precondition at commit.
 */
export function planAcceptedAmountTerms(context: AcceptedAmountTermsContext): AcceptedAmountTermsPlan {
  assertSimulationRuntime(context.mode);
  identifier(context.actorUserId, "authenticated actor ID");
  identifier(context.requestId, "request ID");
  identifier(context.proposalId, "proposal ID");
  const { binding, marketplace, wallet } = context;
  if (binding.version !== DEVELOPMENT_TERMS_BINDING_VERSION) reject("UNSUPPORTED", "Unsupported development binding version");
  revision(binding.revision, "binding revision");
  revision(context.expectedBindingRevision, "expected binding revision");
  revision(wallet.revision, "wallet revision");
  digest(binding.termsDigest, "terms digest");
  digest(wallet.eventHash, "wallet event hash");
  if (binding.revision !== context.expectedBindingRevision) reject("STALE", "Terms binding revision changed");
  if (binding.revision === Number.MAX_SAFE_INTEGER) reject("UNSUPPORTED", "Binding revision exhausted");
  const request = unique(marketplace.purchaseRequests, context.requestId, "request");
  const listing = unique(marketplace.marketplaceListings, request.listingId, "listing");
  if (binding.platformRequestId !== request.id || binding.platformListingId !== request.listingId) reject("INTEGRITY", "Binding identity mismatch");
  if (context.actorUserId !== request.buyerId) reject("ACTOR", "Only the canonical buyer can accept the seller proposal");
  if (request.status !== "pending" && request.status !== "accepted") reject("LOCKED", "Request is outside amount correction stages");
  if (isNegotiatingQuantityFixed(request)) reject("UNSUPPORTED", "Negotiating demand and buyer-offer quantities are fixed");
  if (areTradeAmountsLocked(request)
    || marketplace.tradeEvidenceFiles.some(file => file.purchaseRequestId === request.id && (file.side === "buyer" || file.side === "seller"))
    || marketplace.disputes.some(dispute => dispute.purchaseRequestId === request.id && dispute.status === "open")) {
    reject("LOCKED", "Canonical payment, evidence, dispute, or disclosure history locks the terms");
  }
  const proposal = request.termsProposal;
  if (!proposal || proposal.id !== context.proposalId || proposal.status !== "pending" || proposal.resolvedAt !== undefined) {
    reject("STALE", "The exact pending seller proposal is required");
  }
  if (proposal.kind !== "amount_correction") reject("UNSUPPORTED", "Counter-offer and initial acceptance require separate transitions");
  if (!Number.isFinite(Date.parse(request.updatedAt)) || !Number.isFinite(Date.parse(proposal.createdAt))
    || Date.parse(proposal.createdAt) > Date.parse(request.updatedAt)) reject("INTEGRITY", "Invalid canonical proposal chronology");
  const storedCount = request.amountAdjustmentCount;
  const historyCount = request.messages?.filter(message => message.kind === "system"
    && /^Seller proposed .+ Buyer confirmation required\.$/.test(message.message)).length ?? 0;
  if ((storedCount !== undefined && (!Number.isSafeInteger(storedCount) || storedCount < 0 || storedCount > MAX_TRADE_AMOUNT_ADJUSTMENTS))
    || historyCount > MAX_TRADE_AMOUNT_ADJUSTMENTS) reject("INTEGRITY", "Submitted proposal limit is inconsistent");
  const submittedAdjustmentCount = getTradeAmountAdjustmentCount(request);
  const prior = description(deriveTerms(request, binding.assetId, binding.walletListingId));
  if (prior.digest !== binding.termsDigest) reject("STALE", "Canonical terms no longer match the enrollment binding");
  if (price(proposal.pricePerUsdt, "proposal price") !== prior.terms.pricePerUsdt) {
    reject("INTEGRITY", "An amount correction must preserve the locked unit price");
  }
  const accepted = description(deriveTerms({ ...request, usdtAmount: proposal.usdtAmount, fiatAmount: proposal.fiatAmount,
    pricePerUsdt: proposal.pricePerUsdt }, binding.assetId, binding.walletListingId));
  const state = wallet.state;
  if (state.haltReason !== null) reject("LOCKED", "Wallet simulation is paused");
  try { assertLedgerInvariants(state); } catch { return reject("INTEGRITY", "Wallet snapshot fails ledger invariants"); }
  const walletListing = state.listings.get(binding.walletListingId);
  if (!walletListing || walletListing.id !== binding.walletListingId || walletListing.sellerId !== request.sellerId
    || walletListing.assetId !== binding.assetId || walletListing.currency !== "ILS") reject("INTEGRITY", "Wallet listing identity mismatch");
  if (!walletListing.approved || !walletListing.funded || walletListing.closed) reject("LOCKED", "Wallet listing must be fully funded, owner-approved, and open");
  if (listing.sellerId !== request.sellerId || listing.network !== request.network || listing.currency !== "ILS") reject("INTEGRITY", "Marketplace listing identity mismatch");
  // listing.lockedAt is the ordinary inventory lock set on acceptance; only the
  // request's irreversible progress lock prohibits an accepted amount correction.
  if (!["active", "matched", "in_trade"].includes(listing.status) || listing.closedAt
    || listing.expiredAt || listing.cancelledAt || listing.completedAt || listing.approvalStatus !== "approved") {
    reject("UNSUPPORTED", "Marketplace listing state is outside the enrolled correction cohort");
  }
  if (listing.bankTransferProvider === "wise" || listing.wiseAccountId) reject("UNSUPPORTED", "Wise listing terms have no wallet mapping");
  let trade: Trade | undefined;
  if (request.status === "pending") {
    if (binding.reservation.kind !== "unreserved") reject("INTEGRITY", "An ordinary pending request must remain unreserved");
  } else {
    if (binding.reservation.kind !== "reserved") reject("INTEGRITY", "Accepted request requires its existing wallet reservation");
    identifier(binding.reservation.walletTradeId, "wallet trade ID");
    digest(binding.reservation.walletTradeDigest, "wallet trade digest");
    trade = state.trades.get(binding.reservation.walletTradeId);
    if (!trade || trade.id !== binding.reservation.walletTradeId) reject("INTEGRITY", "Accepted request wallet reservation is missing");
    assertCleanReservation(trade, prior.terms, binding.reservation.walletTradeDigest, state);
    // v1 reserved from its immutable wallet listing price; it stores no trade price.
    if (price(walletListing.price, "wallet listing price") !== prior.terms.pricePerUsdt) reject("INTEGRITY", "Existing v1 reservation has a different locked price");
  }
  const decimals = assetFor(binding.assetId).decimals;
  const scale = BigInt(10) ** BigInt(decimals - 6);
  let available = quantity(listing.availableAmount, "listing available principal").units * scale;
  const seen = new Set<string>();
  const inventory = marketplace.purchaseRequests.filter(item => item.listingId === listing.id);
  for (const other of inventory) {
    if (seen.has(other.id)) reject("INTEGRITY", "Duplicate canonical inventory request");
    seen.add(other.id);
    if (other.id === request.id || !isDemandReservedTrade(other)) continue;
    if (other.sellerId !== request.sellerId || other.network !== request.network || other.currency !== request.currency) {
      reject("INTEGRITY", "Competing inventory identity mismatch");
    }
    const reserved = quantity(other.usdtAmount, "competing reserved principal").units * scale;
    if (reserved <= ZERO) reject("INTEGRITY", "Competing reservation must be positive");
    available -= reserved;
  }
  const listingAvailable = balance(state, binding.assetId, `listing:${binding.walletListingId}`);
  const tradeReserved = trade ? balance(state, binding.assetId, `trade:${trade.id}`) : ZERO;
  if (available < ZERO || available !== listingAvailable + tradeReserved) reject("INTEGRITY", "Marketplace inventory and wallet capacity disagree");
  const minimum = quantity(listing.minimumTrade, "listing minimum").units * scale;
  const maximum = quantity(listing.maximumTrade === "" ? listing.availableAmount : listing.maximumTrade, "listing maximum").units * scale;
  const effectiveMinimum = prior.terms.paymentMethod === "Cardless ATM Withdrawal" ? ZERO : minimum;
  const acceptedPrincipal = BigInt(accepted.terms.principalRaw);
  if (maximum < effectiveMinimum || acceptedPrincipal > available || acceptedPrincipal > maximum || acceptedPrincipal < effectiveMinimum) {
    reject("UNAVAILABLE", "Proposed principal is no longer available within canonical trade limits");
  }
  const termsDelta = acceptedPrincipal - BigInt(prior.terms.principalRaw);
  const delta = trade ? termsDelta : ZERO;
  const action = !trade ? "no_reservation" : delta > ZERO ? "increase" : delta < ZERO ? "decrease" : "unchanged";
  const preconditions = {
    requestUpdatedAt: request.updatedAt, requestDigest: walletDigest(request), listingDigest: walletDigest(listing),
    proposalDigest: walletDigest(proposal), bindingRevision: binding.revision, bindingDigest: walletDigest(binding),
    walletRevision: wallet.revision, walletEventHash: wallet.eventHash, walletStateDigest: walletDigest(state),
    walletTradeDigest: trade ? walletDigest(trade) : null, inventoryDigest: walletDigest(inventory),
    evidenceDigest: walletDigest(marketplace.tradeEvidenceFiles.filter(file => file.purchaseRequestId === request.id)),
    disputesDigest: walletDigest(marketplace.disputes.filter(dispute => dispute.purchaseRequestId === request.id)),
  };
  return freeze({ kind: "alpha-wallet-development-accepted-amount-plan-v1", mode: "simulation-only", executionAuthority: false,
    acceptanceKey: walletDigest(["alpha-wallet-amount-acceptance", request.id, proposal.id]),
    inputDigest: walletDigest({ actorUserId: context.actorUserId, prior: prior.digest, accepted: accepted.digest, preconditions }),
    actorUserId: context.actorUserId, requestId: request.id, proposalId: proposal.id, submittedAdjustmentCount,
    prior, accepted, termsPrincipalDeltaRaw: termsDelta.toString(), nextBindingRevision: binding.revision + 1,
    invalidatePreparedCardlessCredentials: prior.terms.paymentMethod === "Cardless ATM Withdrawal" && prior.terms.fiatAmount !== accepted.terms.fiatAmount,
    preconditions, reservation: { action, assetId: binding.assetId, walletTradeId: trade?.id ?? null,
      principalDeltaRaw: delta.toString(), transferAmountRaw: (delta < ZERO ? -delta : delta).toString(),
      fromAccount: delta > ZERO ? `listing:${binding.walletListingId}` : delta < ZERO ? `trade:${trade!.id}` : null,
      toAccount: delta > ZERO ? `trade:${trade!.id}` : delta < ZERO ? `listing:${binding.walletListingId}` : null,
      expectedListingAvailableRaw: listingAvailable.toString(), expectedTradeReservedRaw: tradeReserved.toString(),
      availableForRequestRaw: available.toString() },
  });
}
