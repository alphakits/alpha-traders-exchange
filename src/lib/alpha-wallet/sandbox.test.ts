// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetFor, parseUnits, type AssetId } from "./amounts";
import { assertLedgerInvariants } from "./ledger";
import { createAlphaWalletSandbox, simulatedDestination, type AlphaWalletSandbox } from "./sandbox";
import type { Actor, DepositIntent, DepositObservation, DepositPurpose, PaymentEvidence, Payout, PayoutReceipt, Trade } from "./types";

const TRON: AssetId = "tron-sim-usdt";
const BSC: AssetId = "bsc-sim-binance-peg-usdt";
const SELLER: Actor = { kind: "seller", id: "seller-a" };
const OTHER_SELLER: Actor = { kind: "seller", id: "seller-b" };
const BUYER: Actor = { kind: "buyer", id: "buyer-a" };
const BUYER_B: Actor = { kind: "buyer", id: "buyer-b" };
const OPERATOR: Actor = { kind: "operator", id: "owner-operator" };
const VERIFIER: Actor = { kind: "verifier", id: "independent-verifier" };
const DISPATCHER: Actor = { kind: "dispatcher", id: "payout-dispatcher" };

type Fixture = {
  wallet: AlphaWalletSandbox;
  assetId: AssetId;
  clock: { now: number };
  request: (label: string) => string;
};

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(key, undefined);
  }
});
afterEach(() => vi.unstubAllEnvs());

function fixture(assetId: AssetId = TRON): Fixture {
  const clock = { now: 1_800_000_000_000 };
  let sequence = 0;
  return {
    wallet: createAlphaWalletSandbox({ mode: "simulation-only", clock: () => clock.now }),
    assetId,
    clock,
    request: label => `${label}-${++sequence}`,
  };
}

function intent(f: Fixture, purpose: DepositPurpose = "principal", seller = SELLER, assetId = f.assetId) {
  return f.wallet.createDepositIntent(seller, f.request("command"), { id: f.request("deposit"), assetId, purpose });
}

function observation(deposit: DepositIntent, amount: string, overrides: Partial<DepositObservation> = {}): DepositObservation {
  const asset = assetFor(deposit.assetId);
  return {
    intentId: deposit.id,
    assetId: deposit.assetId,
    network: asset.network,
    token: asset.token,
    destination: deposit.destination,
    amountRaw: parseUnits(amount, asset.decimals).toString(),
    transactionId: `sim-tx-${deposit.id}`,
    eventIndex: 0,
    blockHash: "sim-block-original",
    finalized: true,
    successful: true,
    ...overrides,
  };
}

function deposit(f: Fixture, amount: string, purpose: DepositPurpose = "principal", seller = SELLER, assetId = f.assetId) {
  const depositIntent = intent(f, purpose, seller, assetId);
  const event = observation(depositIntent, amount);
  f.wallet.observeDeposit(VERIFIER, f.request("observe"), event);
  return { intent: depositIntent, event };
}

function listing(f: Fixture, amount = "500", approve = true) {
  const created = f.wallet.createListing(SELLER, f.request("create"), {
    id: f.request("listing"), assetId: f.assetId, amount, price: "3.20", currency: "ILS",
  });
  if (approve) f.wallet.approveListing(OPERATOR, f.request("approve"), created.id);
  return f.wallet.getListing(created.id);
}

function fundedListing(f: Fixture, amount = "500", approve = true) {
  const created = listing(f, amount, approve);
  const funding = deposit(f, amount);
  return { listing: f.wallet.getListing(created.id), ...funding };
}

function reserve(f: Fixture, listingId: string, amount = "200", buyer = BUYER, destination = simulatedDestination(f.assetId, buyer.id)) {
  return f.wallet.reserveTrade(buyer, f.request("reserve"), { id: f.request("trade"), listingId, amount, destination });
}

function evidence(trade: Trade, overrides: Partial<PaymentEvidence> = {}): PaymentEvidence {
  return {
    reference: `sim-evidence-${trade.id}`,
    kind: "simulated-bank-credit",
    currency: "ILS",
    amountMinor: trade.fiatTotalMinor.toString(),
    ...overrides,
  };
}

function authorize(f: Fixture, tradeId: string) {
  const trade = f.wallet.getTrade(tradeId);
  f.wallet.markBuyerPaid({ kind: "buyer", id: trade.buyerId }, f.request("paid"), tradeId);
  f.wallet.verifyPayment(VERIFIER, f.request("verify"), { tradeId, evidence: evidence(trade) });
  return f.wallet.authorizeRelease({ kind: "seller", id: trade.sellerId }, f.request("authorize"), tradeId);
}

function reconcile(f: Fixture, assetId = f.assetId) {
  return f.wallet.reconcileAsset(VERIFIER, f.request("reconcile"), {
    assetId, observedRaw: f.wallet.expectedCustody(assetId).toString(), complete: true,
  });
}

function outgoingReady(f: Fixture, assetId = f.assetId) {
  reconcile(f, assetId);
  f.wallet.setNativeFeeReadiness(OPERATOR, f.request("gas"), { assetId, ready: true });
}

function queuedTrade(f: Fixture, amount = "200") {
  const funded = fundedListing(f);
  const trade = reserve(f, funded.listing.id, amount);
  authorize(f, trade.id);
  outgoingReady(f);
  const payout = f.wallet.queueRelease(DISPATCHER, f.request("queue"), trade.id);
  return { ...funded, trade: f.wallet.getTrade(trade.id), payout };
}

function broadcast(f: Fixture, payout: Payout, transactionId = `sim-tx-${payout.id}`) {
  f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id);
  return f.wallet.recordSubmission(DISPATCHER, f.request("submission"), { payoutId: payout.id, outcome: "broadcast", transactionId });
}

function receipt(payout: Payout, overrides: Partial<PayoutReceipt> = {}): PayoutReceipt {
  const asset = assetFor(payout.assetId);
  return {
    payoutId: payout.id,
    providerReference: payout.providerReference,
    assetId: payout.assetId,
    network: asset.network,
    token: asset.token,
    transactionId: payout.transactionId ?? `sim-tx-${payout.id}`,
    eventIndex: 0,
    destination: payout.destination,
    amountRaw: payout.amountRaw.toString(),
    finalized: true,
    successful: true,
    ...overrides,
  };
}

function completeTrade(f: Fixture, tradeId: string) {
  authorize(f, tradeId);
  outgoingReady(f);
  const payout = f.wallet.queueRelease(DISPATCHER, f.request("queue"), tradeId);
  const sent = broadcast(f, payout);
  f.wallet.confirmPayout(VERIFIER, f.request("confirm"), receipt(sent));
  return f.wallet.getPayout(payout.id);
}

/** A rejected command must roll back its journal, balances, state, and idempotency record. */
function unchanged(f: Fixture, action: () => unknown, error?: RegExp) {
  const before = f.wallet.snapshot();
  expect(action).toThrow(error);
  expect(f.wallet.snapshot()).toEqual(before);
  expect(f.wallet.assertInvariants()).toBe(true);
}

function financialState(f: Fixture) {
  const { idempotency: _idempotency, ...state } = f.wallet.snapshot();
  return state;
}

describe("Alpha Wallet principal funding", () => {
  it.each(["approval-first", "funding-first"] as const)("requires both full 500 USDT funding and owner approval: %s", order => {
    const f = fixture();
    const item = listing(f, "500", order === "approval-first");
    expect(f.wallet.getListing(item.id).status).toBe("awaiting_funding");
    unchanged(f, () => reserve(f, item.id), /fully funded/);
    deposit(f, "500");
    if (order === "funding-first") {
      expect(f.wallet.getListing(item.id).status).toBe("awaiting_owner_approval");
      unchanged(f, () => reserve(f, item.id), /approved/);
      unchanged(f, () => f.wallet.approveListing(SELLER, f.request("approve"), item.id), /operator/);
      f.wallet.approveListing(OPERATOR, f.request("approve"), item.id);
    }
    expect(f.wallet.getListing(item.id)).toMatchObject({ status: "active", funded: true, approved: true, availableRaw: BigInt(500_000_000) });
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
    expect(f.wallet.getBalance(TRON, "platform-revenue")).toBe(BigInt(0));
  });

  it("does not apply the legacy commission tolerance to 498 USDT of 500 USDT principal", () => {
    const f = fixture();
    const item = listing(f);
    deposit(f, "498");
    expect(f.wallet.getListing(item.id)).toMatchObject({ funded: false, status: "awaiting_funding", availableRaw: BigInt(0) });
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(498_000_000));
    unchanged(f, () => reserve(f, item.id, "498"), /fully funded/);
    deposit(f, "2");
    expect(f.wallet.getListing(item.id).availableRaw).toBe(BigInt(500_000_000));
    expect(f.wallet.getListing(item.id).status).toBe("active");
  });

  it.each([
    { finalized: false, successful: true },
    { finalized: true, successful: false },
    { finalized: false, successful: false },
  ])("does not credit an unconfirmed or failed deposit: %j", flags => {
    const f = fixture();
    const item = listing(f);
    const event = observation(intent(f), "500", flags);
    expect(f.wallet.observeDeposit(VERIFIER, f.request("observe"), event).credited).toBe(false);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(0));
    expect(f.wallet.snapshot().journal).toHaveLength(0);
    expect(f.wallet.getListing(item.id).status).toBe("awaiting_funding");
  });

  it("credits a pending deposit once when the same event finalizes", () => {
    const f = fixture();
    const event = observation(intent(f), "500", { finalized: false });
    f.wallet.observeDeposit(VERIFIER, f.request("pending"), event);
    expect(f.wallet.observeDeposit(VERIFIER, f.request("finalized"), { ...event, finalized: true }).credited).toBe(true);
    const before = financialState(f);
    expect(f.wallet.observeDeposit(VERIFIER, f.request("duplicate"), { ...event, finalized: true })).toMatchObject({ credited: false, duplicate: true });
    expect(financialState(f)).toEqual(before);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
  });

  it("reports the current pause on a duplicate credited-deposit callback without crediting again", () => {
    const f = fixture();
    const { listing: item, event } = fundedListing(f);
    f.wallet.pause(OPERATOR, f.request("pause"));
    const before = financialState(f);
    expect(f.wallet.observeDeposit(VERIFIER, f.request("duplicate-after-pause"), event)).toEqual({ credited: false, duplicate: true, halted: true });
    expect(financialState(f)).toEqual(before);
    expect(f.wallet.getListing(item.id).walletPaused).toBe(true);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
  });

  it("can replace unfinalized failed execution in a different block but rejects a contradictory same-block result", () => {
    const f = fixture();
    const item = listing(f);
    const pending = observation(intent(f), "500", { finalized: false, successful: false, blockHash: "sim-block-pending-failure" });
    f.wallet.observeDeposit(VERIFIER, f.request("pending"), pending);
    unchanged(f, () => f.wallet.observeDeposit(VERIFIER, f.request("contradiction"), { ...pending, successful: true, finalized: true }), /same block/);
    const final = { ...pending, successful: true, finalized: true, blockHash: "sim-block-reincluded-success" };
    expect(f.wallet.observeDeposit(VERIFIER, f.request("reincluded"), final)).toMatchObject({ credited: true, halted: false });
    expect(f.wallet.observeDeposit(VERIFIER, f.request("duplicate"), final)).toMatchObject({ credited: false, duplicate: true, halted: false });
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
    expect(f.wallet.getListing(item.id).status).toBe("active");
  });

  it.each([
    ["network", { network: "bsc-simulation" }],
    ["token", { token: "sim-token-counterfeit" }],
    ["recipient", { destination: "sim://tron-sim-usdt/deposit/not-this-intent" }],
    ["intent asset", { assetId: BSC, network: assetFor(BSC).network, token: assetFor(BSC).token }],
    ["zero amount", { amountRaw: "0" }],
    ["real transaction", { transactionId: "a".repeat(64) }],
  ] satisfies Array<[string, Partial<DepositObservation>]>)("rejects invalid deposit %s without any credit", (_name, overrides) => {
    const f = fixture();
    const event = observation(intent(f), "500", overrides);
    unchanged(f, () => f.wallet.observeDeposit(VERIFIER, f.request("observe"), event));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(0));
  });

  it("deduplicates each transfer log while allowing two distinct logs in one transaction", () => {
    const f = fixture();
    const item = listing(f);
    const first = observation(intent(f), "250");
    f.wallet.observeDeposit(VERIFIER, "same-command", first);
    f.wallet.observeDeposit(VERIFIER, "same-command", first);
    f.wallet.observeDeposit(VERIFIER, f.request("duplicate"), first);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(250_000_000));
    f.wallet.observeDeposit(VERIFIER, f.request("second-log"), { ...first, eventIndex: 1 });
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
    expect(f.wallet.getListing(item.id).status).toBe("active");
    expect(f.wallet.snapshot().deposits.size).toBe(2);
  });

  it("rejects event reassignment and conflicting idempotency payloads", () => {
    const f = fixture();
    const event = observation(intent(f), "250");
    f.wallet.observeDeposit(VERIFIER, "fixed-observation", event);
    unchanged(f, () => f.wallet.observeDeposit(VERIFIER, "fixed-observation", { ...event, amountRaw: "500000000" }), /Idempotency/);
    unchanged(f, () => f.wallet.observeDeposit(VERIFIER, f.request("conflict"), { ...event, amountRaw: "500000000" }), /Conflicting duplicate/);
    const different = intent(f, "principal", OTHER_SELLER);
    unchanged(f, () => f.wallet.observeDeposit(VERIFIER, f.request("reassign"), { ...event, intentId: different.id, destination: different.destination }), /Conflicting duplicate/);
    expect(f.wallet.getBalance(TRON, `available:${OTHER_SELLER.id}`)).toBe(BigInt(0));
  });

  it("keeps chain-specific custody and commission-purpose deposits out of principal funding", () => {
    const f = fixture();
    const item = listing(f);
    deposit(f, "500", "principal", SELLER, BSC);
    deposit(f, "500", "commission");
    expect(f.wallet.getListing(item.id).status).toBe("awaiting_funding");
    expect(f.wallet.getBalance(BSC, `available:${SELLER.id}`)).toBe(BigInt("500000000000000000000"));
    expect(f.wallet.getBalance(TRON, `commission:${SELLER.id}`)).toBe(BigInt(500_000_000));
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(0));
    deposit(f, "500");
    expect(f.wallet.getListing(item.id).status).toBe("active");
    expect(f.wallet.assertInvariants()).toBe(true);
  });

  it("does not reuse one deposit to fund two listings", () => {
    const f = fixture();
    const first = fundedListing(f).listing;
    const second = listing(f);
    expect(f.wallet.getListing(first.id).availableRaw).toBe(BigInt(500_000_000));
    expect(f.wallet.getListing(second.id).status).toBe("awaiting_funding");
    unchanged(f, () => reserve(f, second.id), /fully funded/);
  });

  it("detects missing account balances even when all credited snapshot accounts are deleted", () => {
    const f = fixture();
    deposit(f, "500");
    const corrupted = f.wallet.snapshot();
    corrupted.accounts.clear();
    expect(() => assertLedgerInvariants(corrupted)).toThrow(/Journal-derived balance/);
    expect(f.wallet.assertInvariants()).toBe(true);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
  });

  it.each([
    [TRON, "0.000001"],
    [BSC, "0.000000000000000001"],
  ] as const)("preserves a single raw unit through %s deposit and withdrawal", (assetId, amount) => {
    const f = fixture(assetId);
    deposit(f, amount);
    expect(f.wallet.getBalance(assetId, `available:${SELLER.id}`)).toBe(BigInt(1));
    outgoingReady(f);
    const payout = f.wallet.requestWithdrawal(SELLER, f.request("withdraw"), {
      id: f.request("withdrawal"), assetId, amount, destination: simulatedDestination(assetId, "seller-return"), stepUpReference: "sim-stepup-dust",
    });
    expect(payout.amountRaw).toBe(BigInt(1));
    f.wallet.confirmPayout(VERIFIER, f.request("confirm"), receipt(broadcast(f, payout)));
    expect(f.wallet.expectedCustody(assetId)).toBe(BigInt(0));
    expect(f.wallet.assertInvariants()).toBe(true);
  });

  it("retains 18-decimal deposit dust beside a six-decimal marketplace quantity", () => {
    const f = fixture(BSC);
    const item = listing(f);
    deposit(f, "500.000000000000000001");
    expect(f.wallet.getListing(item.id).availableRaw).toBe(BigInt("500000000000000000000"));
    expect(f.wallet.getBalance(BSC, `available:${SELLER.id}`)).toBe(BigInt(1));
    expect(f.wallet.expectedCustody(BSC)).toBe(BigInt("500000000000000000001"));
    expect(reserve(f, item.id, "200.123456").amountRaw).toBe(BigInt("200123456000000000000"));
  });
});

describe("Alpha Wallet reservations", () => {
  it("reserves 200 + 300 from 500 exactly and returns a cancelled reservation", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const first = reserve(f, item.id, "200");
    const second = reserve(f, item.id, "300", BUYER_B);
    expect(f.wallet.getBalance(TRON, `trade:${first.id}`)).toBe(BigInt(200_000_000));
    expect(f.wallet.getBalance(TRON, `trade:${second.id}`)).toBe(BigInt(300_000_000));
    expect(f.wallet.getListing(item.id).status).toBe("no_available_inventory");
    unchanged(f, () => reserve(f, item.id, "0.01", { kind: "buyer", id: "buyer-c" }), /Insufficient/);
    f.wallet.cancelTrade(BUYER, "cancel-once", first.id);
    f.wallet.cancelTrade(BUYER, "cancel-once", first.id);
    expect(f.wallet.getListing(item.id).availableRaw).toBe(BigInt(200_000_000));
    expect(f.wallet.getBalance(TRON, `trade:${first.id}`)).toBe(BigInt(0));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
  });

  it("allows only one competing 300 USDT reservation in one process", async () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    // This exercises interleaved callers of synchronous commands. It makes no
    // claim about independent database connections, workers, or server instances.
    const attempts = await Promise.allSettled([BUYER, BUYER_B].map(async buyer => reserve(f, item.id, "300", buyer)));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(f.wallet.snapshot().trades.size).toBe(1);
    expect(f.wallet.getListing(item.id).availableRaw).toBe(BigInt(200_000_000));
    expect(f.wallet.assertInvariants()).toBe(true);
  });

  it("enforces three active seller trades and frees capacity after cancellation", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const trades = ["a", "b", "c"].map(suffix => reserve(f, item.id, "100", { kind: "buyer", id: `buyer-${suffix}` }));
    unchanged(f, () => reserve(f, item.id, "100", { kind: "buyer", id: "buyer-d" }), /three active/);
    f.wallet.cancelTrade(SELLER, f.request("cancel"), trades[0]!.id);
    expect(reserve(f, item.id, "100", { kind: "buyer", id: "buyer-d" }).status).toBe("reserved");
    expect(f.wallet.getListing(item.id).availableRaw).toBe(BigInt(200_000_000));
  });

  it("rejects self-trades and a receiving chain different from funded custody", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    unchanged(f, () => reserve(f, item.id, "200", { kind: "buyer", id: SELLER.id }), /Self trade/);
    unchanged(f, () => reserve(f, item.id, "200", BUYER, simulatedDestination(BSC, BUYER.id)), /funded simulation asset/);
  });

  it("does not let returned objects or snapshots rewrite reserved terms", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const trade = reserve(f, item.id);
    const original = f.wallet.getTrade(trade.id);
    trade.destination = simulatedDestination(TRON, "attacker");
    trade.amountRaw = BigInt(1);
    const snapshot = f.wallet.snapshot();
    snapshot.trades.get(trade.id)!.destination = trade.destination;
    snapshot.accounts.clear();
    expect(f.wallet.getTrade(trade.id)).toEqual(original);
    authorize(f, trade.id);
    outgoingReady(f);
    const payout = f.wallet.queueRelease(DISPATCHER, f.request("queue"), trade.id);
    expect(payout.destination).toBe(original.destination);
    expect(payout.amountRaw).toBe(BigInt(200_000_000));
  });
});

describe("Alpha Wallet verified payment and authority", () => {
  it("never treats buyer-paid as release authority", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const trade = reserve(f, item.id);
    f.wallet.markBuyerPaid(BUYER, f.request("paid"), trade.id);
    outgoingReady(f);
    unchanged(f, () => f.wallet.authorizeRelease(BUYER, f.request("authorize"), trade.id), /seller/);
    unchanged(f, () => f.wallet.authorizeRelease(SELLER, f.request("authorize"), trade.id), /Independently verified/);
    unchanged(f, () => f.wallet.queueRelease(DISPATCHER, f.request("queue"), trade.id), /not authorized/);
    expect(f.wallet.getTrade(trade.id).status).toBe("payment_reported");
    expect(f.wallet.snapshot().payouts.size).toBe(0);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
  });

  it.each([
    BUYER, SELLER, OPERATOR,
    { kind: "verifier", id: BUYER.id },
    { kind: "verifier", id: SELLER.id },
  ] satisfies Actor[])("rejects payment verification by unauthorized or non-independent actor %j", actor => {
    const f = fixture();
    const trade = reserve(f, fundedListing(f).listing.id);
    f.wallet.markBuyerPaid(BUYER, f.request("paid"), trade.id);
    unchanged(f, () => f.wallet.verifyPayment(actor, f.request("verify"), { tradeId: trade.id, evidence: evidence(trade) }));
  });

  it("checks the actual buyer and seller, not just their role", () => {
    const f = fixture();
    const trade = reserve(f, fundedListing(f).listing.id);
    unchanged(f, () => f.wallet.markBuyerPaid(BUYER_B, f.request("paid"), trade.id), /Not trade buyer/);
    f.wallet.markBuyerPaid(BUYER, f.request("paid"), trade.id);
    f.wallet.verifyPayment(VERIFIER, f.request("verify"), { tradeId: trade.id, evidence: evidence(trade) });
    unchanged(f, () => f.wallet.authorizeRelease(OTHER_SELLER, f.request("authorize"), trade.id), /Not trade seller/);
  });

  it.each([
    ["missing buyer fee", { amountMinor: "64000" }],
    ["short payment", { amountMinor: "64639" }],
    ["different payment amount", { amountMinor: "64641" }],
    ["wrong currency", { currency: "USD" }],
    ["buyer claim", { kind: "buyer-said-paid" }],
    ["real payment reference", { reference: "bank-reference-123" }],
  ])("requires exact independent payment evidence: %s", (_name, overrides) => {
    const f = fixture();
    const trade = reserve(f, fundedListing(f).listing.id);
    expect(trade.fiatTotalMinor).toBe(BigInt(64640));
    f.wallet.markBuyerPaid(BUYER, f.request("paid"), trade.id);
    const proof = { ...evidence(trade), ...(overrides as object) } as PaymentEvidence;
    unchanged(f, () => f.wallet.verifyPayment(VERIFIER, f.request("verify"), { tradeId: trade.id, evidence: proof }));
  });

  it("cannot use one payment proof to release two trades", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const first = reserve(f, item.id, "100");
    const second = reserve(f, item.id, "100", BUYER_B);
    f.wallet.markBuyerPaid(BUYER, f.request("paid"), first.id);
    f.wallet.markBuyerPaid(BUYER_B, f.request("paid"), second.id);
    const proof = evidence(first);
    f.wallet.verifyPayment(VERIFIER, "verify-proof-once", { tradeId: first.id, evidence: proof });
    f.wallet.verifyPayment(VERIFIER, "verify-proof-once", { tradeId: first.id, evidence: proof });
    unchanged(f, () => f.wallet.verifyPayment(VERIFIER, f.request("reuse"), { tradeId: second.id, evidence: proof }), /already used/);
    expect(f.wallet.getTrade(second.id).status).toBe("payment_reported");
    expect(f.wallet.snapshot().evidenceOwners.size).toBe(1);
  });
});

describe("Alpha Wallet full principal and separate commission", () => {
  it("creates the 2% obligation only after payout, and pays it only from commission-purpose funds", () => {
    const f = fixture();
    const { listing: item, trade, payout } = queuedTrade(f);
    expect(f.wallet.snapshot().commissions.size).toBe(0);
    const sent = broadcast(f, payout);
    expect(f.wallet.snapshot().commissions.size).toBe(0);
    f.wallet.confirmPayout(VERIFIER, f.request("confirm"), receipt(sent));
    expect(f.wallet.getPayout(payout.id).amountRaw).toBe(BigInt(200_000_000));
    expect(f.wallet.getListing(item.id).availableRaw).toBe(BigInt(300_000_000));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(300_000_000));
    expect(f.wallet.snapshot().commissions.get(trade.id)).toMatchObject({ amountRaw: BigInt(4_000_000), paid: false });
    expect(f.wallet.getBalance(TRON, "platform-revenue")).toBe(BigInt(0));
    unchanged(f, () => reserve(f, item.id, "100", BUYER_B), /Unpaid commission/);
    unchanged(f, () => listing(f, "1"), /Unpaid commission/);
    deposit(f, "4", "principal");
    expect(f.wallet.snapshot().commissions.get(trade.id)!.paid).toBe(false);
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(4_000_000));
    expect(f.wallet.getBalance(TRON, "platform-revenue")).toBe(BigInt(0));
    deposit(f, "4", "commission");
    expect(f.wallet.snapshot().commissions.get(trade.id)!.paid).toBe(true);
    expect(f.wallet.getBalance(TRON, "platform-revenue")).toBe(BigInt(4_000_000));
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(4_000_000));
    expect(f.wallet.getListing(item.id).availableRaw).toBe(BigInt(300_000_000));
    expect(reserve(f, item.id, "100", BUYER_B).status).toBe("reserved");
  });

  it("delivers all 500 USDT and settles 10 USDT from a separately funded fee balance", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    deposit(f, "10", "commission");
    const trade = reserve(f, item.id, "500");
    expect(trade).toMatchObject({ amountRaw: BigInt(500_000_000), buyerFeeRaw: BigInt(5_000_000), sellerFeeRaw: BigInt(5_000_000), fiatTotalMinor: BigInt(161600) });
    const payout = completeTrade(f, trade.id);
    expect(payout.amountRaw).toBe(BigInt(500_000_000));
    expect(f.wallet.getListing(item.id).availableRaw).toBe(BigInt(0));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(10_000_000));
    expect(f.wallet.getBalance(TRON, "platform-revenue")).toBe(BigInt(10_000_000));
    expect(f.wallet.snapshot().commissions.get(trade.id)!.paid).toBe(true);
  });

  it("finishes existing 200 + 300 reservations even when the first payout creates commission due", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const first = reserve(f, item.id, "200");
    const second = reserve(f, item.id, "300", BUYER_B);
    completeTrade(f, first.id);
    expect(f.wallet.snapshot().commissions.get(first.id)!.paid).toBe(false);
    completeTrade(f, second.id);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(0));
    expect([...f.wallet.snapshot().payouts.values()].reduce((sum, payout) => sum + payout.amountRaw, BigInt(0))).toBe(BigInt(500_000_000));
    expect([...f.wallet.snapshot().commissions.values()].reduce((sum, due) => sum + due.amountRaw, BigInt(0))).toBe(BigInt(10_000_000));
    deposit(f, "10", "commission");
    expect([...f.wallet.snapshot().commissions.values()].every(due => due.paid)).toBe(true);
    expect(f.wallet.getBalance(TRON, "platform-revenue")).toBe(BigInt(10_000_000));
    expect(f.wallet.assertInvariants()).toBe(true);
  });

  it("does not recognize commission or revenue from a failed final payout", () => {
    const f = fixture();
    const { trade, payout } = queuedTrade(f);
    const sent = broadcast(f, payout);
    const failure = receipt(sent, { successful: false });
    f.wallet.confirmPayout(VERIFIER, "terminal-failure", failure);
    const before = financialState(f);
    expect(f.wallet.confirmPayout(VERIFIER, "terminal-failure", failure).state).toBe("failed_final");
    expect(f.wallet.confirmPayout(VERIFIER, f.request("failure-retry"), failure).state).toBe("failed_final");
    expect(financialState(f)).toEqual(before);
    unchanged(f, () => f.wallet.confirmPayout(VERIFIER, f.request("contradiction"), { ...failure, successful: true }), /Conflicting terminal failure/);
    expect(f.wallet.getPayout(payout.id).state).toBe("failed_final");
    expect(f.wallet.getBalance(TRON, `payout:${payout.id}`)).toBe(BigInt(200_000_000));
    expect(f.wallet.getTrade(trade.id).status).toBe("payout_pending");
    expect(f.wallet.snapshot().commissions.size).toBe(0);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
    unchanged(f, () => f.wallet.beginDispatch(DISPATCHER, f.request("retry"), payout.id), /already dispatched/);
  });
});

describe("Alpha Wallet cancellations, disputes, and withdrawals", () => {
  it("cancels before payment and rejects cancellation after a payment claim", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const trade = reserve(f, item.id);
    unchanged(f, () => f.wallet.cancelTrade(BUYER_B, f.request("cancel"), trade.id), /Not a trade party/);
    f.wallet.markBuyerPaid(BUYER, f.request("paid"), trade.id);
    unchanged(f, () => f.wallet.cancelTrade(SELLER, f.request("cancel"), trade.id), /prevents automatic cancellation/);
    expect(f.wallet.getBalance(TRON, `trade:${trade.id}`)).toBe(BigInt(200_000_000));
  });

  it.each(["reserved", "payment_reported", "payment_verified", "release_authorized", "queued"] as const)("freezes further payment or payout progress when disputed at %s", stage => {
    const f = fixture();
    const trade = reserve(f, fundedListing(f).listing.id);
    if (stage !== "reserved") f.wallet.markBuyerPaid(BUYER, f.request("paid"), trade.id);
    if (["payment_verified", "release_authorized", "queued"].includes(stage)) f.wallet.verifyPayment(VERIFIER, f.request("verify"), { tradeId: trade.id, evidence: evidence(trade) });
    if (["release_authorized", "queued"].includes(stage)) f.wallet.authorizeRelease(SELLER, f.request("authorize"), trade.id);
    outgoingReady(f);
    const payout = stage === "queued" ? f.wallet.queueRelease(DISPATCHER, f.request("queue"), trade.id) : null;
    expect(f.wallet.openDispute(BUYER, f.request("dispute"), trade.id)).toEqual({
      tradeId: trade.id, payoutState: stage === "queued" ? "queued" : null, inFlight: false, frozen: true, alreadySettled: false,
    });
    const next = stage === "reserved" ? () => f.wallet.markBuyerPaid(BUYER, f.request("paid"), trade.id)
      : stage === "payment_reported" ? () => f.wallet.verifyPayment(VERIFIER, f.request("verify"), { tradeId: trade.id, evidence: evidence(trade) })
      : stage === "payment_verified" ? () => f.wallet.authorizeRelease(SELLER, f.request("authorize"), trade.id)
      : stage === "release_authorized" ? () => f.wallet.queueRelease(DISPATCHER, f.request("queue"), trade.id)
      : () => f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout!.id);
    unchanged(f, next);
    unchanged(f, () => f.wallet.cancelTrade(SELLER, f.request("cancel"), trade.id));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
  });

  it("reports an already-settled payout truthfully when a dispute is opened later", () => {
    const f = fixture();
    const trade = reserve(f, fundedListing(f).listing.id);
    const payout = completeTrade(f, trade.id);
    expect(f.wallet.openDispute(BUYER, f.request("dispute"), trade.id)).toEqual({
      tradeId: trade.id, payoutState: "confirmed", inFlight: false, frozen: false, alreadySettled: true,
    });
    expect(f.wallet.getBalance(TRON, `payout:${payout.id}`)).toBe(BigInt(0));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(300_000_000));
    expect(f.wallet.getTrade(trade.id)).toMatchObject({ status: "completed", disputed: true });
  });

  it("closing a listing frees only unreserved principal and preserves the live trade", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const trade = reserve(f, item.id);
    outgoingReady(f);
    unchanged(f, () => f.wallet.closeListing(OTHER_SELLER, f.request("close"), item.id), /Not listing owner/);
    f.wallet.closeListing(SELLER, f.request("close"), item.id);
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(300_000_000));
    expect(f.wallet.getBalance(TRON, `trade:${trade.id}`)).toBe(BigInt(200_000_000));
    const withdrawal = { id: "closed-remainder", assetId: TRON, amount: "301", destination: simulatedDestination(TRON, "seller-return"), stepUpReference: "sim-stepup-remainder" };
    unchanged(f, () => f.wallet.requestWithdrawal(SELLER, f.request("withdraw"), withdrawal), /Insufficient/);
    const payout = f.wallet.requestWithdrawal(SELLER, f.request("withdraw"), { ...withdrawal, amount: "300" });
    expect(payout.amountRaw).toBe(BigInt(300_000_000));
    f.wallet.cancelTrade(BUYER, f.request("cancel"), trade.id);
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(200_000_000));
    expect(f.wallet.getListing(item.id).status).toBe("closed");
    unchanged(f, () => reserve(f, item.id), /approved and fully funded/);
  });

  it("withdrawals cannot consume listing principal, trade locks, or fee-purpose balances", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    reserve(f, item.id, "200");
    deposit(f, "50", "commission");
    outgoingReady(f);
    const input = { id: "locked-funds", assetId: TRON, amount: "1", destination: simulatedDestination(TRON, "seller-return"), stepUpReference: "sim-stepup-locked" };
    unchanged(f, () => f.wallet.requestWithdrawal(SELLER, f.request("withdraw"), input), /Insufficient/);
    unchanged(f, () => f.wallet.requestWithdrawal(BUYER, f.request("withdraw"), input), /seller/);
    expect(f.wallet.getBalance(TRON, `listing:${item.id}`)).toBe(BigInt(300_000_000));
    expect(f.wallet.getBalance(TRON, `commission:${SELLER.id}`)).toBe(BigInt(50_000_000));
  });

  it("binds withdrawal amount and destination across retries and returned-object mutations", () => {
    const f = fixture();
    deposit(f, "500");
    outgoingReady(f);
    const input = { id: "withdraw-once", assetId: TRON, amount: "200", destination: simulatedDestination(TRON, "seller-return"), stepUpReference: "sim-stepup-exact-intent" };
    const payout = f.wallet.requestWithdrawal(SELLER, "withdraw-command", input);
    unchanged(f, () => f.wallet.requestWithdrawal(SELLER, "withdraw-command", { ...input, destination: simulatedDestination(TRON, "attacker") }), /Idempotency/);
    unchanged(f, () => f.wallet.requestWithdrawal(SELLER, f.request("duplicate-id"), input), /already exists/);
    unchanged(f, () => f.wallet.requestWithdrawal(SELLER, f.request("no-approval"), { ...input, id: "different-id", stepUpReference: "" }), /approval/);
    unchanged(f, () => f.wallet.requestWithdrawal(SELLER, f.request("wrong-chain"), { ...input, id: "different-id", destination: simulatedDestination(BSC, "seller-return") }), /funded simulation asset/);
    payout.destination = simulatedDestination(TRON, "attacker");
    payout.amountRaw = BigInt(1);
    const actual = f.wallet.getPayout(payout.id);
    expect(actual.destination).toBe(input.destination);
    expect(actual.amountRaw).toBe(BigInt(200_000_000));
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(300_000_000));
  });

  it("unpaid commission blocks withdrawal even after listing principal becomes available", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const trade = reserve(f, item.id, "200");
    completeTrade(f, trade.id);
    f.wallet.closeListing(SELLER, f.request("close"), item.id);
    outgoingReady(f);
    unchanged(f, () => f.wallet.requestWithdrawal(SELLER, f.request("withdraw"), {
      id: "fee-due", assetId: TRON, amount: "300", destination: simulatedDestination(TRON, "seller-return"), stepUpReference: "sim-stepup-fees",
    }), /Unpaid commission/);
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(300_000_000));
  });
});

describe("Alpha Wallet payout reconciliation and retry safety", () => {
  it("requires fresh reconciliation and a separate native fee reserve", () => {
    const f = fixture();
    const trade = reserve(f, fundedListing(f).listing.id);
    authorize(f, trade.id);
    unchanged(f, () => f.wallet.queueRelease(DISPATCHER, f.request("queue"), trade.id), /Fresh matching/);
    reconcile(f);
    unchanged(f, () => f.wallet.queueRelease(DISPATCHER, f.request("queue"), trade.id), /native network-fee/);
    f.wallet.setNativeFeeReadiness(OPERATOR, f.request("gas"), { assetId: TRON, ready: true });
    const payout = f.wallet.queueRelease(DISPATCHER, f.request("queue"), trade.id);
    f.clock.now += 60_001;
    unchanged(f, () => f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id), /Fresh matching/);
    reconcile(f);
    f.wallet.setNativeFeeReadiness(OPERATOR, f.request("gas-unavailable"), { assetId: TRON, ready: false });
    unchanged(f, () => f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id), /native network-fee/);
  });

  it("invalidates a reconciliation when a later deposit changes custody", () => {
    const f = fixture();
    const { payout } = queuedTrade(f);
    deposit(f, "1");
    unchanged(f, () => f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id), /Fresh matching/);
    reconcile(f);
    expect(f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id).shouldDispatch).toBe(true);
  });

  it("holds an unknown submission and reconciles its late receipt without dispatching twice", () => {
    const f = fixture();
    const { payout, trade } = queuedTrade(f);
    expect(f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id).shouldDispatch).toBe(true);
    f.wallet.recordSubmission(DISPATCHER, f.request("unknown"), { payoutId: payout.id, outcome: "unknown" });
    unchanged(f, () => f.wallet.beginDispatch(DISPATCHER, f.request("second-dispatch"), payout.id), /already dispatched/);
    unchanged(f, () => f.wallet.queueRelease(DISPATCHER, f.request("second-queue"), trade.id));
    unchanged(f, () => f.wallet.cancelTrade(SELLER, f.request("cancel"), trade.id));
    expect(f.wallet.getBalance(TRON, `payout:${payout.id}`)).toBe(BigInt(200_000_000));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
    f.wallet.confirmPayout(VERIFIER, f.request("late-receipt"), receipt(payout));
    expect(f.wallet.getPayout(payout.id)).toMatchObject({ state: "confirmed", dispatchCount: 1 });
    expect(f.wallet.getTrade(trade.id).status).toBe("completed");
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(300_000_000));
  });

  it("never reissues dispatch permission for the same command, including after dispute, pause, and settlement", () => {
    const f = fixture();
    const { payout, trade } = queuedTrade(f);
    const first = f.wallet.beginDispatch(DISPATCHER, "dispatch-once", payout.id);
    expect(first.shouldDispatch).toBe(true);
    expect(f.wallet.beginDispatch(DISPATCHER, "dispatch-once", payout.id)).toMatchObject({ shouldDispatch: false, payout: { state: "submitting", dispatchCount: 1 } });
    f.wallet.recordSubmission(DISPATCHER, f.request("unknown"), { payoutId: payout.id, outcome: "unknown" });
    expect(f.wallet.beginDispatch(DISPATCHER, "dispatch-once", payout.id)).toMatchObject({ shouldDispatch: false, payout: { state: "submission_unknown" } });
    expect(f.wallet.openDispute(BUYER, f.request("dispute"), trade.id)).toMatchObject({ payoutState: "submission_unknown", inFlight: true, frozen: false, alreadySettled: false });
    f.wallet.pause(OPERATOR, f.request("pause"));
    expect(f.wallet.beginDispatch(DISPATCHER, "dispatch-once", payout.id)).toMatchObject({ shouldDispatch: false, payout: { state: "submission_unknown", dispatchCount: 1 } });
    f.wallet.confirmPayout(VERIFIER, f.request("late-receipt"), receipt(payout));
    expect(f.wallet.getTrade(trade.id)).toMatchObject({ status: "completed", disputed: true });
    expect(f.wallet.beginDispatch(DISPATCHER, "dispatch-once", payout.id)).toMatchObject({ shouldDispatch: false, payout: { state: "confirmed", dispatchCount: 1 } });
    expect(f.wallet.snapshot().commissions.size).toBe(1);
  });

  it("does not accept an on-chain receipt before dispatch or finality", () => {
    const f = fixture();
    const { payout } = queuedTrade(f);
    unchanged(f, () => f.wallet.confirmPayout(VERIFIER, f.request("premature"), receipt(payout)), /not been dispatched/);
    const sent = broadcast(f, payout);
    unchanged(f, () => f.wallet.confirmPayout(VERIFIER, f.request("unfinalized"), receipt(sent, { finalized: false })), /not finalized/);
    expect(f.wallet.getBalance(TRON, `payout:${payout.id}`)).toBe(BigInt(200_000_000));
    expect(f.wallet.snapshot().commissions.size).toBe(0);
  });

  it.each([
    ["amount", { amountRaw: "199000000" }],
    ["destination", { destination: simulatedDestination(TRON, "attacker") }],
    ["network", { network: assetFor(BSC).network }],
    ["token", { token: "sim-token-counterfeit" }],
    ["asset", { assetId: BSC, network: assetFor(BSC).network, token: assetFor(BSC).token }],
    ["provider reference", { providerReference: "sim-payout-unrelated" }],
    ["transaction", { transactionId: "sim-tx-unrelated" }],
  ] satisfies Array<[string, Partial<PayoutReceipt>]>)("rejects payout receipts with mismatching %s", (_name, overrides) => {
    const f = fixture();
    const { payout } = queuedTrade(f);
    const sent = broadcast(f, payout);
    unchanged(f, () => f.wallet.confirmPayout(VERIFIER, f.request("mismatch"), receipt(sent, overrides)));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
    expect(f.wallet.snapshot().commissions.size).toBe(0);
  });

  it("consumes a payout receipt once across same-key and fresh-key retries", () => {
    const f = fixture();
    const { payout } = queuedTrade(f);
    const proof = receipt(broadcast(f, payout));
    f.wallet.confirmPayout(VERIFIER, "confirm-once", proof);
    const before = financialState(f);
    f.wallet.confirmPayout(VERIFIER, "confirm-once", proof);
    f.wallet.confirmPayout(VERIFIER, f.request("fresh-retry"), proof);
    expect(financialState(f)).toEqual(before);
    expect(f.wallet.snapshot().commissions.size).toBe(1);
    expect(f.wallet.snapshot().receipts.size).toBe(1);
  });

  it("rejects reused transfer evidence while recognizing separate payout logs in a shared transaction", () => {
    const f = fixture();
    const item = fundedListing(f).listing;
    const destination = simulatedDestination(TRON, "shared-test-recipient");
    const first = reserve(f, item.id, "100", BUYER, destination);
    const second = reserve(f, item.id, "100", BUYER_B, destination);
    authorize(f, first.id);
    authorize(f, second.id);
    outgoingReady(f);
    const firstPayout = f.wallet.queueRelease(DISPATCHER, f.request("queue"), first.id);
    const secondPayout = f.wallet.queueRelease(DISPATCHER, f.request("queue"), second.id);
    const firstSent = broadcast(f, firstPayout, "sim-tx-shared-batch");
    const secondSent = broadcast(f, secondPayout, "sim-tx-shared-batch");
    f.wallet.confirmPayout(VERIFIER, f.request("confirm"), receipt(firstSent));
    unchanged(f, () => f.wallet.confirmPayout(VERIFIER, f.request("reused-log"), receipt(secondSent)), /already consumed/);
    f.wallet.confirmPayout(VERIFIER, f.request("distinct-log"), receipt(secondSent, { eventIndex: 1 }));
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(300_000_000));
    expect(f.wallet.snapshot().receipts.size).toBe(2);
    expect(f.wallet.assertInvariants()).toBe(true);
  });

  it("cannot reuse an incoming chain event as outgoing payout evidence", () => {
    const f = fixture();
    const { payout, event } = queuedTrade(f);
    const sent = broadcast(f, payout, event.transactionId);
    unchanged(f, () => f.wallet.confirmPayout(VERIFIER, f.request("reused-incoming"), receipt(sent, { eventIndex: event.eventIndex })), /incoming deposit/);
    expect(f.wallet.getPayout(payout.id).state).toBe("broadcast");
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(500_000_000));
    expect(f.wallet.getBalance(TRON, `payout:${payout.id}`)).toBe(BigInt(200_000_000));
  });

  it("cannot reuse a settled outgoing chain event as a new incoming deposit", () => {
    const f = fixture();
    const { payout } = queuedTrade(f);
    const sent = broadcast(f, payout);
    const proof = receipt(sent);
    f.wallet.confirmPayout(VERIFIER, f.request("confirm"), proof);
    const recycled = observation(intent(f), "200", { transactionId: proof.transactionId, eventIndex: proof.eventIndex });
    unchanged(f, () => f.wallet.observeDeposit(VERIFIER, f.request("reused-outgoing"), recycled), /outgoing payout/);
    expect(f.wallet.expectedCustody(TRON)).toBe(BigInt(300_000_000));
    expect(f.wallet.getBalance(TRON, `available:${SELLER.id}`)).toBe(BigInt(0));
  });

  it("pauses outgoing actions after reconciliation mismatch and does not resume automatically", () => {
    const f = fixture();
    const { listing: item, payout } = queuedTrade(f);
    expect(f.wallet.reconcileAsset(VERIFIER, f.request("mismatch"), { assetId: TRON, observedRaw: "499000000", complete: true })).toEqual({ matched: false, halted: true });
    expect(f.wallet.getListing(item.id).walletPaused).toBe(true);
    unchanged(f, () => f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id), /paused/);
    unchanged(f, () => reserve(f, item.id, "100", BUYER_B), /paused/);
    expect(reconcile(f)).toEqual({ matched: true, halted: true });
    unchanged(f, () => f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id), /paused/);
    expect(f.wallet.getBalance(TRON, `payout:${payout.id}`)).toBe(BigInt(200_000_000));
  });

  it("cannot reconcile partial provider history", () => {
    const f = fixture();
    deposit(f, "500");
    unchanged(f, () => f.wallet.reconcileAsset(VERIFIER, f.request("partial"), { assetId: TRON, observedRaw: "500000000", complete: false }), /Incomplete/);
    expect(f.wallet.snapshot().reconciliations.size).toBe(0);
  });

  it.each([
    { blockHash: "sim-block-reorganized" },
    { finalized: false },
    { successful: false },
  ] satisfies Partial<DepositObservation>[])("pauses when finalized funding evidence changes: %j", change => {
    const f = fixture();
    const { payout, event } = queuedTrade(f);
    const beforeBalance = f.wallet.expectedCustody(TRON);
    const beforeJournal = f.wallet.snapshot().journal;
    expect(f.wallet.observeDeposit(VERIFIER, f.request("reorg"), { ...event, ...change })).toMatchObject({ credited: false, duplicate: true, halted: true });
    expect(f.wallet.expectedCustody(TRON)).toBe(beforeBalance);
    expect(f.wallet.snapshot().journal).toEqual(beforeJournal);
    unchanged(f, () => f.wallet.beginDispatch(DISPATCHER, f.request("dispatch"), payout.id), /paused/);
    expect(f.wallet.getBalance(TRON, `payout:${payout.id}`)).toBe(BigInt(200_000_000));
  });
});
