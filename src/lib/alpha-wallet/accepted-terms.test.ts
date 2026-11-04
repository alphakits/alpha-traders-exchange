// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateTradeTermsQuote, COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import type { MarketplaceListing, PurchaseRequest, TradeChatMessage } from "@/types/alpha-exchange";
import { assetFor, parseUnits, type AssetId } from "./amounts";
import {
  AcceptedTermsPlanningError,
  DEVELOPMENT_TERMS_BINDING_VERSION,
  describeDevelopmentTradeTerms,
  planAcceptedAmountTerms,
  type AcceptedAmountTermsContext,
} from "./accepted-terms";
import { walletDigest } from "./commands";
import { balance } from "./ledger";
import { createAlphaWalletSandbox, simulatedDestination } from "./sandbox";
import type { Actor, Trade } from "./types";

const TRON: AssetId = "tron-sim-usdt";
const BSC: AssetId = "bsc-sim-binance-peg-usdt";
const SELLER: Actor = { kind: "seller", id: "seller-a" };
const BUYER: Actor = { kind: "buyer", id: "buyer-a" };
const OPERATOR: Actor = { kind: "operator", id: "owner-a" };
const VERIFIER: Actor = { kind: "verifier", id: "verifier-a" };
const TIME = "2026-11-04T10:00:00.000Z";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(key, undefined);
  }
});
afterEach(() => vi.unstubAllEnvs());

function quote(amount: string, price = "3.20", paymentMethod = "Bank Transfer") {
  const result = calculateTradeTermsQuote({ paymentMethod, currency: "ILS", usdtAmount: amount, fiatAmount: "0.00",
    pricePerUsdt: price, feePolicyVersion: MARKETPLACE_FEE_POLICY }, "propose_amount", amount);
  if (!result) throw new Error("Invalid fixture quote");
  return result;
}

function fixture(options: { assetId?: AssetId; pending?: boolean; amount?: string; proposed?: string; price?: string; paymentMethod?: string } = {}) {
  const assetId = options.assetId ?? TRON;
  const asset = assetFor(assetId);
  const price = options.price ?? "3.20";
  const amount = options.amount ?? "200";
  const paymentMethod = options.paymentMethod ?? "Bank Transfer";
  const wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => Date.parse(TIME) });
  wallet.createListing(SELLER, "listing-create", { id: "wallet-listing", assetId, amount: "500", price, currency: "ILS" });
  wallet.approveListing(OPERATOR, "listing-approve", "wallet-listing");
  const intent = wallet.createDepositIntent(SELLER, "deposit-create", { id: "funding", assetId, purpose: "principal" });
  wallet.observeDeposit(VERIFIER, "deposit-observe", { intentId: intent.id, assetId, network: asset.network, token: asset.token,
    transactionId: "sim-tx-funding", eventIndex: 0, destination: intent.destination, amountRaw: parseUnits("500", asset.decimals).toString(),
    blockHash: "sim-block-funding", finalized: true, successful: true });
  if (!options.pending) wallet.reserveTrade(BUYER, "trade-reserve", { id: "wallet-trade", listingId: "wallet-listing",
    amount, destination: simulatedDestination(assetId, "fixed-recipient") });
  const listing: MarketplaceListing = {
    id: "market-listing", sellerId: SELLER.id, sellerDisplayName: "Fixture seller", photos: [], originalAmount: "500",
    availableAmount: "500", price: "3.60", currency: "ILS", network: assetId === TRON ? "TRC20" : "BEP20",
    paymentMethod, paymentMethods: [paymentMethod], bankAccountId: "bank-1", bankTransferProvider: "israeli_bank",
    bankName: "Fixture bank", minimumTrade: "1", maximumTrade: "500", sellerDescription: "Fixture only", responseTime: "10 minutes",
    status: "active", approvalStatus: "approved", createdAt: TIME, updatedAt: TIME,
  };
  const request: PurchaseRequest = {
    id: "request-a", tradeId: options.pending ? undefined : "platform-trade-a", buyerId: BUYER.id, sellerId: SELLER.id,
    listingId: listing.id, buyerName: "Fixture buyer", ...quote(amount, price, paymentMethod), listingPriceAtRequest: price,
    priceMode: "listing_price", currency: "ILS", network: listing.network, buyerReceivingWalletAddress: simulatedDestination(assetId, "fixed-recipient"),
    paymentMethod, sellerBankAccountId: "bank-1", bankTransferProvider: "israeli_bank", bankName: "Fixture bank",
    sellerBankAccountSnapshot: { accountHolderName: "Fixture Seller", bankName: "Fixture bank", branchNumber: "001", accountNumber: "00001234", accountLast4: "1234" },
    feePolicyVersion: MARKETPLACE_FEE_POLICY, commissionCalculationVersion: COMMISSION_CALCULATION_VERSION,
    amountAdjustmentCount: 1, timeline: [], messages: [], status: options.pending ? "pending" : "accepted",
    createdAt: TIME, updatedAt: TIME,
    termsProposal: { id: "proposal-a", kind: "amount_correction", status: "pending", createdAt: TIME,
      ...quote(options.proposed ?? "300", price, paymentMethod) },
  };
  const ctx: AcceptedAmountTermsContext = {
    mode: "simulation-only", actorUserId: BUYER.id, requestId: request.id, proposalId: "proposal-a", expectedBindingRevision: 1,
    marketplace: { purchaseRequests: [request], marketplaceListings: [listing], tradeEvidenceFiles: [], disputes: [] },
    wallet: { revision: 5, eventHash: "a".repeat(64), state: wallet.snapshot() },
    binding: { version: DEVELOPMENT_TERMS_BINDING_VERSION, platformRequestId: request.id, platformListingId: listing.id,
      walletListingId: "wallet-listing", assetId, revision: 1,
      termsDigest: describeDevelopmentTradeTerms({ mode: "simulation-only", request, assetId, walletListingId: "wallet-listing" }).digest,
      reservation: options.pending ? { kind: "unreserved" } : { kind: "reserved", walletTradeId: "wallet-trade",
        walletTradeDigest: walletDigest(wallet.snapshot().trades.get("wallet-trade")) } },
  };
  function rebind() {
    ctx.binding.termsDigest = describeDevelopmentTradeTerms({ mode: "simulation-only", request, assetId, walletListingId: "wallet-listing" }).digest;
    if (ctx.binding.reservation.kind === "reserved") {
      ctx.binding.reservation.walletTradeDigest = walletDigest(ctx.wallet.state.trades.get(ctx.binding.reservation.walletTradeId));
    }
  }
  function refresh() {
    ctx.wallet = { revision: ctx.wallet.revision + 1, eventHash: walletDigest(wallet.snapshot()), state: wallet.snapshot() };
  }
  return { wallet, assetId, request, listing, ctx, rebind, refresh };
}

function changeProposal(f: ReturnType<typeof fixture>, amount: string) {
  Object.assign(f.request.termsProposal!, quote(amount, f.request.pricePerUsdt!, f.request.paymentMethod));
}

function fail(ctx: AcceptedAmountTermsContext, code: AcceptedTermsPlanningError["code"]) {
  let error: unknown;
  try { planAcceptedAmountTerms(ctx); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(AcceptedTermsPlanningError);
  expect(error).toMatchObject({ code });
}

function historyMessage(id: string): TradeChatMessage {
  return { id, purchaseRequestId: "request-a", kind: "system", senderUserId: SELLER.id, senderRole: "approved_seller",
    message: "Seller proposed 200 USDT for ILS 646.40 at 3.20 per USDT. Buyer confirmation required.", createdAt: TIME,
    readByUserIds: [] };
}

describe("canonical buyer acceptance plan", () => {
  it.each([TRON, BSC])("derives exact increase, fees, and identity from canonical terms on %s without a write", assetId => {
    const f = fixture({ assetId });
    const before = structuredClone(f.ctx);
    const plan = planAcceptedAmountTerms(f.ctx);
    const raw = (amount: string) => parseUnits(amount, assetFor(assetId).decimals).toString();
    expect(plan).toMatchObject({ executionAuthority: false, requestId: "request-a", proposalId: "proposal-a",
      submittedAdjustmentCount: 1, nextBindingRevision: 2, termsPrincipalDeltaRaw: raw("100"),
      prior: { terms: { usdtAmount: "200", pricePerUsdt: "3.20", fiatAmount: "646.40", principalRaw: raw("200") } },
      accepted: { terms: { usdtAmount: "300", pricePerUsdt: "3.20", fiatAmount: "969.60", principalRaw: raw("300"),
        buyerFeeRaw: raw("3"), sellerFeeRaw: raw("3"), totalFeeRaw: raw("6"), fiatTotalMinor: "96960",
        sellerId: SELLER.id, buyerId: BUYER.id, assetId, destination: simulatedDestination(assetId, "fixed-recipient") } },
      reservation: { action: "increase", walletTradeId: "wallet-trade", principalDeltaRaw: raw("100"), transferAmountRaw: raw("100"),
        fromAccount: "listing:wallet-listing", toAccount: "trade:wallet-trade", expectedListingAvailableRaw: raw("300"),
        expectedTradeReservedRaw: raw("200"), availableForRequestRaw: raw("500") } });
    expect(plan.prior.digest).toBe(walletDigest(plan.prior.terms));
    expect(plan.accepted.digest).toBe(walletDigest(plan.accepted.terms));
    expect(plan.accepted.digest).not.toBe(plan.prior.digest);
    expect(plan.preconditions.walletStateDigest).toBe(walletDigest(f.ctx.wallet.state));
    expect(f.ctx).toEqual(before);
    expect(f.wallet.snapshot()).toEqual(before.wallet.state);
  });

  it("preserves the frozen price when the live marketplace price changes", () => {
    const f = fixture();
    f.listing.price = "5.75";
    const plan = planAcceptedAmountTerms(f.ctx);
    expect(plan.accepted.terms.pricePerUsdt).toBe("3.20");
    expect(plan.accepted.terms.fiatAmount).toBe("969.60");
  });

  it("preserves the normal marketplace inventory lock on an accepted matched listing", () => {
    const f = fixture();
    f.listing.status = "matched";
    f.listing.lockedAt = TIME;
    f.listing.activeTradeRequestId = f.request.id;
    expect(planAcceptedAmountTerms(f.ctx).reservation.action).toBe("increase");
    expect(f.listing.lockedAt).toBe(TIME);
  });

  it("plans a decrease back to the same listing account", () => {
    const f = fixture({ proposed: "100" });
    expect(planAcceptedAmountTerms(f.ctx)).toMatchObject({ termsPrincipalDeltaRaw: "-100000000",
      reservation: { action: "decrease", principalDeltaRaw: "-100000000", transferAmountRaw: "100000000",
        fromAccount: "trade:wallet-trade", toAccount: "listing:wallet-listing" } });
  });

  it("binds a zero delta acceptance without a zero-value ledger transfer", () => {
    const f = fixture({ proposed: "200" });
    const plan = planAcceptedAmountTerms(f.ctx);
    expect(plan.reservation).toMatchObject({ action: "unchanged", principalDeltaRaw: "0", transferAmountRaw: "0", fromAccount: null, toAccount: null });
    expect(plan.prior.digest).toBe(plan.accepted.digest);
    expect(plan.acceptanceKey).toBe(planAcceptedAmountTerms(f.ctx).acceptanceKey);
    expect(plan.inputDigest).toBe(planAcceptedAmountTerms(f.ctx).inputDigest);
  });

  it("updates pending terms in the plan without making a reservation", () => {
    const f = fixture({ pending: true });
    const plan = planAcceptedAmountTerms(f.ctx);
    expect(plan.termsPrincipalDeltaRaw).toBe("100000000");
    expect(plan.reservation).toMatchObject({ action: "no_reservation", walletTradeId: null, principalDeltaRaw: "0", transferAmountRaw: "0",
      fromAccount: null, toAccount: null, expectedListingAvailableRaw: "500000000", expectedTradeReservedRaw: "0" });
    expect(f.ctx.wallet.state.trades.size).toBe(0);
    expect(f.wallet.snapshot().journal).toHaveLength(2);
  });

  it("freezes returned terms, preconditions, and effects without retaining input aliases", () => {
    const f = fixture();
    const plan = planAcceptedAmountTerms(f.ctx);
    for (const item of [plan, plan.accepted, plan.accepted.terms, plan.prior, plan.prior.terms, plan.preconditions, plan.reservation]) {
      expect(Object.isFrozen(item)).toBe(true);
    }
    expect(() => Object.assign(plan.accepted.terms, { principalRaw: "1" })).toThrow(TypeError);
    const digestBefore = walletDigest(plan);
    f.request.sellerBankAccountSnapshot!.accountNumber = "different";
    f.request.termsProposal!.usdtAmount = "400";
    f.ctx.wallet.state.trades.get("wallet-trade")!.destination = "modified";
    expect(walletDigest(plan)).toBe(digestBefore);
    expect(JSON.stringify(plan)).not.toContain("00001234");
    expect(plan.accepted.executionAuthority).toBe(false);
  });

  it("uses the canonical buyer identity even when a caller claims an owner role", () => {
    const f = fixture();
    for (const actor of [SELLER.id, OPERATOR.id, "other-buyer"]) {
      f.ctx.actorUserId = actor;
      Object.assign(f.ctx, { buyerAccepted: true, role: "owner", acceptedFees: { total: "0" } });
      fail(f.ctx, "ACTOR");
    }
  });

  it("rejects self trades before deriving an enrollment digest", () => {
    const f = fixture();
    f.request.buyerId = SELLER.id;
    expect(() => describeDevelopmentTradeTerms({ mode: "simulation-only", request: f.request, assetId: TRON, walletListingId: "wallet-listing" })).toThrow(/distinct/);
  });
});

describe("proposal identity, policy, and binding", () => {
  it.each(["missing", "different", "accepted", "declined", "withdrawn", "resolved"])("rejects a stale %s proposal", variant => {
    const f = fixture();
    if (variant === "missing") delete f.request.termsProposal;
    else if (variant === "different") f.ctx.proposalId = "old-proposal";
    else if (variant === "resolved") f.request.termsProposal!.resolvedAt = TIME;
    else f.request.termsProposal!.status = variant as "accepted" | "declined" | "withdrawn";
    fail(f.ctx, "STALE");
  });

  it("refuses to reinterpret a counter-offer as an amount correction", () => {
    const f = fixture();
    f.request.termsProposal!.kind = "counter_offer";
    fail(f.ctx, "UNSUPPORTED");
  });

  it("permits accepting the second submission and preserves history of declined or withdrawn submissions", () => {
    const f = fixture();
    f.request.amountAdjustmentCount = 2;
    f.request.messages = [historyMessage("declined-submission"), historyMessage("current-submission")];
    expect(planAcceptedAmountTerms(f.ctx).submittedAdjustmentCount).toBe(2);
    // Older stored rows may lack a counter; the server-authored history still consumes both turns.
    delete f.request.amountAdjustmentCount;
    expect(planAcceptedAmountTerms(f.ctx).submittedAdjustmentCount).toBe(2);
  });

  it.each([3, -1, 1.5, Number.NaN])("rejects an invalid submission count %s", count => {
    const f = fixture(); f.request.amountAdjustmentCount = count;
    fail(f.ctx, "INTEGRITY");
  });

  it("does not let the contract helper's count clamp hide a third historical submission", () => {
    const f = fixture();
    f.request.amountAdjustmentCount = 1;
    f.request.messages = [historyMessage("one"), historyMessage("two"), historyMessage("three")];
    fail(f.ctx, "INTEGRITY");
  });

  it.each(["buyer_offer", "demand", "quantity_fixed"])("keeps negotiating %s quantity fixed", kind => {
    const f = fixture({ pending: true });
    if (kind === "buyer_offer") f.request.priceMode = "buyer_offer";
    if (kind === "demand") f.request.usdtDemandId = "demand-a";
    if (kind === "quantity_fixed") Object.assign(f.request, { quantityFixed: true });
    fail(f.ctx, "UNSUPPORTED");
  });

  it("allows corrections after a demand match is accepted and its existing reservation is bound", () => {
    const f = fixture(); f.request.usdtDemandId = "demand-a";
    expect(planAcceptedAmountTerms(f.ctx).reservation.action).toBe("increase");
  });

  it.each(["revision", "terms", "request", "listing", "trade_digest"])("rejects a stale or mismatched %s binding", kind => {
    const f = fixture();
    if (kind === "revision") f.ctx.expectedBindingRevision = 0;
    if (kind === "terms") f.ctx.binding.termsDigest = "b".repeat(64);
    if (kind === "request") f.ctx.binding.platformRequestId = "request-other";
    if (kind === "listing") f.ctx.binding.platformListingId = "listing-other";
    if (kind === "trade_digest" && f.ctx.binding.reservation.kind === "reserved") f.ctx.binding.reservation.walletTradeDigest = "c".repeat(64);
    fail(f.ctx, kind === "request" || kind === "listing" ? "INTEGRITY" : "STALE");
  });

  it("rejects an absent reserve binding for an accepted request", () => {
    const f = fixture(); f.ctx.binding.reservation = { kind: "unreserved" };
    fail(f.ctx, "INTEGRITY");
  });

  it("rejects a missing or mismatched trade instead of reserving again", () => {
    const f = fixture({ pending: true });
    f.request.status = "accepted";
    f.ctx.binding.reservation = { kind: "reserved", walletTradeId: "missing-trade", walletTradeDigest: "b".repeat(64) };
    fail(f.ctx, "INTEGRITY");
    expect(f.ctx.wallet.state.trades.size).toBe(0);
  });

  it("rejects a reserved binding on an ordinary pending request", () => {
    const f = fixture(); f.request.status = "pending";
    fail(f.ctx, "INTEGRITY");
  });

  it("rejects mismatched canonical network and exact destination", () => {
    const f = fixture();
    f.request.network = "BEP20";
    fail(f.ctx, "INTEGRITY");
    f.request.network = "TRC20";
    f.request.buyerReceivingWalletAddress = simulatedDestination(TRON, "other-recipient");
    f.rebind();
    fail(f.ctx, "INTEGRITY");
  });

  it("binds the frozen payment account without disclosing it or using the live account as a fallback", () => {
    const f = fixture();
    f.listing.bankAccountId = "new-live-bank";
    expect(planAcceptedAmountTerms(f.ctx).accepted.terms.paymentInstructionsDigest).toBe(planAcceptedAmountTerms(f.ctx).prior.terms.paymentInstructionsDigest);
    f.request.sellerBankAccountId = "other-frozen-bank";
    fail(f.ctx, "STALE");
    delete f.request.sellerBankAccountSnapshot;
    fail(f.ctx, "UNSUPPORTED");
  });

  it.each(["fee", "commission", "USD", "wise", "unknown_method", "real_destination"])("refuses unsupported %s mapping", kind => {
    const f = fixture();
    if (kind === "fee") delete f.request.feePolicyVersion;
    if (kind === "commission") delete f.request.commissionCalculationVersion;
    if (kind === "USD") f.request.currency = "USD";
    if (kind === "wise") f.request.bankTransferProvider = "wise";
    if (kind === "unknown_method") f.request.paymentMethod = "Other";
    if (kind === "real_destination") f.request.buyerReceivingWalletAddress = "T-real-chain-address";
    fail(f.ctx, "UNSUPPORTED");
  });
});

describe("exact monetary agreement", () => {
  it("uses six-decimal per-party half-up fees and rounds inclusive fiat once", () => {
    const f = fixture({ assetId: BSC, amount: "1", proposed: "1.00005", price: "1.49" });
    f.listing.minimumTrade = "0";
    const terms = planAcceptedAmountTerms(f.ctx).accepted.terms;
    expect(terms).toMatchObject({ principalRaw: "1000050000000000000", buyerFeeRaw: "10001000000000000",
      sellerFeeRaw: "10001000000000000", totalFeeRaw: "20002000000000000", fiatTotalMinor: "150", fiatAmount: "1.50" });
    // Rounding the 1.4949915 base and its fee separately would incorrectly yield 1.50.
    changeProposal(f, "1.00335");
    expect(planAcceptedAmountTerms(f.ctx).accepted.terms.fiatAmount).toBe("1.51");
  });

  it("rejects forged stored proposal fiat or a changed unit price", () => {
    const f = fixture();
    f.request.termsProposal!.fiatAmount = "960.00";
    fail(f.ctx, "INTEGRITY");
    Object.assign(f.request.termsProposal!, quote("300", "3.21"));
    fail(f.ctx, "INTEGRITY");
  });

  it("does not infer price equality from a coincidentally equal rounded fiat total", () => {
    const f = fixture({ amount: "0.01", proposed: "0.02", price: "1.01" });
    f.listing.minimumTrade = "0";
    f.ctx.wallet.state.listings.get("wallet-listing")!.price = "1.02";
    expect(quote("0.01", "1.01").fiatAmount).toBe(quote("0.01", "1.02").fiatAmount);
    fail(f.ctx, "INTEGRITY");
  });

  it("never falls back to a live listing price when the request lock is absent", () => {
    const f = fixture(); delete f.request.pricePerUsdt;
    fail(f.ctx, "INVALID");
  });

  it.each(["buyerFeeRaw", "sellerFeeRaw", "totalFeeRaw", "fiatTotalMinor", "buyerId", "sellerId", "destination"] as const)("rejects corrupted existing wallet %s even with a refreshed trade digest", key => {
    const f = fixture(); const trade = f.ctx.wallet.state.trades.get("wallet-trade")!;
    if (typeof trade[key] === "bigint") Object.assign(trade, { [key]: (trade[key] as bigint) + BigInt(1) });
    else Object.assign(trade, { [key]: "other" });
    f.rebind();
    fail(f.ctx, "INTEGRITY");
  });

  it.each(["200.0000001", "2e2", "200,00", " 200", "0200", "٢٠٠", "-200", Number.POSITIVE_INFINITY, 0.1 + 0.2, 1e-7, -0])("rejects inexact or ambiguous legacy principal %s", value => {
    const f = fixture(); Object.assign(f.request.termsProposal!, { usdtAmount: value });
    fail(f.ctx, "INVALID");
  });

  it("accepts a safely representable legacy number without rounding and rejects unsafe minor units", () => {
    const f = fixture();
    Object.assign(f.request.termsProposal!, { usdtAmount: 300, pricePerUsdt: 3.2, fiatAmount: 969.6 });
    expect(planAcceptedAmountTerms(f.ctx).accepted.terms.usdtAmount).toBe("300");
    Object.assign(f.request.termsProposal!, { fiatAmount: 90071992547409.92 });
    fail(f.ctx, "INVALID");
  });
});

describe("canonical inventory and reservation rechecks", () => {
  it("rechecks capacity after a competing reservation consumes the required increase", () => {
    const f = fixture();
    const before = planAcceptedAmountTerms(f.ctx);
    f.wallet.reserveTrade({ kind: "buyer", id: "buyer-b" }, "reserve-competing", { id: "competing-wallet-trade", listingId: "wallet-listing",
      amount: "250", destination: simulatedDestination(TRON, "buyer-b") });
    f.refresh();
    f.ctx.marketplace.purchaseRequests = [f.request, { ...f.request, ...quote("250"), id: "competing-request", buyerId: "buyer-b",
      tradeId: "competing-platform-trade", termsProposal: undefined }];
    const snapshot = structuredClone(f.ctx.wallet.state);
    fail(f.ctx, "UNAVAILABLE");
    expect(f.ctx.wallet.state).toEqual(snapshot);
    expect(balance(f.ctx.wallet.state, TRON, "trade:wallet-trade")).toBe(BigInt(200000000));
    changeProposal(f, "250");
    const after = planAcceptedAmountTerms(f.ctx);
    expect(after.reservation.availableForRequestRaw).toBe("250000000");
    expect(after.preconditions.walletStateDigest).not.toBe(before.preconditions.walletStateDigest);
    expect(after.inputDigest).not.toBe(before.inputDigest);
    expect(after.acceptanceKey).toBe(before.acceptanceKey);
  });

  it("includes pending demand reservations in canonical capacity", () => {
    const f = fixture();
    f.wallet.reserveTrade({ kind: "buyer", id: "buyer-b" }, "reserve-demand", { id: "demand-wallet-trade", listingId: "wallet-listing",
      amount: "250", destination: simulatedDestination(TRON, "buyer-b") });
    f.refresh();
    f.ctx.marketplace.purchaseRequests = [f.request, { ...f.request, ...quote("250"), id: "demand-request", status: "pending",
      buyerId: "buyer-b", usdtDemandId: "demand-a", termsProposal: undefined }];
    fail(f.ctx, "UNAVAILABLE");
  });

  it("does not count ordinary pending proposals as reservations", () => {
    const f = fixture();
    f.ctx.marketplace.purchaseRequests = [f.request, { ...f.request, id: "pending-other", status: "pending", usdtAmount: "500" }];
    expect(planAcceptedAmountTerms(f.ctx).reservation.availableForRequestRaw).toBe("500000000");
  });

  it("maps remaining marketplace inventory after a prior wallet trade settles", () => {
    const f = fixture();
    const otherBuyer: Actor = { kind: "buyer", id: "buyer-settled" };
    const dispatcher: Actor = { kind: "dispatcher", id: "dispatcher-a" };
    const trade = f.wallet.reserveTrade(otherBuyer, "reserve-settled", { id: "settled-trade", listingId: "wallet-listing",
      amount: "100", destination: simulatedDestination(TRON, otherBuyer.id) });
    f.wallet.markBuyerPaid(otherBuyer, "settled-payment-claim", trade.id);
    f.wallet.verifyPayment(VERIFIER, "settled-payment-evidence", { tradeId: trade.id, evidence: {
      reference: "sim-evidence-settled", amountMinor: trade.fiatTotalMinor.toString(), currency: "ILS", kind: "simulated-bank-credit" } });
    f.wallet.authorizeRelease(SELLER, "settled-authorize", trade.id);
    f.wallet.reconcileAsset(VERIFIER, "settled-reconcile", { assetId: TRON, observedRaw: f.wallet.expectedCustody(TRON).toString(), complete: true });
    f.wallet.setNativeFeeReadiness(OPERATOR, "settled-gas", { assetId: TRON, ready: true });
    const payout = f.wallet.queueRelease(dispatcher, "settled-queue", trade.id);
    f.wallet.beginDispatch(dispatcher, "settled-dispatch", payout.id);
    f.wallet.recordSubmission(dispatcher, "settled-submit", { payoutId: payout.id, outcome: "broadcast", transactionId: "sim-tx-settled" });
    f.wallet.confirmPayout(VERIFIER, "settled-confirm", { payoutId: payout.id, providerReference: payout.providerReference,
      assetId: TRON, network: assetFor(TRON).network, token: assetFor(TRON).token, transactionId: "sim-tx-settled", eventIndex: 0,
      destination: payout.destination, amountRaw: payout.amountRaw.toString(), finalized: true, successful: true });
    f.refresh();
    f.listing.availableAmount = "400";
    f.ctx.marketplace.purchaseRequests = [f.request, { ...f.request, ...quote("100"), id: "settled-request", status: "completed",
      buyerId: otherBuyer.id, tradeId: "settled-platform-trade", termsProposal: undefined }];
    const plan = planAcceptedAmountTerms(f.ctx);
    expect(f.ctx.wallet.state.listings.get("wallet-listing")!.amountRaw).toBe(BigInt(500000000));
    expect(plan.reservation).toMatchObject({ action: "increase", expectedListingAvailableRaw: "200000000", availableForRequestRaw: "400000000" });
  });

  it.each(["marketplace", "wallet"])("rejects inconsistent %s capacity rather than guessing a mapping", side => {
    const f = fixture();
    if (side === "marketplace") f.listing.availableAmount = "499.999999";
    else {
      f.wallet.reserveTrade({ kind: "buyer", id: "buyer-b" }, "reserve-other", { id: "other-trade", listingId: "wallet-listing",
        amount: "1", destination: simulatedDestination(TRON, "buyer-b") });
      f.refresh();
    }
    fail(f.ctx, "INTEGRITY");
  });

  it("enforces exact minimum and maximum principal without fee or two-USDT tolerance", () => {
    const f = fixture();
    f.listing.maximumTrade = "299.999999";
    fail(f.ctx, "UNAVAILABLE");
    f.listing.maximumTrade = "500"; f.listing.minimumTrade = "300.000001";
    fail(f.ctx, "UNAVAILABLE");
  });

  it.each(["approved", "funded", "closed"] as const)("requires an open owner-approved funded wallet listing for pending terms: %s", field => {
    const f = fixture({ pending: true });
    f.ctx.wallet.state.listings.get("wallet-listing")![field] = field === "closed";
    fail(f.ctx, "LOCKED");
  });

  it("rejects closed marketplace listings and duplicate canonical requests", () => {
    const f = fixture(); f.listing.status = "closed";
    fail(f.ctx, "UNSUPPORTED");
    f.listing.status = "active";
    f.ctx.marketplace.purchaseRequests = [f.request, structuredClone(f.request)];
    fail(f.ctx, "INTEGRITY");
  });
});

describe("payment and disclosure locks", () => {
  it.each(["paymentSentAt", "fundsReceivedAt", "usdtReleaseStartedAt", "usdtSentAt", "completedAt", "lockedAt", "closedAt", "timedOutAt"] as const)("blocks canonical %s", field => {
    const f = fixture(); f.request[field] = TIME;
    fail(f.ctx, "LOCKED");
  });

  it("keeps historical payment and evidence events locked after a status rollback", () => {
    const f = fixture();
    f.request.timeline = [{ id: "payment-history", type: "buyer_evidence_uploaded", actorUserId: BUYER.id,
      actorRole: "buyer", message: "Fixture evidence was uploaded", createdAt: TIME }];
    fail(f.ctx, "LOCKED");
  });

  it.each(["buyer", "seller"] as const)("uses stored %s evidence even when it is absent on the request", side => {
    const f = fixture();
    f.ctx.marketplace.tradeEvidenceFiles = [{ id: "evidence-a", purchaseRequestId: f.request.id, side }];
    fail(f.ctx, "LOCKED");
  });

  it("blocks open disputes but does not invent a lock for resolved unrelated records", () => {
    const f = fixture();
    f.ctx.marketplace.disputes = [{ id: "dispute-a", purchaseRequestId: f.request.id, status: "open" }];
    fail(f.ctx, "LOCKED");
    f.ctx.marketplace.disputes = [{ id: "dispute-a", purchaseRequestId: f.request.id, status: "resolved" },
      { id: "unrelated", purchaseRequestId: "other-request", status: "open" }];
    expect(planAcceptedAmountTerms(f.ctx).reservation.action).toBe("increase");
  });

  it("allows bank-detail disclosure but blocks unknown or usable code disclosure", () => {
    const f = fixture(); f.request.sensitivePaymentSharedAt = TIME; f.request.sensitivePaymentKind = "bank_details";
    expect(planAcceptedAmountTerms(f.ctx).reservation.action).toBe("increase");
    delete f.request.sensitivePaymentKind;
    fail(f.ctx, "LOCKED");
    f.request.sensitivePaymentKind = "cardless_code";
    fail(f.ctx, "LOCKED");
  });

  it.each(["status", "disputed", "evidence", "authorization", "payoutId"] as const)("requires clean existing wallet %s", key => {
    const f = fixture(); const trade = f.ctx.wallet.state.trades.get("wallet-trade")!;
    const changes: Partial<Trade> = { status: "payment_reported", disputed: true,
      evidence: { reference: "sim-evidence", amountMinor: "64640", currency: "ILS", kind: "simulated-bank-credit" },
      authorization: { sellerId: SELLER.id, destination: trade.destination, amountRaw: trade.amountRaw, evidenceReference: "sim-evidence" },
      payoutId: "payout-a" };
    Object.assign(trade, { [key]: changes[key] });
    f.rebind();
    fail(f.ctx, "LOCKED");
  });

  it("honors a halted wallet snapshot", () => {
    const f = fixture(); f.ctx.wallet.state.haltReason = "paused";
    fail(f.ctx, "LOCKED");
  });

  it("keeps the existing wallet evidence ownership lock even if a trade's evidence field was removed", () => {
    const f = fixture();
    f.ctx.wallet.state.evidenceOwners.set("sim-evidence-retained", "wallet-trade");
    fail(f.ctx, "LOCKED");
  });

  it("requires exact ATM cash increments, ignores the ordinary listing minimum, and plans prepared-code invalidation", () => {
    const method = "Cardless ATM Withdrawal";
    const input = { paymentMethod: method, currency: "ILS", usdtAmount: "1", fiatAmount: "0", pricePerUsdt: "3.20", feePolicyVersion: MARKETPLACE_FEE_POLICY };
    const previous = calculateTradeTermsQuote(input, "propose_ils_amount", "500")!;
    const next = calculateTradeTermsQuote(input, "propose_ils_amount", "600")!;
    const f = fixture({ amount: previous.usdtAmount, proposed: next.usdtAmount, paymentMethod: method });
    f.listing.minimumTrade = "200";
    f.request.cardlessCodeAwaitingBuyerConfirmation = true;
    f.request.messages = [{ ...historyMessage("prepared-code"), kind: "user", message: "private fixture code", credentialKind: "cardless_code", confidential: true }];
    const plan = planAcceptedAmountTerms(f.ctx);
    expect(plan.accepted.terms.fiatAmount).toBe("600.00");
    expect(plan.invalidatePreparedCardlessCredentials).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("private fixture code");
    Object.assign(f.request.termsProposal!, previous);
    expect(planAcceptedAmountTerms(f.ctx).invalidatePreparedCardlessCredentials).toBe(false);
    f.request.cardlessCodeAwaitingBuyerConfirmation = false;
    fail(f.ctx, "LOCKED");
  });

  it("rejects an ATM proposal that is not the exact inverse cash quote", () => {
    const method = "Cardless ATM Withdrawal";
    const prior = calculateTradeTermsQuote({ paymentMethod: method, currency: "ILS", usdtAmount: "1", fiatAmount: "0", pricePerUsdt: "3.20", feePolicyVersion: MARKETPLACE_FEE_POLICY }, "propose_ils_amount", "500")!;
    const f = fixture({ amount: prior.usdtAmount, proposed: prior.usdtAmount, paymentMethod: method });
    f.request.termsProposal!.usdtAmount = "200"; f.request.termsProposal!.fiatAmount = "646.40";
    fail(f.ctx, "UNSUPPORTED");
  });

  it("supports the existing face-to-face method with the same prepayment boundary", () => {
    const f = fixture({ paymentMethod: "Face-to-Face (Meet in Person)" });
    expect(planAcceptedAmountTerms(f.ctx).accepted.terms.paymentMethod).toBe("Face-to-Face (Meet in Person)");
    f.request.fundsReceivedAt = TIME;
    fail(f.ctx, "LOCKED");
  });
});

describe("development-only capability", () => {
  it.each(["production", "hosted", "signing", "mainnet", "missing_opt_in"])("rejects %s runtime", kind => {
    const f = fixture();
    if (kind === "production") vi.stubEnv("NODE_ENV", "production");
    if (kind === "hosted") vi.stubEnv("VERCEL", "1");
    if (kind === "signing") vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1");
    if (kind === "mainnet") vi.stubEnv("ALPHA_WALLET_MAINNET_ENABLED", "1");
    if (kind === "missing_opt_in") Object.assign(f.ctx, { mode: undefined });
    expect(() => planAcceptedAmountTerms(f.ctx)).toThrow(/simulation|development|signing/i);
    if (kind !== "missing_opt_in") expect(() => describeDevelopmentTradeTerms({ mode: "simulation-only", request: f.request,
      assetId: f.assetId, walletListingId: "wallet-listing" })).toThrow(/simulation|development|signing/i);
  });
});
