// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateTradePaymentTotal, COMMISSION_CALCULATION_VERSION, MARKETPLACE_FEE_POLICY } from "@alpha-traders/contracts";
import type { AlphaExchangeUser, CommissionRecord, MarketplaceListing, PurchaseRequest, SellerReviewRecord } from "@/types/alpha-exchange";
import { assetFor, parseUnits, type AssetId } from "./amounts";
import { walletDigest } from "./commands";
import {
  InitialAcceptancePlanningError, planDevelopmentInitialAcceptance,
  type DevelopmentInitialAcceptanceContext, type DevelopmentInitialAcceptanceMarketplace,
} from "./initial-acceptance";
import { balance } from "./ledger";
import { createAlphaWalletSandbox, simulatedDestination } from "./sandbox";
import type { Actor } from "./types";

const AT = 1_800_000_000_000;
const TIME = new Date(AT).toISOString();
const TRON: AssetId = "tron-sim-usdt", BSC: AssetId = "bsc-sim-binance-peg-usdt";
const SELLER: Actor = { kind: "seller", id: "initial-seller" };
const BUYER: Actor = { kind: "buyer", id: "initial-buyer" };
const OWNER: Actor = { kind: "operator", id: "initial-owner" };
const VERIFIER: Actor = { kind: "verifier", id: "initial-verifier" };
type MutableMarketplace = { [K in keyof DevelopmentInitialAcceptanceMarketplace]: Array<DevelopmentInitialAcceptanceMarketplace[K][number]> };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function user(id: string, seller = false): AlphaExchangeUser {
  return { id, fullName: `Synthetic ${id}`, email: `${id}@example.invalid`, passwordHash: "private-synthetic-password-hash",
    whatsappNumber: "", preferredNetworks: ["TRC20"], profilePhotoUrl: "", languages: ["en"], bio: "Synthetic planner fixture",
    onlineStatus: "offline", availabilityStatus: "available", role: seller ? "approved_seller" : "buyer",
    sellerStatus: seller ? "approved_seller" : "buyer", emailVerified: true, verifiedPhone: "+12025550101", phoneVerifiedAt: TIME,
    ageEligibility: { method: "self_attestation_v1", confirmedAt: TIME }, disabled: false, createdAt: TIME, updatedAt: TIME };
}

function fixture(options: { assetId?: AssetId; method?: "Bank Transfer" | "Face-to-Face (Meet in Person)"; amount?: string;
  price?: string; walletPrice?: string; minimum?: string } = {}) {
  const assetId = options.assetId ?? TRON, asset = assetFor(assetId);
  const amount = options.amount ?? "200", price = options.price ?? "3.20", method = options.method ?? "Bank Transfer";
  const wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => AT });
  wallet.createListing(SELLER, "create-listing", { id: "initial-wallet-listing", assetId, amount: "500", price: options.walletPrice ?? price, currency: "ILS" });
  wallet.approveListing(OWNER, "approve-listing", "initial-wallet-listing");
  const intent = wallet.createDepositIntent(SELLER, "create-deposit", { id: "initial-deposit", assetId, purpose: "principal" });
  wallet.observeDeposit(VERIFIER, "observe-deposit", { intentId: intent.id, assetId, network: asset.network, token: asset.token,
    transactionId: "sim-tx-initial-funding", eventIndex: 0, destination: intent.destination, amountRaw: parseUnits("500", asset.decimals).toString(),
    blockHash: "sim-block-initial-funding", finalized: true, successful: true });
  const seller = user(SELLER.id, true), buyer = user(BUYER.id);
  const listing: MarketplaceListing = { id: "initial-market-listing", sellerId: seller.id, sellerDisplayName: "Synthetic seller", photos: [],
    originalAmount: "500", availableAmount: "500", price: "3.60", currency: "ILS", network: assetId === TRON ? "TRC20" : "BEP20",
    paymentMethod: method, paymentMethods: [method], minimumTrade: options.minimum ?? "1", maximumTrade: "500", sellerDescription: "Fixture",
    responseTime: "Fixture", status: "active", approvalStatus: "approved", createdAt: TIME, updatedAt: TIME };
  const request: PurchaseRequest = { id: "initial-request", tradeId: "initial-platform-trade", listingId: listing.id,
    sellerId: seller.id, buyerId: buyer.id, buyerName: "Synthetic buyer", usdtAmount: amount,
    fiatAmount: calculateTradePaymentTotal(amount, price, true)!, pricePerUsdt: price, listingPriceAtRequest: price,
    priceMode: "listing_price", currency: "ILS", network: listing.network, paymentMethod: method,
    buyerReceivingWalletAddress: simulatedDestination(assetId, buyer.id), feePolicyVersion: MARKETPLACE_FEE_POLICY,
    commissionCalculationVersion: COMMISSION_CALCULATION_VERSION, amountAdjustmentCount: 0, buyerSafetyAcknowledged: true,
    sellerSafetyAcknowledged: method === "Bank Transfer", status: "pending", createdAt: TIME, updatedAt: TIME, messages: [],
    timeline: [{ id: "initial-submission", type: "request_submitted", actorUserId: buyer.id, actorRole: "buyer", message: "Buyer submitted request", createdAt: TIME }] };
  if (method === "Bank Transfer") {
    Object.assign(listing, { bankAccountId: "initial-bank", bankTransferProvider: "israeli_bank" });
    Object.assign(request, { sellerBankAccountId: "initial-bank", bankTransferProvider: "israeli_bank", bankName: "Synthetic bank",
      sellerBankAccountSnapshot: { accountHolderName: "Synthetic seller", bankName: "Synthetic bank", branchNumber: "001",
        accountNumber: "00001234", accountLast4: "1234" } });
    seller.sellerBankAccounts = [{ id: "initial-bank", sellerId: seller.id, ...request.sellerBankAccountSnapshot!, isDefault: true,
      createdAt: TIME, updatedAt: TIME }];
  }
  const marketplace: MutableMarketplace = { users: [seller, buyer], marketplaceListings: [listing], purchaseRequests: [request],
    commissionRecords: [], sellerReviews: [], marketplaceEnforcementRecords: [], tradeEvidenceFiles: [], disputes: [] };
  const context: DevelopmentInitialAcceptanceContext = { mode: "simulation-only", actorUserId: seller.id, requestId: request.id,
    operationId: "initial-transport-one", acceptedAtMs: AT + 1000, safetyAcknowledged: method !== "Bank Transfer",
    mapping: { assetId, walletListingId: "initial-wallet-listing", walletTradeId: "initial-wallet-trade" }, marketplace,
    wallet: { state: wallet.snapshot(), revision: 4, eventHash: walletDigest(wallet.snapshot()) } };
  const refresh = () => { context.wallet = { state: wallet.snapshot(), revision: context.wallet.revision + 1, eventHash: walletDigest(wallet.snapshot()) }; };
  return { context, marketplace, wallet, request, listing, seller, buyer, refresh, assetId };
}
type Fixture = ReturnType<typeof fixture>;
function failure(f: Fixture, code?: InitialAcceptancePlanningError["code"]) {
  let thrown: unknown;
  try { planDevelopmentInitialAcceptance(f.context); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(InitialAcceptancePlanningError);
  if (code) expect(thrown).toMatchObject({ code });
}
function history(f: Fixture, status: PurchaseRequest["status"], extra: Partial<PurchaseRequest> = {}) {
  const result: PurchaseRequest = { ...structuredClone(f.request), id: `history-${f.marketplace.purchaseRequests.length}`, tradeId: `history-trade-${f.marketplace.purchaseRequests.length}`,
    sellerId: "other-seller", listingId: "other-listing", status, timeline: [], ...extra };
  // Older counterparties do not need the initial cohort's present-day financial provenance.
  delete result.feePolicyVersion; delete result.commissionCalculationVersion; delete result.sellerBankAccountSnapshot;
  delete result.pricePerUsdt; delete result.listingPriceAtRequest;
  f.marketplace.purchaseRequests.push(result); return result;
}
function commission(sellerId: string, extra: Partial<CommissionRecord> = {}): CommissionRecord {
  return { id: `commission-${sellerId}`, sellerId, rate: 0.01, grossAmount: 100, commissionAmount: 1,
    paymentStatus: "pending", createdAt: TIME, updatedAt: TIME, ...extra };
}
function legacyReview(request: PurchaseRequest): SellerReviewRecord {
  return { id: "legacy-review", tradeId: request.tradeId!, buyerId: request.buyerId, sellerId: request.sellerId,
    rating: 5, comment: "Retained review", hidden: false, verifiedTrade: true, tradeAmount: request.usdtAmount,
    network: request.network, createdAt: TIME, updatedAt: TIME };
}
function sellerReservation(f: Fixture, index: number, sameListing = false) {
  const buyerId = `other-buyer-${index}`, requestId = `other-reservation-${index}`;
  const listingId = sameListing ? f.listing.id : `other-seller-listing-${index}`;
  if (!sameListing) f.marketplace.marketplaceListings.push({ ...structuredClone(f.listing), id: listingId,
    status: "matched", activeTradeRequestId: requestId, lockedAt: TIME });
  const request = history(f, "accepted", { id: requestId, tradeId: `other-platform-trade-${index}`, buyerId, sellerId: f.seller.id,
    listingId, usdtAmount: "100", tradeCreatedAt: TIME });
  if (sameListing) {
    f.wallet.reserveTrade({ kind: "buyer", id: buyerId }, `reserve-other-${index}`, { id: `other-wallet-trade-${index}`,
      listingId: f.context.mapping.walletListingId, amount: "100", destination: simulatedDestination(f.assetId, buyerId) });
    f.listing.status = "matched"; f.listing.activeTradeRequestId ??= request.id; f.listing.lockedAt = TIME; f.refresh();
  }
  return request;
}

describe("pure initial seller acceptance evidence", () => {
  it.each([TRON, BSC].flatMap(assetId => (["Bank Transfer", "Face-to-Face (Meet in Person)"] as const).map(method => ({ assetId, method }))))(
    "plans full principal and separate exact fees for $assetId / $method without executing", options => {
      const f = fixture(options), before = structuredClone(f.context), plan = planDevelopmentInitialAcceptance(f.context);
      const raw = (value: string) => parseUnits(value, assetFor(options.assetId).decimals).toString();
      expect(plan).toMatchObject({ executionAuthority: false, requiredExecutionContract: "seller-initial-acceptance-not-implemented",
        actorUserId: SELLER.id, requestId: f.request.id, canonicalAcceptance: { actorUserId: SELLER.id,
          requestId: f.request.id, tradeId: f.request.tradeId, acceptedAtMs: AT + 1000 },
        terms: { executionAuthority: false, terms: { usdtAmount: "200", pricePerUsdt: "3.20", fiatAmount: "646.40",
          principalRaw: raw("200"), buyerFeeRaw: raw("2"), sellerFeeRaw: raw("2"), totalFeeRaw: raw("4"), fiatTotalMinor: "64640" } },
        sellerAction: { requestedByUserId: SELLER.id, faceToFaceSafetyAcknowledged: options.method !== "Bank Transfer" },
        buyerRequestEvidence: { kind: "retained_canonical_request", buyerId: BUYER.id, tradeId: f.request.tradeId,
          submissionTimelineEntryId: "initial-submission", buyerSafetyAcknowledged: true },
        reservation: { action: "reserve", fromAccount: "listing:initial-wallet-listing", toAccount: "trade:initial-wallet-trade",
          principalRaw: raw("200"), transferAmountRaw: raw("200"), expectedListingAvailableRaw: raw("500"), expectedTradeReservedRaw: "0" } });
      expect(plan.terms.digest).toBe(walletDigest(plan.terms.terms));
      expect(plan.buyerRequestEvidence.termsDigest).toBe(plan.terms.digest);
      expect(plan.preconditions.walletStateDigest).toBe(walletDigest(before.wallet.state));
      expect(f.context).toEqual(before); expect(f.wallet.snapshot()).toEqual(before.wallet.state);
      expect(f.listing.availableAmount).toBe("500"); expect(f.request.status).toBe("pending");
    });

  it("keeps request price frozen across public listing and wallet listing repricing", () => {
    const f = fixture({ walletPrice: "3.50" });
    const first = planDevelopmentInitialAcceptance(f.context);
    f.listing.price = "9.99";
    const second = planDevelopmentInitialAcceptance(f.context);
    expect(second.terms.digest).toBe(first.terms.digest);
    expect(second.terms.terms.pricePerUsdt).toBe("3.20");
    expect(second.terms.terms.fiatAmount).toBe("646.40");
    expect(second.pricing).toEqual({ source: "retained_request", walletListingPrice: "3.50", requiresFrozenPriceTransition: true });
    expect(second.inputDigest).not.toBe(first.inputDigest);
    expect(second.acceptanceKey).toBe(first.acceptanceKey);
  });

  it("uses the immutable bank snapshot after a seller edits or deletes the live account", () => {
    const f = fixture(), first = planDevelopmentInitialAcceptance(f.context);
    f.seller.sellerBankAccounts = []; f.listing.bankAccountId = "replacement-bank";
    const second = planDevelopmentInitialAcceptance(f.context);
    expect(second.terms.digest).toBe(first.terms.digest);
    expect(second.inputDigest).not.toBe(first.inputDigest);
  });

  it("keeps transport retries and later planning clocks out of business identity", () => {
    const f = fixture(), before = planDevelopmentInitialAcceptance(f.context);
    f.context.operationId = "different-network-retry"; f.context.acceptedAtMs += 1;
    f.marketplace.users.reverse();
    const after = planDevelopmentInitialAcceptance(f.context);
    expect(after.acceptanceKey).toBe(before.acceptanceKey); expect(after.inputDigest).toBe(before.inputDigest);
    expect(after.plannedAtMs).toBe(before.plannedAtMs + 1);
    expect(JSON.stringify(after)).not.toContain("different-network-retry");
  });

  it("returns deeply frozen detached evidence without private account or bank records", () => {
    const f = fixture(), plan = planDevelopmentInitialAcceptance(f.context), digest = walletDigest(plan);
    const frozen = (value: unknown) => { if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen); } };
    frozen(plan);
    expect(() => Object.assign(plan.terms.terms, { principalRaw: "1" })).toThrow(TypeError);
    f.request.sellerBankAccountSnapshot!.accountNumber = "9999"; f.seller.disabled = true;
    f.context.wallet.state.accounts.clear();
    expect(walletDigest(plan)).toBe(digest);
    for (const secret of ["00001234", "private-synthetic-password-hash", "+12025550101", "@example.invalid"]) expect(JSON.stringify(plan)).not.toContain(secret);
  });

  it("never reads wall-clock time while deriving the plan", () => {
    const f = fixture();
    const now = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("No ambient clock"); });
    expect(planDevelopmentInitialAcceptance(f.context).plannedAtMs).toBe(AT + 1000);
    expect(now).not.toHaveBeenCalled();
  });

  it.each([TRON, BSC])("preserves payable sub-cent six-decimal fees on %s", assetId => {
    const f = fixture({ assetId, amount: "0.00005", price: "320.00", minimum: "0.00005" });
    const plan = planDevelopmentInitialAcceptance(f.context), decimals = assetFor(assetId).decimals;
    expect(plan.terms.terms).toMatchObject({ usdtAmount: "0.00005", fiatAmount: "0.02",
      principalRaw: parseUnits("0.00005", decimals).toString(), buyerFeeRaw: parseUnits("0.000001", decimals).toString(),
      sellerFeeRaw: parseUnits("0.000001", decimals).toString(), totalFeeRaw: parseUnits("0.000002", decimals).toString() });
  });
});

describe("explicit complete dependencies and retained buyer provenance", () => {
  it.each(["users", "marketplaceListings", "purchaseRequests", "commissionRecords", "sellerReviews", "marketplaceEnforcementRecords", "tradeEvidenceFiles", "disputes"] as const)(
    "refuses an omitted %s collection", field => { const f = fixture(); delete (f.context.marketplace as Partial<DevelopmentInitialAcceptanceMarketplace>)[field]; failure(f, "INVALID"); });

  it("refuses caller authority fields and malformed canonical collections", () => {
    const f = fixture(); Object.assign(f.context, { authenticated: true, role: "owner", buyerAccepted: true }); failure(f, "INVALID");
    const missing = fixture(); Object.assign(missing.marketplace, { disputes: null }); failure(missing, "INVALID");
  });

  it.each(["account", "request", "listing", "trade identity"])("refuses duplicate %s provenance", kind => {
    const f = fixture();
    if (kind === "account") f.marketplace.users.push(structuredClone(f.buyer));
    if (kind === "request") f.marketplace.purchaseRequests.push(structuredClone(f.request));
    if (kind === "listing") f.marketplace.marketplaceListings.push(structuredClone(f.listing));
    if (kind === "trade identity") history(f, "cancelled", { tradeId: f.request.tradeId });
    failure(f, "INTEGRITY");
  });

  it.each([BUYER.id, OWNER.id, "unrelated-user"])("refuses non-seller action from %s", actor => {
    const f = fixture(); f.context.actorUserId = actor; failure(f, "ACTOR");
  });
  it("refuses a self-trade", () => { const f = fixture(); f.request.buyerId = f.seller.id; failure(f, "ACTOR"); });

  it.each(["missing", "wrong buyer", "wrong role", "duplicate", "future"])("refuses %s buyer submission evidence", kind => {
    const f = fixture();
    if (kind === "missing") f.request.timeline = [];
    if (kind === "wrong buyer") f.request.timeline[0]!.actorUserId = f.seller.id;
    if (kind === "wrong role") f.request.timeline[0]!.actorRole = "guest";
    if (kind === "duplicate") f.request.timeline.push({ ...f.request.timeline[0]!, id: "duplicate-submission" });
    if (kind === "future") f.request.timeline[0]!.createdAt = new Date(AT + 1001).toISOString();
    failure(f);
  });

  it.each(["bank_details_revealed", "trade_inactivity_warning_sent"] as const)("explicitly excludes %s from the first clean cohort", type => {
    const f = fixture(); f.request.timeline.push({ ...f.request.timeline[0]!, id: "extra-history", type }); failure(f, "UNSUPPORTED");
  });
  it("excludes persisted reminder state without treating it as payment proof", () => {
    const f = fixture(); f.request.actionReminderState = { stage: "pending", actionStartedAt: TIME }; failure(f, "UNSUPPORTED");
  });

  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, -1, 0, 8_640_000_000_000_001])("refuses unsafe clock %s", clock => {
    const f = fixture(); f.context.acceptedAtMs = clock; failure(f, "INVALID");
  });
  it.each(["request", "listing", "account", "phone", "adult"])("refuses contradictory future %s chronology", kind => {
    const f = fixture(), future = new Date(AT + 1002).toISOString();
    if (kind === "request") f.request.updatedAt = future;
    if (kind === "listing") f.listing.updatedAt = future;
    if (kind === "account") f.buyer.updatedAt = future;
    if (kind === "phone") f.buyer.phoneVerifiedAt = future;
    if (kind === "adult") f.buyer.ageEligibility!.confirmedAt = future;
    failure(f, "STALE");
  });
  it("requires a strictly later acceptance clock", () => { const f = fixture(); f.context.acceptedAtMs = AT; failure(f, "STALE"); });
});

describe("current participants, debt and cross-seller buyer history", () => {
  it.each(["seller", "buyer"] as const)("requires current email, phone and adult evidence for the %s", side => {
    for (const gate of ["disabled", "email", "phone", "adult"] as const) {
      const f = fixture(), account = f[side];
      if (gate === "disabled") account.disabled = true;
      if (gate === "email") account.emailVerified = false;
      if (gate === "phone") delete account.phoneVerifiedAt;
      if (gate === "adult") delete account.ageEligibility;
      failure(f, "LOCKED");
    }
  });
  it("does not use test phone-bypass environment variables as consent or eligibility", () => {
    const f = fixture(); delete f.buyer.verifiedPhone; delete f.buyer.phoneVerifiedAt;
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", f.buyer.email); vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1"); failure(f, "LOCKED");
  });
  it.each(["pending_seller_approval", "rejected", "suspended"] as const)("rejects canonical seller status %s despite a stale approved role", status => {
    const f = fixture(); f.seller.sellerStatus = status; failure(f, "LOCKED");
  });
  it.each(["hidden", "vacation", "block by seller", "block by buyer"])("rejects %s", kind => {
    const f = fixture();
    if (kind === "hidden") f.seller.isProfileHidden = true;
    if (kind === "vacation") f.seller.availabilityStatus = "vacation";
    if (kind === "block by seller") f.seller.blockedUserIds = [f.buyer.id];
    if (kind === "block by buyer") f.buyer.blockedUserIds = [f.seller.id];
    failure(f, "LOCKED");
  });
  it("preserves canonical away availability and operational owner-as-seller access", () => {
    const f = fixture(); f.seller.availabilityStatus = "away"; f.seller.role = "owner"; f.seller.roles = ["owner"];
    f.seller.sellerStatus = "buyer"; delete f.seller.sellerApprovalVerification;
    expect(planDevelopmentInitialAcceptance(f.context).sellerAction.requestedByUserId).toBe(f.seller.id);
  });
  it("blocks active enforcement and permits retained resolved enforcement", () => {
    const f = fixture();
    f.marketplace.marketplaceEnforcementRecords.push({ id: "enforcement", sellerId: f.seller.id, violationNumber: 1, status: "active",
      feeAmount: 5, feeCurrency: "USDT", reason: "Fixture", issuedByUserId: OWNER.id, issuedAt: TIME, createdAt: TIME, updatedAt: TIME });
    failure(f, "LOCKED"); f.marketplace.marketplaceEnforcementRecords[0]!.status = "resolved_removed";
    expect(planDevelopmentInitialAcceptance(f.context).executionAuthority).toBe(false);
  });
  it.each(["seller", "buyer"] as const)("blocks every unpaid seller debt of the %s, regardless of present role", side => {
    for (const paymentStatus of ["pending", "overdue"] as const) {
      const f = fixture(); f.marketplace.commissionRecords.push(commission(f[side].id, { paymentStatus, paymentVerificationStatus: "pending_verification" }));
      failure(f, "LOCKED");
    }
  });
  it("permits paid historical debt but refuses any already-issued target commission", () => {
    const f = fixture(); f.marketplace.commissionRecords.push(commission(f.seller.id, { paymentStatus: "paid" }));
    expect(planDevelopmentInitialAcceptance(f.context).executionAuthority).toBe(false);
    f.marketplace.commissionRecords[0]!.tradeId = f.request.tradeId; failure(f, "LOCKED");
  });
  it.each(["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const)("blocks a buyer's %s request at another seller", status => {
    const f = fixture(); history(f, status); failure(f, "LOCKED");
  });
  it("counts another pending demand match as an active buyer reservation", () => {
    const f = fixture(); history(f, "pending", { usdtDemandId: "other-demand" }); failure(f, "LOCKED");
  });
  it("does not treat an ordinary pending request at another seller as an active trade", () => {
    const f = fixture(); history(f, "pending"); expect(planDevelopmentInitialAcceptance(f.context).executionAuthority).toBe(false);
  });
  it.each(["accepted", "usdt_sent"] as const)("explicitly excludes the legacy archived %s exception", status => {
    const f = fixture(); history(f, status, { buyerConfirmationArchivedAt: TIME }); failure(f, "UNSUPPORTED");
  });
  it.each(["completed", "locked", "review_open"] as const)("requires buyer feedback on a %s request at another seller", status => {
    const f = fixture(), other = history(f, status); failure(f, "LOCKED");
    other.buyerReview = { reviewerUserId: f.buyer.id, rating: 5, comment: "Reviewed", createdAt: TIME };
    expect(planDevelopmentInitialAcceptance(f.context).executionAuthority).toBe(false);
  });
  it("accepts exact legacy review provenance and rejects another buyer's review", () => {
    const f = fixture(), other = history(f, "completed"); f.marketplace.sellerReviews.push(legacyReview(other));
    expect(planDevelopmentInitialAcceptance(f.context).executionAuthority).toBe(false);
    f.marketplace.sellerReviews[0]!.buyerId = "wrong-buyer"; failure(f, "INTEGRITY");
  });
});

describe("seller-wide capacity and exact funded inventory", () => {
  it("counts seller reservations on other listings and permits the third commitment only", () => {
    const f = fixture(); sellerReservation(f, 1); sellerReservation(f, 2);
    expect(planDevelopmentInitialAcceptance(f.context).preconditions.sellerActiveTradeCount).toBe(2);
    sellerReservation(f, 3); failure(f, "UNAVAILABLE");
  });
  it("counts pending seller demand reservations toward the limit", () => {
    const f = fixture();
    for (let i = 1; i <= 3; i++) { const other = sellerReservation(f, i); other.status = "pending"; other.usdtDemandId = `demand-${i}`; }
    failure(f, "UNAVAILABLE");
  });
  it.each([TRON, BSC])("explicitly excludes otherwise valid same-listing competing reservations on %s", assetId => {
    const f = fixture({ assetId }); sellerReservation(f, 1, true); sellerReservation(f, 2, true);
    const before = structuredClone(f.context);
    failure(f, "UNSUPPORTED");
    expect(f.context).toEqual(before);
    expect(f.listing.availableAmount).toBe("500");
  });
  it("refuses an equal-amount reservation for a different buyer despite matching aggregate balances", () => {
    const f = fixture(); const other = sellerReservation(f, 1, true);
    other.buyerId = "different-canonical-buyer";
    expect(f.context.wallet.state.trades.get("other-wallet-trade-1")!.buyerId).toBe("other-buyer-1");
    expect(balance(f.context.wallet.state, TRON, `listing:${f.context.mapping.walletListingId}`)).toBe(parseUnits("400", 6));
    expect(BigInt(500 - Number(other.usdtAmount)) * BigInt(1_000_000)).toBe(parseUnits("400", 6));
    failure(f, "UNSUPPORTED");
  });
  it("refuses an omitted canonical reservation that still exists in wallet balances", () => {
    const f = fixture(); sellerReservation(f, 1, true); f.marketplace.purchaseRequests.splice(1);
    f.listing.status = "active"; delete f.listing.activeTradeRequestId; delete f.listing.lockedAt; failure(f, "UNSUPPORTED");
  });
  it("refuses an unpaired active seller wallet trade on another listing", () => {
    const f = fixture();
    f.wallet.createListing(SELLER, "create-other-listing", { id: "other-wallet-listing", assetId: TRON, amount: "100", price: "3.20", currency: "ILS" });
    f.wallet.approveListing(OWNER, "approve-other-listing", "other-wallet-listing");
    const intent = f.wallet.createDepositIntent(SELLER, "create-other-deposit", { id: "other-funding", assetId: TRON, purpose: "principal" });
    f.wallet.observeDeposit(VERIFIER, "observe-other-deposit", { intentId: intent.id, assetId: TRON, network: assetFor(TRON).network,
      token: assetFor(TRON).token, transactionId: "sim-tx-other-funding", eventIndex: 0, destination: intent.destination,
      amountRaw: parseUnits("100", 6).toString(), blockHash: "sim-block-other-funding", finalized: true, successful: true });
    f.wallet.reserveTrade({ kind: "buyer", id: "unpaired-buyer" }, "unpaired-reservation", { id: "unpaired-wallet-trade",
      listingId: "other-wallet-listing", amount: "100", destination: simulatedDestination(TRON, "unpaired-buyer") }); f.refresh();
    expect(balance(f.context.wallet.state, TRON, `listing:${f.context.mapping.walletListingId}`)).toBe(parseUnits("500", 6));
    failure(f, "UNSUPPORTED");
  });
  it("refuses unmapped completed history even with exact remaining principal and settled fees", () => {
    const f = fixture(), other = sellerReservation(f, 1, true);
    const tradeId = "other-wallet-trade-1", dispatcher: Actor = { kind: "dispatcher", id: "sim-dispatcher" };
    const otherBuyer: Actor = { kind: "buyer", id: "other-buyer-1" };
    f.wallet.markBuyerPaid(otherBuyer, "old-payment-claim", tradeId);
    f.wallet.verifyPayment(VERIFIER, "old-payment-verification", { tradeId,
      evidence: { reference: "sim-evidence-old-trade", amountMinor: "32320", currency: "ILS", kind: "simulated-bank-credit" } });
    f.wallet.authorizeRelease(SELLER, "old-authorization", tradeId);
    f.wallet.reconcileAsset(VERIFIER, "old-reconciliation", { assetId: TRON, observedRaw: parseUnits("500", 6).toString(), complete: true });
    f.wallet.setNativeFeeReadiness(OWNER, "old-gas", { assetId: TRON, ready: true });
    const payout = f.wallet.queueRelease(dispatcher, "old-release", tradeId);
    f.wallet.beginDispatch(dispatcher, "old-dispatch", payout.id);
    f.wallet.confirmPayout(VERIFIER, "old-settlement", { payoutId: payout.id, providerReference: payout.providerReference,
      assetId: TRON, network: assetFor(TRON).network, token: assetFor(TRON).token, transactionId: "sim-tx-old-settlement", eventIndex: 0,
      destination: payout.destination, amountRaw: payout.amountRaw.toString(), finalized: true, successful: true });
    const fees = f.wallet.createDepositIntent(SELLER, "old-fee-intent", { id: "old-fees", assetId: TRON, purpose: "commission" });
    f.wallet.observeDeposit(VERIFIER, "old-fee-deposit", { intentId: fees.id, assetId: TRON, network: assetFor(TRON).network,
      token: assetFor(TRON).token, transactionId: "sim-tx-old-fees", eventIndex: 0, destination: fees.destination,
      amountRaw: parseUnits("2", 6).toString(), blockHash: "sim-block-old-fees", finalized: true, successful: true });
    other.status = "review_open"; other.completedAt = TIME;
    f.listing.availableAmount = "400"; f.listing.status = "active"; delete f.listing.activeTradeRequestId; delete f.listing.lockedAt;
    f.refresh();
    expect(f.context.wallet.state.commissions.get(tradeId)!.paid).toBe(true);
    expect(balance(f.context.wallet.state, TRON, `listing:${f.context.mapping.walletListingId}`)).toBe(parseUnits("400", 6));
    failure(f, "UNSUPPORTED");
  });
  it("requires seller inventory listings for every retained active seller request", () => {
    const f = fixture(); sellerReservation(f, 1); f.marketplace.marketplaceListings.splice(1); failure(f, "INTEGRITY");
  });
  it.each(["minimum", "maximum", "remaining"])("refuses principal outside %s availability", kind => {
    const f = fixture();
    if (kind === "minimum") f.listing.minimumTrade = "201";
    if (kind === "maximum") f.listing.maximumTrade = "199";
    if (kind === "remaining") { f.listing.maximumTrade = "600"; f.request.usdtAmount = "501"; f.request.fiatAmount = calculateTradePaymentTotal("501", "3.20", true)!; }
    failure(f, "UNAVAILABLE");
  });
  it.each(["canonical approval", "wallet approval", "wallet funding", "wallet closed", "paused"])("requires %s eligibility", kind => {
    const f = fixture(), listing = f.context.wallet.state.listings.get(f.context.mapping.walletListingId)!;
    if (kind === "canonical approval") f.listing.approvalStatus = "pending";
    if (kind === "wallet approval") listing.approved = false;
    if (kind === "wallet funding") listing.funded = false;
    if (kind === "wallet closed") listing.closed = true;
    if (kind === "paused") f.context.wallet.state.haltReason = "manual fixture pause";
    failure(f, "LOCKED");
  });
  it("refuses an expired listing without changing a valid canonical request", () => {
    const f = fixture(); f.listing.expiresAt = TIME; failure(f, "UNSUPPORTED"); expect(f.request.status).toBe("pending");
  });
  it("refuses corrupted wallet balances and malformed map entries", () => {
    const f = fixture(); f.context.wallet.state.accounts.set(`${TRON}|listing:${f.context.mapping.walletListingId}`, BigInt(1)); failure(f, "INTEGRITY");
    const malformed = fixture(); Object.assign(malformed.context.wallet.state.listings.get(malformed.context.mapping.walletListingId)!, { funded: "yes" }); failure(malformed, "INVALID");
  });
  it("refuses preexisting wallet trade identity and does not reinterpret a buyer reservation", () => {
    const f = fixture(); f.wallet.reserveTrade(BUYER, "prior-buyer-command", { id: f.context.mapping.walletTradeId,
      listingId: f.context.mapping.walletListingId, amount: "200", destination: simulatedDestination(f.assetId, f.buyer.id) }); f.refresh();
    failure(f, "LOCKED");
  });
});

describe("first-cohort exclusions and immutable terms", () => {
  it.each(["trade identity", "buyer offer", "demand", "counteroffer", "amount correction", "old fees", "old precision", "Wise", "ATM", "other network"])(
    "refuses unsupported %s without converting it", kind => {
      const f = fixture();
      if (kind === "trade identity") delete f.request.tradeId;
      if (kind === "buyer offer") f.request.priceMode = "buyer_offer";
      if (kind === "demand") f.request.usdtDemandId = "current-demand";
      if (kind === "counteroffer" || kind === "amount correction") f.request.termsProposal = { id: "proposal", kind: kind === "counteroffer" ? "counter_offer" : "amount_correction",
        status: "pending", usdtAmount: "200", fiatAmount: "646.40", pricePerUsdt: "3.20", createdAt: TIME };
      if (kind === "old fees") delete f.request.feePolicyVersion;
      if (kind === "old precision") delete f.request.commissionCalculationVersion;
      if (kind === "Wise") f.request.bankTransferProvider = "wise";
      if (kind === "ATM") f.request.paymentMethod = "Cardless ATM Withdrawal";
      if (kind === "other network") f.request.network = "BEP20";
      failure(f, "UNSUPPORTED");
    });
  it.each(["tradeCreatedAt", "paymentSentAt", "fundsReceivedAt", "usdtReleaseStartedAt", "usdtSentAt", "completedAt", "lockedAt", "reviewUnlockedAt", "closedAt"] as const)(
    "refuses retained %s despite a pending status", field => { const f = fixture(); f.request[field] = TIME; failure(f, "LOCKED"); });
  it("refuses an accepted timeline even when the status was rolled back", () => {
    const f = fixture(); f.request.timeline.push({ ...f.request.timeline[0]!, id: "prior-acceptance", type: "request_accepted", actorUserId: f.seller.id }); failure(f, "LOCKED");
  });
  it.each(["buyer", "seller"] as const)("refuses retained %s evidence", side => {
    const f = fixture(); f.marketplace.tradeEvidenceFiles.push({ id: "evidence", purchaseRequestId: f.request.id, side }); failure(f, "LOCKED");
  });
  it.each(["open", "resolved"] as const)("refuses %s dispute history in the initial cohort", status => {
    const f = fixture(); f.marketplace.disputes.push({ id: "dispute", purchaseRequestId: f.request.id, status }); failure(f, "LOCKED");
  });
  it("requires both retained buyer and current seller face-to-face consent", () => {
    const f = fixture({ method: "Face-to-Face (Meet in Person)" }); f.context.safetyAcknowledged = false; failure(f, "LOCKED");
    f.request.sellerSafetyAcknowledged = true; failure(f, "LOCKED");
    f.context.safetyAcknowledged = true; f.request.buyerSafetyAcknowledged = false; failure(f, "LOCKED");
  });
  it.each(["missing price", "forged fiat", "wrong original price", "bad bank", "missing bank", "live destination"])("refuses %s", kind => {
    const f = fixture();
    if (kind === "missing price") delete f.request.pricePerUsdt;
    if (kind === "forged fiat") f.request.fiatAmount = "640.00";
    if (kind === "wrong original price") f.request.listingPriceAtRequest = "3.30";
    if (kind === "bad bank") f.request.sellerBankAccountSnapshot!.accountLast4 = "0000";
    if (kind === "missing bank") delete f.request.sellerBankAccountSnapshot;
    if (kind === "live destination") f.request.buyerReceivingWalletAddress = "TThatIsNotASimulationDestination";
    failure(f);
  });
  it("keeps principal, separate fee funds and history untouched on every refusal", () => {
    const f = fixture(); f.request.fiatAmount = "0.00";
    const before = structuredClone(f.context); failure(f);
    expect(f.context).toEqual(before);
    expect(balance(f.context.wallet.state, TRON, `listing:${f.context.mapping.walletListingId}`)).toBe(parseUnits("500", 6));
    expect(f.context.wallet.state.trades.size).toBe(0);
  });
  it("refuses hosted or signing-enabled execution even for a valid plan", () => {
    const f = fixture(); vi.stubEnv("VERCEL", "1"); expect(() => planDevelopmentInitialAcceptance(f.context)).toThrow(/hosted/);
    vi.stubEnv("VERCEL", undefined); vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "1"); expect(() => planDevelopmentInitialAcceptance(f.context)).toThrow(/signing/);
  });
});
