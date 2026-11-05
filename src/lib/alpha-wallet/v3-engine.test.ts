// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetFor, parseUnits, quoteTrade, type AssetId } from "./amounts";
import { applyWalletCommand, parseWalletCommand, walletCommandKey, walletDigest, walletJson, type WalletCommand } from "./commands";
import { walletCommand } from "./durable";
import { planDevelopmentInitialAcceptance } from "./initial-acceptance";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { createAlphaWalletSandbox } from "./sandbox";
import type { Actor, State } from "./types";
import { parseV2Command, v2Command, versionedCommandKey, type V2Checkpoint } from "./v2-commands";
import { applyV2Command, assertV2Invariants, type V2State } from "./v2-engine";
import { verifyVersionedHistory } from "./versioned-durable";
import {
  initialInputFromPlan, initialPlannerDigest, parseV3Command, parseV3VersionedCommand, v3Command, v3CommandKey,
  WALLET_V3_ENGINE_VERSION, type V3Command, type V3CommandOf, type V3InitialAcceptanceInput,
} from "./v3-commands";
import { applyV3Command, assertV3Invariants, baseV2StateForV3, findV3InitialAcceptanceReplay, isV3State,
  type V3InitialAcceptanceReceipt, type V3State } from "./v3-engine";
import { createV3InitialAcceptanceFixture } from "./v3-fixtures";

const TRON: AssetId = "tron-sim-usdt", BSC: AssetId = "bsc-sim-binance-peg-usdt";
const SELLER: Actor = { kind: "seller", id: "v3-seller" }, BUYER: Actor = { kind: "buyer", id: "v3-buyer" };
const OPERATOR: Actor = { kind: "operator", id: "v3-operator" }, VERIFIER: Actor = { kind: "verifier", id: "v3-verifier" };
const NOW = 1_800_000_000_000, GENESIS = "0".repeat(64);
const LISTING = "v3-wallet-listing", TRADE = "v3-wallet-trade", REQUEST = "v3-request";
const METHODS = ["Bank Transfer", "Face-to-Face (Meet in Person)"] as const;
type Acceptance = V3CommandOf<"acceptInitialSellerRequest">;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

function fixture(options: { assetId?: AssetId; walletPrice?: string; continue?: boolean } = {}) {
  const assetId = options.assetId ?? TRON, asset = assetFor(assetId), wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => NOW });
  const records: Array<Record<string, unknown>> = [];
  let head: V2Checkpoint = { revision: 0, eventHash: GENESIS, stateHash: walletDigest(wallet.snapshot()), lastCommandAtMs: NOW };
  const record = (command: WalletCommand | V3Command | ReturnType<typeof v2Command>, result: unknown, state: State, at: number) => {
    const revision = head.revision + 1, commandKey = v3CommandKey(command), inputHash = walletDigest(command), resultHash = walletDigest(result), stateHash = walletDigest(state);
    const eventHash = walletDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: head.eventHash });
    records.push({ revision, command_key: commandKey, command_type: command.type, occurred_at_ms: String(at), command_json: command,
      input_hash: inputHash, result_json: walletJson(result), result_hash: resultHash, state_hash: stateHash, previous_event_hash: head.eventHash, event_hash: eventHash });
    head = { revision, eventHash, stateHash, lastCommandAtMs: at };
  };
  const v1 = (command: WalletCommand) => {
    const result = applyWalletCommand(wallet, command); record(command, result, wallet.snapshot(), head.lastCommandAtMs + 1); return result;
  };
  v1(walletCommand("createListing", SELLER, "v3-create-listing", { id: LISTING, assetId, amount: "500", price: options.walletPrice ?? "3.20", currency: "ILS" }));
  v1(walletCommand("approveListing", OPERATOR, "v3-approve-listing", LISTING));
  const intent = v1(walletCommand("createDepositIntent", SELLER, "v3-deposit-intent", { id: "v3-deposit", assetId, purpose: "principal" })) as { destination: string };
  v1(walletCommand("observeDeposit", VERIFIER, "v3-deposit-event", { intentId: "v3-deposit", assetId, network: asset.network, token: asset.token,
    destination: intent.destination, transactionId: "sim-tx-v3-funding", eventIndex: 0, amountRaw: parseUnits("500", asset.decimals).toString(),
    blockHash: "sim-block-v3-funding", finalized: true, successful: true }));
  const v1State = wallet.snapshot();
  const v2Continuation = v2Command("continueFromV1", OPERATOR, "v3-prior-v2-upgrade", { checkpoint: { ...head } });
  const v2Applied = applyV2Command(v1State, v2Continuation, { ...head, at: head.lastCommandAtMs + 1 });
  record(v2Continuation, v2Applied.result, v2Applied.state, head.lastCommandAtMs + 1);
  const source = verifyVersionedHistory(records);
  expect(walletDigest(source.state)).toBe(head.stateHash);
  const v2State = structuredClone(v2Applied.state), v2Head = structuredClone(head);
  let state: V2State | V3State = structuredClone(v2State);
  const checkpoint = () => ({ ...head, stateHash: walletDigest(state) });
  const step = (command: V3Command) => {
    const at = head.lastCommandAtMs + 1;
    const applied = applyV3Command(state, command, { ...checkpoint(), at });
    state = applied.state; record(command, applied.result, state, at); return applied.result;
  };
  const continuation = v3Command("continueFromV2", OPERATOR, "v3-upgrade", { checkpoint: v2Head });
  if (options.continue !== false) step(continuation);
  const acceptance = (settings: { amount?: string; price?: string; method?: typeof METHODS[number]; transportId?: string } = {}) => {
    const f = createV3InitialAcceptanceFixture({ mode: "simulation-only", state: state as V3State, walletRevision: head.revision,
      walletEventHash: head.eventHash, atMs: head.lastCommandAtMs + 1, walletListingId: LISTING, walletTradeId: TRADE,
      platformRequestId: REQUEST, platformTradeId: "v3-platform-trade", buyerId: BUYER.id, amount: settings.amount,
      retainedPrice: settings.price, paymentMethod: settings.method });
    const command = v3Command("acceptInitialSellerRequest", SELLER, settings.transportId ?? "v3-acceptance", initialInputFromPlan(f.plan));
    return { ...f, command };
  };
  return { get state() { return state as V3State; }, checkpoint, step, acceptance, records, v1State, v2State, v2Head, continuation, assetId, asset,
    apply(command: V3Command, at = head.lastCommandAtMs + 1) { return applyV3Command(state, command, { ...checkpoint(), at }); },
    replace(next: V3State) { state = next; } };
}

function rehash(command: Acceptance) {
  command.input.termsDigest = walletDigest(command.input.terms);
  command.input.buyerRequestEvidence.termsDigest = command.input.termsDigest;
  command.input.plannerInputDigest = initialPlannerDigest(command.input, command.actor.id);
}
function expectNoWrite(f: ReturnType<typeof fixture>, command: V3Command) {
  const before = walletDigest(f.state);
  expect(() => f.apply(command)).toThrow();
  expect(walletDigest(f.state)).toBe(before);
}

describe("closed seller-native v3 protocol", () => {
  it("strictly separates the three envelopes without changing old transport identities", () => {
    const old = walletCommand("pause", OPERATOR, "same-operation", null), v2 = v2Command("pause", OPERATOR, "same-operation", null);
    const v3 = v3Command("pause", OPERATOR, "same-operation", null);
    expect(v3CommandKey(v3)).toBe(walletCommandKey(old)); expect(v3CommandKey(v3)).toBe(versionedCommandKey(v2));
    expect(new Set([old, v2, v3].map(walletDigest)).size).toBe(3);
    for (const command of [old, v2, v3]) expect(parseV3VersionedCommand(command)).toEqual(command);
    expect(() => parseWalletCommand(v3)).toThrow(); expect(() => parseV2Command(v3)).toThrow();
    expect(() => parseV3Command(old)).toThrow(); expect(() => parseV3Command(v2)).toThrow();
  });

  it.each(["reserveTrade", "createListing", "observeDeposit", "enrollReservedTrade", "acceptAmountCorrection", "markBuyerPaid", "verifyPayment",
    "authorizeRelease", "queueRelease", "cancelTrade", "openDispute", "requestWithdrawal", "beginDispatch", "recordSubmission", "confirmPayout", "resume"])(
    "refuses unsupported v3 operation %s", type => {
      const command = v3Command("pause", OPERATOR, "unsupported", null);
      expect(() => parseV3Command({ ...command, type })).toThrow();
    });

  it.each([0, 1, 2, 4, "3", null, undefined])("refuses wrong v3 envelope version %s", version => {
    expect(() => parseV3Command({ ...v3Command("pause", OPERATOR, "wrong-version", null), version })).toThrow();
  });

  it.each(["outer", "actor", "input", "terms", "sellerAction", "buyerRequestEvidence", "preconditions", "reservation", "pricing"])(
    "refuses unexpected authority/private fields in %s", field => {
      const f = fixture(), command = structuredClone(f.acceptance().command) as unknown as Record<string, unknown>;
      const target = field === "outer" ? command : field === "actor" ? command.actor : field === "input" ? command.input
        : (command.input as Record<string, unknown>)[field];
      (target as Record<string, unknown>).bankAccountNumber = "private-payment-secret";
      expect(() => parseV3Command(command)).toThrow();
    });

  it("never serializes full users, private bank instructions or a fictitious buyer actor", () => {
    const f = fixture(), { plan, command } = f.acceptance(), serialized = JSON.stringify(command);
    expect(plan.executionAuthority).toBe(false); expect(plan.requiredExecutionContract).toBe("seller-initial-acceptance-v3");
    expect(command.actor).toEqual(SELLER);
    expect(command.input.buyerRequestEvidence.buyerId).toBe(BUYER.id);
    for (const value of ["0000000000", "Synthetic fixture bank", "synthetic-wallet-fixture-not-a-login", "@example.invalid", "sellerBankAccountSnapshot"])
      expect(serialized).not.toContain(value);
  });

  it("requires the explicit v3 plan contract and does not turn old groundwork or claimed authority into execution", () => {
    const f = fixture(), { plan, context } = f.acceptance();
    const old = planDevelopmentInitialAcceptance({ ...context, wallet: { state: f.v2State, revision: f.v2Head.revision, eventHash: f.v2Head.eventHash } });
    expect(old.requiredExecutionContract).toBe("seller-initial-acceptance-not-implemented");
    expect(() => initialInputFromPlan(old)).toThrow("seller-native");
    for (const extra of [
      { ...plan, executionAuthority: true }, { ...plan, terms: { ...plan.terms, executionAuthority: true } },
      { ...plan, actorUserId: BUYER.id }, { ...plan, canonicalAcceptance: { ...plan.canonicalAcceptance, tradeId: "alias" } },
      { ...plan, plannedAtMs: plan.plannedAtMs + 1 }, { ...plan, inputDigest: "e".repeat(64) },
    ]) expect(() => initialInputFromPlan(extra as typeof plan)).toThrow();
  });
});

describe("source-bound v2 to v3 continuation", () => {
  it("preserves every inherited accounting/metadata value and adds no financial effect", () => {
    const f = fixture({ continue: false }), before = structuredClone(f.v2State), result = f.step(f.continuation);
    expect(result).toEqual(f.state.initialContinuation);
    expect(result).toEqual({ checkpoint: f.v2Head, commandRevision: f.v2Head.revision + 1, commandKey: v3CommandKey(f.continuation) });
    expect(f.state.engineVersion).toBe(WALLET_V3_ENGINE_VERSION); expect(isV3State(f.state)).toBe(true);
    expect(f.state.initialBindings.size).toBe(0); expect(f.state.initialAcceptanceReceipts.size).toBe(0);
    const inherited = baseV2StateForV3(f.state); inherited.idempotency.delete(`v3:${v3CommandKey(f.continuation)}`);
    expect(walletJson(inherited)).toEqual(walletJson(before));
    expect(f.state.journal).toEqual(before.journal); expect(f.state.payouts).toEqual(before.payouts);
    assertV2Invariants(inherited); assertV3Invariants(f.state);
    inherited.listings.get(LISTING)!.price = "1.00";
    expect(f.state.listings.get(LISTING)!.price).toBe("3.20");
  });

  it.each(["revision", "eventHash", "stateHash", "lastCommandAtMs"] as const)("rejects a changed source %s", field => {
    const f = fixture({ continue: false }), command = structuredClone(f.continuation);
    if (field === "revision" || field === "lastCommandAtMs") command.input.checkpoint[field]++;
    else command.input.checkpoint[field] = "e".repeat(64);
    expectNoWrite(f, command);
  });

  it.each(["seller", "buyer", "verifier", "dispatcher"] as const)("cannot continue with %s authority", kind => {
    const f = fixture({ continue: false }); expectNoWrite(f, { ...f.continuation, actor: { kind, id: OPERATOR.id } });
  });

  it("refuses skipped versions, unknown metadata, missing inherited metadata and implicit execution", () => {
    const f = fixture({ continue: false });
    expect(() => applyV3Command(f.v1State, f.continuation, { ...f.v2Head, stateHash: walletDigest(f.v1State), at: f.v2Head.lastCommandAtMs + 1 })).toThrow("continuation");
    const extra = { ...f.v2State, unsupportedContinuation: true };
    expect(() => applyV3Command(extra, f.continuation, { ...f.v2Head, stateHash: walletDigest(extra), at: f.v2Head.lastCommandAtMs + 1 })).toThrow("known v2");
    expectNoWrite(f, v3Command("pause", OPERATOR, "implicit-upgrade", null));
    const incomplete = { ...f.v2State, termsBindings: undefined } as unknown as V2State;
    expect(() => applyV3Command(incomplete, f.continuation, { ...f.v2Head, stateHash: walletDigest(incomplete), at: f.v2Head.lastCommandAtMs + 1 })).toThrow();
  });

  it("returns the exact original continuation for a retry and refuses a second identity", () => {
    const f = fixture(), before = walletDigest(f.state);
    const retry = f.apply(f.continuation);
    expect(retry.result).toEqual(f.state.initialContinuation); expect(walletDigest(retry.state)).toBe(before);
    expectNoWrite(f, { ...f.continuation, requestId: "another-upgrade" });
    const changed = structuredClone(f.continuation); changed.input.checkpoint.eventHash = "e".repeat(64);
    expectNoWrite(f, changed);
  });

  it.each([-1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, 1.5])("rejects invalid clock %s without modifying history", at => {
    const f = fixture({ continue: false }), before = walletDigest(f.state);
    expect(() => f.apply(f.continuation, at)).toThrow(); expect(walletDigest(f.state)).toBe(before);
  });
});

describe("seller-native full-principal acceptance", () => {
  it.each([TRON, BSC].flatMap(assetId => METHODS.flatMap(method => ["3.20", "3.70"].map(walletPrice => ({ assetId, method, walletPrice })))))(
    "uses the retained price and separate fees for $assetId / $method / wallet price $walletPrice", options => {
      const f = fixture(options), { command, request, listing, plan } = f.acceptance({ method: options.method, price: "3.20" });
      const before = structuredClone(f.state), quote = quoteTrade(f.assetId, "200", "3.20"), custody = expectedCustody(f.state, f.assetId);
      const result = f.step(command) as V3InitialAcceptanceReceipt;
      expect(result).toMatchObject({ acceptanceKey: plan.acceptanceKey, platformRequestId: REQUEST, platformTradeId: "v3-platform-trade",
        actorUserId: SELLER.id, buyerId: BUYER.id, walletTradeId: TRADE, principalRaw: quote.principalRaw.toString(),
        transferAmountRaw: quote.principalRaw.toString(), commandRevision: before.initialContinuation.commandRevision + 1 });
      expect(f.state.trades.get(TRADE)).toMatchObject({ sellerId: SELLER.id, buyerId: BUYER.id, amountRaw: quote.principalRaw,
        buyerFeeRaw: quote.buyerFeeRaw, sellerFeeRaw: quote.sellerFeeRaw, totalFeeRaw: quote.totalFeeRaw,
        fiatTotalMinor: BigInt(64640), destination: command.input.terms.destination, status: "reserved", disputed: false });
      expect(balance(f.state, f.assetId, `listing:${LISTING}`)).toBe(parseUnits("300", f.asset.decimals));
      expect(balance(f.state, f.assetId, `trade:${TRADE}`)).toBe(parseUnits("200", f.asset.decimals));
      expect(expectedCustody(f.state, f.assetId)).toBe(custody);
      expect(f.state.listings).toEqual(before.listings); expect(f.state.payouts).toEqual(before.payouts); expect(f.state.commissions).toEqual(before.commissions);
      expect(f.state.continuation).toEqual(before.continuation); expect(f.state.termsBindings).toEqual(before.termsBindings);
      expect(f.state.acceptanceReceipts).toEqual(before.acceptanceReceipts);
      expect(f.state.journal).toHaveLength(before.journal.length + 1);
      expect(f.state.journal.at(-1)).toMatchObject({ operation: `v3:${v3CommandKey(command)}`, entries: [
        { account: `listing:${LISTING}`, delta: -quote.principalRaw }, { account: `trade:${TRADE}`, delta: quote.principalRaw }] });
      expect(request.status).toBe("pending"); expect(listing.availableAmount).toBe("500");
      expect(f.state.initialBindings.get(REQUEST)).toMatchObject({ revision: 0, termsDigest: command.input.termsDigest, commandKey: result.commandKey,
        walletTradeDigest: walletDigest(f.state.trades.get(TRADE)), terms: { pricePerUsdt: "3.20", fiatAmount: "646.40" } });
      assertLedgerInvariants(f.state); assertV3Invariants(f.state);
    });

  it.each([TRON, BSC])("keeps six-decimal fee rounding and full principal at the %s native scale", assetId => {
    const f = fixture({ assetId }), { command } = f.acceptance({ amount: "1.00005", price: "3.10" }); f.step(command);
    const trade = f.state.trades.get(TRADE)!;
    expect(trade.amountRaw).toBe(parseUnits("1.00005", f.asset.decimals));
    expect(trade.buyerFeeRaw).toBe(parseUnits("0.010001", f.asset.decimals));
    expect(trade.sellerFeeRaw).toBe(parseUnits("0.010001", f.asset.decimals));
    expect(trade.totalFeeRaw).toBe(parseUnits("0.020002", f.asset.decimals));
    expect(balance(f.state, assetId, `trade:${TRADE}`)).toBe(trade.amountRaw);
    expect(trade.fiatTotalMinor).toBe(BigInt(313));
  });

  it("returns detached state, receipt and plan evidence", () => {
    const f = fixture(), { command } = f.acceptance(), before = walletDigest(f.state), applied = f.apply(command);
    expect(walletDigest(f.state)).toBe(before);
    const result = applied.result as V3InitialAcceptanceReceipt;
    result.input.terms.usdtAmount = "1"; result.actorUserId = "tampered";
    command.input.terms.usdtAmount = "2";
    expect(applied.state.initialAcceptanceReceipts.values().next().value?.input.terms.usdtAmount).toBe("200");
    applied.state.trades.get(TRADE)!.amountRaw = BigInt(1);
    expect(f.state.trades.has(TRADE)).toBe(false);
  });

  it.each(["buyer", "operator", "verifier", "dispatcher"] as const)("refuses %s actor even with the seller's id", kind => {
    const f = fixture(), { command } = f.acceptance(); command.actor = { kind, id: SELLER.id }; expectNoWrite(f, command);
  });

  it("refuses a different seller and the buyer impersonating a seller", () => {
    const f = fixture(), { command } = f.acceptance();
    for (const sellerId of ["another-seller", BUYER.id]) expectNoWrite(f, { ...command, actor: { kind: "seller", id: sellerId } });
  });

  it("keeps the existing seller maximum policy: two canonical commitments elsewhere permit the third", () => {
    const f = fixture(), draft = f.acceptance();
    for (const n of [1, 2]) {
      const otherListing = { ...structuredClone(draft.listing), id: `other-listing-${n}`, status: "matched" as const,
        activeTradeRequestId: `other-request-${n}`, lockedAt: draft.request.updatedAt };
      draft.marketplace.marketplaceListings.push(otherListing);
      draft.marketplace.purchaseRequests.push({ ...structuredClone(draft.request), id: `other-request-${n}`, tradeId: `other-platform-trade-${n}`,
        listingId: otherListing.id, buyerId: `other-buyer-${n}`, status: "accepted", tradeCreatedAt: draft.request.updatedAt, usdtAmount: "100", timeline: [] });
    }
    const plan = planDevelopmentInitialAcceptance(draft.context);
    expect(plan.preconditions.sellerActiveTradeCount).toBe(2);
    const command = v3Command("acceptInitialSellerRequest", SELLER, "third-canonical-commitment", initialInputFromPlan(plan));
    f.step(command); expect(f.state.trades.size).toBe(1);
    draft.marketplace.purchaseRequests.push({ ...draft.marketplace.purchaseRequests[1]!, id: "fourth-competitor", tradeId: "fourth-trade" });
    expect(() => planDevelopmentInitialAcceptance(draft.context)).toThrow("three active");
  });
});

describe("immutable acceptance identity and original receipts", () => {
  it("replays exact evidence across transport retries and preserves original command/time without another journal", () => {
    const f = fixture(), { command } = f.acceptance(), receipt = f.step(command), before = walletDigest(f.state);
    for (const requestId of [command.requestId, "second-http-operation", "mobile-operation"]) {
      const replay = f.apply({ ...command, requestId }, f.checkpoint().lastCommandAtMs + 10_000);
      expect(replay.result).toEqual(receipt); expect(walletDigest(replay.state)).toBe(before);
    }
    expect(f.state.initialBindings.size).toBe(1); expect(f.state.initialAcceptanceReceipts.size).toBe(1);
  });

  it("returns only the original detached receipt after a pause and cannot resume or create another acceptance", () => {
    const f = fixture(), { command } = f.acceptance(), receipt = f.step(command);
    f.step(v3Command("pause", OPERATOR, "hold-for-recovery", null));
    const before = walletDigest(f.state), result = findV3InitialAcceptanceReplay(f.state, { ...command, requestId: "lookup-after-pause" })!;
    expect(result).toEqual(receipt); result.buyerId = "altered";
    expect(f.state.initialAcceptanceReceipts.get(command.input.acceptanceKey)?.buyerId).toBe(BUYER.id);
    expect(walletDigest(f.apply(command).state)).toBe(before);
    expect(() => parseV3Command({ ...v3Command("pause", OPERATOR, "resume", null), type: "resume" })).toThrow();
  });

  it.each(["changed-buyer", "changed-request-evidence", "changed-mapping", "changed-price", "changed-actor", "changed-checkpoint"])(
    "rejects %s under the original business acceptance", variant => {
      const f = fixture(), { command } = f.acceptance(); f.step(command);
      const changed = structuredClone(command); changed.requestId = "network-retry";
      if (variant === "changed-buyer") changed.input.terms.buyerId = "other-buyer";
      if (variant === "changed-request-evidence") changed.input.buyerRequestEvidence.submissionTimelineDigest = "e".repeat(64);
      if (variant === "changed-mapping") changed.input.reservation.walletTradeId = "other-trade";
      if (variant === "changed-price") changed.input.terms.pricePerUsdt = "3.21";
      if (variant === "changed-actor") changed.actor.id = "other-seller";
      if (variant === "changed-checkpoint") changed.input.preconditions.walletRevision++;
      rehash(changed); expectNoWrite(f, changed);
    });

  it("rejects changed business keys and duplicate mapping under a fresh transport identity", () => {
    const f = fixture(), { command } = f.acceptance(); f.step(command);
    const changed = structuredClone(command); changed.requestId = "different-operation"; changed.input.acceptanceKey = "e".repeat(64); rehash(changed);
    expectNoWrite(f, changed);
    expect(() => f.acceptance()).toThrow("history");
  });
});

describe("strict source evidence and financial preconditions", () => {
  const mutations: Array<[string, (input: V3InitialAcceptanceInput) => void]> = [
    ["net principal after a fee", input => { input.reservation.transferAmountRaw = (BigInt(input.terms.principalRaw) - BigInt(input.terms.sellerFeeRaw)).toString(); }],
    ["different principal account", input => { input.reservation.fromAccount = "commission:v3-seller"; }],
    ["different trade account", input => { input.reservation.toAccount = "trade:other-trade"; }],
    ["different wallet listing", input => { input.reservation.walletListingId = "other-listing"; }],
    ["different wallet asset", input => { input.reservation.assetId = BSC; }],
    ["different buyer evidence", input => { input.buyerRequestEvidence.buyerId = "other-buyer"; }],
    ["different platform trade", input => { input.buyerRequestEvidence.tradeId = "other-platform-trade"; }],
    ["different retained request", input => { input.buyerRequestEvidence.requestId = "other-request"; }],
    ["different retained request digest", input => { input.buyerRequestEvidence.requestDigest = "e".repeat(64); }],
    ["different seller action", input => { input.sellerAction.requestedByUserId = BUYER.id; }],
    ["self trade", input => { input.terms.buyerId = SELLER.id; input.buyerRequestEvidence.buyerId = SELLER.id; }],
    ["cross network destination", input => { input.terms.destination = `sim://${BSC}/recipient/${BUYER.id}`; }],
    ["live-looking destination", input => { input.terms.destination = "TActualNetworkAddressMustNotBeUsed"; }],
    ["network alias", input => { input.terms.receivingNetwork = "BEP20"; }],
    ["missing buyer fee", input => { input.terms.buyerFeeRaw = "0"; }],
    ["missing seller fee", input => { input.terms.sellerFeeRaw = "0"; }],
    ["incorrect combined fee", input => { input.terms.totalFeeRaw = input.terms.sellerFeeRaw; }],
    ["net principal quote", input => { input.terms.principalRaw = (BigInt(input.terms.principalRaw) - BigInt(1)).toString(); }],
    ["incorrect fiat cents", input => { input.terms.fiatTotalMinor = "64639"; }],
    ["incorrect fiat amount", input => { input.terms.fiatAmount = "640.00"; }],
    ["changed locked listing price", input => { input.terms.listingPriceAtRequest = "3.21"; }],
    ["extra amount precision", input => { input.terms.usdtAmount = "200.0000001"; }],
    ["noncanonical trailing zero", input => { input.terms.usdtAmount = "200.0"; }],
    ["stale listing availability", input => { input.reservation.expectedListingAvailableRaw = "1"; input.reservation.availableForRequestRaw = "1"; }],
    ["different canonical availability", input => { input.reservation.availableForRequestRaw = "1"; }],
    ["changed wallet listing digest", input => { input.preconditions.walletListingDigest = "e".repeat(64); }],
    ["invented frozen-price flag", input => { input.pricing.requiresFrozenPriceTransition = true; }],
    ["different retained wallet price", input => { input.pricing.walletListingPrice = "3.2"; }],
    ["backward retained request chronology", input => { input.buyerRequestEvidence.createdAt = new Date(NOW + 10_000).toISOString(); }],
  ];
  it.each(mutations)("rejects %s with no partial financial effect", (_name, mutate) => {
    const f = fixture(), { command } = f.acceptance(); mutate(command.input); rehash(command); expectNoWrite(f, command);
  });

  it.each(["walletRevision", "walletEventHash", "walletStateDigest"] as const)("rejects stale %s even after recomputing the plan digest", field => {
    const f = fixture(), { command } = f.acceptance();
    if (field === "walletRevision") command.input.preconditions.walletRevision++;
    else command.input.preconditions[field] = "e".repeat(64);
    rehash(command); expectNoWrite(f, command);
  });

  it("requires the explicit face-to-face safety action", () => {
    const f = fixture(), { command } = f.acceptance({ method: METHODS[1] });
    command.input.sellerAction.faceToFaceSafetyAcknowledged = false; rehash(command); expectNoWrite(f, command);
  });

  it.each(["buyer_offer", "unsupported-method", "legacy-fee-policy", "legacy-calculation", "false-buyer-consent", "fourth-seller-trade", "unmapped-wallet-trade"])(
    "rejects unsupported cohort %s in the strict recorded contract", variant => {
      const f = fixture(), command = structuredClone(f.acceptance().command);
      const input = command.input as unknown as Record<string, Record<string, unknown>>;
      if (variant === "buyer_offer") input.terms!.priceMode = "buyer_offer";
      if (variant === "unsupported-method") input.terms!.paymentMethod = "Cardless ATM Withdrawal";
      if (variant === "legacy-fee-policy") input.terms!.feePolicyVersion = "legacy";
      if (variant === "legacy-calculation") input.terms!.commissionCalculationVersion = "legacy";
      if (variant === "false-buyer-consent") input.buyerRequestEvidence!.buyerSafetyAcknowledged = false;
      if (variant === "fourth-seller-trade") input.preconditions!.sellerActiveTradeCount = 3;
      if (variant === "unmapped-wallet-trade") input.preconditions!.walletSellerActiveTradeCount = 1;
      expectNoWrite(f, command);
    });

  it("requires acceptance strictly after the retained request timestamp", () => {
    const f = fixture(), { command } = f.acceptance(), at = f.checkpoint().lastCommandAtMs + 1;
    command.input.preconditions.requestUpdatedAt = new Date(at).toISOString(); rehash(command);
    expect(() => f.apply(command, at)).toThrow("must follow");
    expect(() => f.apply(command, at - 1)).toThrow("must follow");
    expect(f.apply(command, at + 1).state.trades.has(TRADE)).toBe(true);
  });

  it.each(["approved", "funded", "closed", "paused"])("refuses listing/runtime condition %s even with refreshed source digests", condition => {
    const f = fixture(), { command } = f.acceptance(), state = structuredClone(f.state);
    if (condition === "paused") state.haltReason = "synthetic hold";
    else state.listings.get(LISTING)![condition as "approved" | "funded" | "closed"] = condition === "closed";
    f.replace(state); command.input.preconditions.walletStateDigest = walletDigest(state);
    command.input.preconditions.walletListingDigest = walletDigest(state.listings.get(LISTING)); rehash(command);
    expectNoWrite(f, command);
  });

  it("rejects production or signing runtime before simulation execution", () => {
    const f = fixture(), { command } = f.acceptance(), before = walletDigest(f.state);
    vi.stubEnv("NODE_ENV", "production"); expect(() => f.apply(command)).toThrow();
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true"); expect(() => f.apply(command)).toThrow();
    expect(walletDigest(f.state)).toBe(before);
  });
});

describe("receipt, reservation and journal invariants", () => {
  it.each(["missing-binding", "missing-receipt", "duplicate-request", "extra-binding-field", "extra-receipt-field", "wrong-terms",
    "wrong-trade-digest", "wrong-receipt-buyer", "wrong-receipt-actor", "wrong-command-key", "wrong-revision", "wrong-time",
    "wrong-principal", "wrong-journal", "missing-replay", "changed-input", "unsupported-trade-progress", "orphan-receipt",
    "missing-bound-listing", "changed-bound-listing"])(
    "detects %s after acceptance", variant => {
      const f = fixture(), { command } = f.acceptance(); f.step(command);
      const state = structuredClone(f.state), binding = state.initialBindings.get(REQUEST)!, receipt = state.initialAcceptanceReceipts.get(command.input.acceptanceKey)!;
      if (variant === "missing-binding") state.initialBindings.delete(REQUEST);
      if (variant === "missing-receipt") state.initialAcceptanceReceipts.delete(receipt.acceptanceKey);
      if (variant === "duplicate-request") state.initialBindings.set("another-request", structuredClone(binding));
      if (variant === "extra-binding-field") Object.assign(binding, { authorized: true });
      if (variant === "extra-receipt-field") Object.assign(receipt, { signature: "not-a-signature" });
      if (variant === "wrong-terms") binding.terms.pricePerUsdt = "3.21";
      if (variant === "wrong-trade-digest") binding.walletTradeDigest = "e".repeat(64);
      if (variant === "wrong-receipt-buyer") receipt.buyerId = "another-buyer";
      if (variant === "wrong-receipt-actor") receipt.actorUserId = "another-seller";
      if (variant === "wrong-command-key") receipt.commandKey = JSON.stringify(["buyer", BUYER.id, "acceptInitialSellerRequest", command.requestId]);
      if (variant === "wrong-revision") receipt.commandRevision++;
      if (variant === "wrong-time") receipt.acceptedAtMs = Date.parse(receipt.input.preconditions.requestUpdatedAt);
      if (variant === "wrong-principal") receipt.principalRaw = "1";
      if (variant === "wrong-journal") state.journal.at(-1)!.operation = "missing-original-operation";
      if (variant === "missing-replay") state.idempotency.delete(`v3:${receipt.commandKey}`);
      if (variant === "changed-input") receipt.input.buyerRequestEvidence.submissionTimelineEntryId = "altered-submission";
      if (variant === "unsupported-trade-progress") state.trades.get(TRADE)!.status = "payment_reported";
      if (variant === "orphan-receipt") state.initialAcceptanceReceipts.set("e".repeat(64), { ...structuredClone(receipt), acceptanceKey: "e".repeat(64) });
      if (variant === "missing-bound-listing") state.listings.delete(LISTING);
      if (variant === "changed-bound-listing") state.listings.get(LISTING)!.price = "4.00";
      expect(() => assertV3Invariants(state)).toThrow();
      expect(() => findV3InitialAcceptanceReplay(state, command)).toThrow();
    });
});
