// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetFor, parseUnits, type AssetId } from "./amounts";
import { applyWalletCommand, parseWalletCommand, walletCommandKey, walletDigest, type WalletCommand } from "./commands";
import { walletCommand } from "./durable";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { createAlphaWalletSandbox } from "./sandbox";
import type { Actor, State } from "./types";
import { parseV2Command, v2Command, type V2Checkpoint } from "./v2-commands";
import { applyV2Command, type V2State } from "./v2-engine";
import { initialInputFromPlan, parseV3Command, v3Command } from "./v3-commands";
import { applyV3Command, assertV3Invariants, type V3State } from "./v3-engine";
import { createV3InitialAcceptanceFixture } from "./v3-fixtures";
import {
  cancellationPlannerDigest, parseV4Command, parseV4VersionedCommand, v4CancellationKey, v4Command, v4CommandKey,
  WALLET_V4_ENGINE_VERSION, type V4Command, type V4CommandOf, type V4InitialCancellationInput, type V4VersionedCommand,
} from "./v4-commands";
import {
  applyV4Command, assertV4Invariants, baseV3StateForV4, findV4InitialCancellationReplay, isV4State,
  type V4InitialCancellationReceipt, type V4State,
} from "./v4-engine";

const TRON: AssetId = "tron-sim-usdt", BSC: AssetId = "bsc-sim-binance-peg-usdt";
const SELLER: Actor = { kind: "seller", id: "v4-seller" }, BUYER: Actor = { kind: "buyer", id: "v4-buyer" };
const OPERATOR: Actor = { kind: "operator", id: "v4-operator" }, VERIFIER: Actor = { kind: "verifier", id: "v4-verifier" };
const NOW = 1_800_000_000_000, GENESIS = "0".repeat(64), LISTING = "v4-listing", TRADE = "v4-trade", REQUEST = "v4-request";
const METHODS = ["Bank Transfer", "Face-to-Face (Meet in Person)"] as const;
type Cancellation = V4CommandOf<"cancelInitialTrade">;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

/** Synthetic financial setup only. Canonical digests below confer no database or authentication authority. */
function fixture(options: { assetId?: AssetId; amount?: string; method?: typeof METHODS[number]; continue?: boolean; paused?: boolean } = {}) {
  const assetId = options.assetId ?? TRON, asset = assetFor(assetId);
  const wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => NOW });
  let head: V2Checkpoint = { revision: 0, eventHash: GENESIS, stateHash: walletDigest(wallet.snapshot()), lastCommandAtMs: NOW };
  const record = (command: V4VersionedCommand, result: unknown, state: State, at: number) => {
    const revision = head.revision + 1, commandKey = v4CommandKey(command), inputHash = walletDigest(command), resultHash = walletDigest(result), stateHash = walletDigest(state);
    head = { revision, eventHash: walletDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: head.eventHash }), stateHash, lastCommandAtMs: at };
  };
  const v1 = (command: WalletCommand) => {
    const result = applyWalletCommand(wallet, command); record(command, result, wallet.snapshot(), head.lastCommandAtMs + 1); return result;
  };
  v1(walletCommand("createListing", SELLER, "create-listing", { id: LISTING, assetId, amount: "500", price: "3.70", currency: "ILS" }));
  v1(walletCommand("approveListing", OPERATOR, "approve-listing", LISTING));
  const intent = v1(walletCommand("createDepositIntent", SELLER, "deposit-intent", { id: "v4-deposit", assetId, purpose: "principal" })) as { destination: string };
  v1(walletCommand("observeDeposit", VERIFIER, "deposit-event", { intentId: "v4-deposit", assetId, network: asset.network, token: asset.token,
    destination: intent.destination, transactionId: "sim-tx-v4-funding", eventIndex: 0, amountRaw: parseUnits("500", asset.decimals).toString(),
    blockHash: "sim-block-v4-funding", finalized: true, successful: true }));
  const v1State = wallet.snapshot();
  const continuation2 = v2Command("continueFromV1", OPERATOR, "v4-prior-v2", { checkpoint: { ...head } });
  const applied2 = applyV2Command(v1State, continuation2, { ...head, at: head.lastCommandAtMs + 1 });
  record(continuation2, applied2.result, applied2.state, head.lastCommandAtMs + 1);
  const v2State = structuredClone(applied2.state);
  const continuation3 = v3Command("continueFromV2", OPERATOR, "v4-prior-v3", { checkpoint: { ...head } });
  const applied3 = applyV3Command(applied2.state, continuation3, { ...head, at: head.lastCommandAtMs + 1 });
  record(continuation3, applied3.result, applied3.state, head.lastCommandAtMs + 1);
  const facts = createV3InitialAcceptanceFixture({ mode: "simulation-only", state: applied3.state, walletRevision: head.revision,
    walletEventHash: head.eventHash, atMs: head.lastCommandAtMs + 1, walletListingId: LISTING, walletTradeId: TRADE,
    platformRequestId: REQUEST, platformTradeId: "v4-platform-trade", buyerId: BUYER.id, amount: options.amount ?? "200",
    retainedPrice: "3.10", paymentMethod: options.method });
  const accepted = v3Command("acceptInitialSellerRequest", SELLER, "v4-prior-acceptance", initialInputFromPlan(facts.plan));
  const reserved = applyV3Command(applied3.state, accepted, { ...head, at: head.lastCommandAtMs + 1 });
  record(accepted, reserved.result, reserved.state, head.lastCommandAtMs + 1);
  let state: V3State | V4State = reserved.state;
  if (options.paused) {
    const pause = v3Command("pause", OPERATOR, "v4-source-pause", null);
    const applied = applyV3Command(state, pause, { ...head, at: head.lastCommandAtMs + 1 });
    state = applied.state; record(pause, applied.result, state, head.lastCommandAtMs + 1);
  }
  const source = structuredClone(state), sourceHead = { ...head };
  const checkpoint = () => ({ ...head, stateHash: walletDigest(state) });
  const step = (command: V4Command) => {
    const before = walletDigest(state), at = head.lastCommandAtMs + 1;
    const applied = applyV4Command(state, command, { ...checkpoint(), at });
    state = applied.state;
    if (walletDigest(state) !== before) record(command, applied.result, state, at);
    return applied.result;
  };
  const continuation = v4Command("continueFromV3", OPERATOR, "v4-upgrade", { checkpoint: sourceHead });
  if (options.continue !== false) step(continuation);
  const cancellation = (actor = BUYER): Cancellation => {
    const binding = state.initialBindings.get(REQUEST)!, original = state.initialAcceptanceReceipts.get(binding.acceptanceKey)!;
    const cancelledAtMs = head.lastCommandAtMs + 1, terms = structuredClone(binding.terms);
    const input: V4InitialCancellationInput = {
      cancellationKey: v4CancellationKey(REQUEST, binding.acceptanceKey), terms, termsDigest: binding.termsDigest,
      originalAcceptance: { acceptanceKey: binding.acceptanceKey, commandRevision: original.commandRevision, commandKey: original.commandKey,
        receiptDigest: walletDigest(original), bindingDigest: walletDigest(binding) }, cancelledAtMs,
      preconditions: { requestUpdatedAt: new Date(original.acceptedAtMs).toISOString(), requestDigest: walletDigest({ requestId: REQUEST, status: "accepted" }),
        listingDigest: walletDigest({ listingId: terms.platformListingId, lock: REQUEST }), tradeDigest: walletDigest({ tradeId: terms.platformTradeId, status: "accepted" }),
        marketplaceDigest: walletDigest({ fixture: "synthetic-canonical-prepayment" }), listingExpiresAt: new Date(cancelledAtMs + 60_000).toISOString(),
        canonicalPrepayment: true, canonicalTermsUnchanged: true, buyerBankDetailsDisclosed: false,
        walletRevision: head.revision, walletEventHash: head.eventHash, walletStateDigest: walletDigest(state),
        walletTradeDigest: walletDigest(state.trades.get(TRADE)), walletListingDigest: walletDigest(state.listings.get(LISTING)) },
      principalReturn: { action: "return_to_listing", assetId, walletListingId: LISTING, walletTradeId: TRADE,
        principalRaw: terms.principalRaw, transferAmountRaw: terms.principalRaw, fromAccount: `trade:${TRADE}`, toAccount: `listing:${LISTING}`,
        expectedListingAvailableRaw: balance(state, assetId, `listing:${LISTING}`).toString(), expectedTradeReservedRaw: terms.principalRaw }, plannerInputDigest: GENESIS,
    };
    input.plannerInputDigest = cancellationPlannerDigest(input, actor.id);
    return v4Command("cancelInitialTrade", actor, "v4-cancellation", input);
  };
  return { get state() { return state as V4State; }, source, sourceHead, v1State, v2State, assetId, asset, continuation, checkpoint, cancellation, step,
    apply(command: V4Command, at = head.lastCommandAtMs + 1) { return applyV4Command(state, command, { ...checkpoint(), at }); },
    replace(next: V4State) { state = next; } };
}
function rehash(command: Cancellation) {
  command.input.termsDigest = walletDigest(command.input.terms);
  command.input.plannerInputDigest = cancellationPlannerDigest(command.input, command.actor.id);
}
function expectNoWrite(f: ReturnType<typeof fixture>, command: V4Command) {
  const before = walletDigest(f.state); expect(() => f.apply(command)).toThrow(); expect(walletDigest(f.state)).toBe(before);
}

describe("closed v4 cancellation protocol", () => {
  it("preserves the global transport identity and all old parsers", () => {
    const commands = [walletCommand("pause", OPERATOR, "same", null), v2Command("pause", OPERATOR, "same", null),
      v3Command("pause", OPERATOR, "same", null), v4Command("pause", OPERATOR, "same", null)];
    for (const command of commands) {
      expect(parseV4VersionedCommand(command)).toEqual(command); expect(v4CommandKey(command)).toBe(walletCommandKey(commands[0]! as WalletCommand));
    }
    for (const parse of [parseWalletCommand, parseV2Command, parseV3Command]) expect(() => parse(commands[3])).toThrow();
    expect(new Set(commands.map(walletDigest)).size).toBe(4);
  });
  it.each(["acceptInitialSellerRequest", "reserveTrade", "acceptAmountCorrection", "markBuyerPaid", "verifyPayment", "queueRelease", "cancelTrade",
    "closeListing", "requestWithdrawal", "beginDispatch", "recordSubmission", "confirmPayout", "resume"])("rejects unsupported operation %s", type => {
    expect(() => parseV4Command({ ...v4Command("pause", OPERATOR, "unsupported", null), type })).toThrow();
  });
  it.each(["outer", "actor", "input", "terms", "originalAcceptance", "preconditions", "principalReturn"])("refuses unknown/private %s fields", field => {
    const command = fixture().cancellation() as unknown as Record<string, unknown>;
    const target = field === "outer" ? command : field === "actor" ? command.actor : field === "input" ? command.input : (command.input as Record<string, unknown>)[field];
    (target as Record<string, unknown>).bankAccountNumber = "private-instructions";
    expect(() => parseV4Command(command)).toThrow();
  });
  it.each([0, 1, 2, 3, "4", null, undefined])("rejects malformed envelope version %s", version => {
    expect(() => parseV4Command({ ...v4Command("pause", OPERATOR, "wrong", null), version })).toThrow();
  });
  it.each(["requestUpdatedAt", "listingExpiresAt"] as const)("requires millisecond precision for %s and accepts explicit timezone offsets", key => {
    const command = fixture().cancellation(), original = command.input.preconditions[key]!;
    for (const replacement of ["Z", ".01Z", ".0001Z", ".0000001Z"]) {
      const changed = structuredClone(command); changed.input.preconditions[key] = original.replace(/\.\d{3}Z$/, replacement);
      expect(() => parseV4Command(changed)).toThrow();
    }
    command.input.preconditions[key] = original.replace(/Z$/, "+00:00");
    expect(parseV4Command(command)).toEqual(command);
  });
});

describe("frozen v3 to v4 continuation", () => {
  it("retains the complete original state without duplicated snapshots or accounting effects", () => {
    const f = fixture(); expect(isV4State(f.state)).toBe(true); expect(f.state.engineVersion).toBe(WALLET_V4_ENGINE_VERSION);
    expect(f.state.cancellationContinuation).toEqual({ checkpoint: f.sourceHead, commandRevision: f.sourceHead.revision + 1,
      commandKey: v4CommandKey(f.continuation), sourceHaltReason: null });
    expect(f.state.journal).toEqual(f.source.journal); expect(f.state.initialCancellationReceipts.size).toBe(0);
    expect(baseV3StateForV4(f.state)).toEqual(f.source); expect(walletDigest(baseV3StateForV4(f.state))).toBe(f.sourceHead.stateHash);
    const detached = baseV3StateForV4(f.state); detached.trades.get(TRADE)!.status = "cancelled";
    expect(f.state.trades.get(TRADE)!.status).toBe("reserved");
  });
  it.each(["revision", "eventHash", "stateHash", "lastCommandAtMs"] as const)("rejects changed source %s", field => {
    const f = fixture({ continue: false }), command = structuredClone(f.continuation);
    if (field === "revision" || field === "lastCommandAtMs") command.input.checkpoint[field]++;
    else command.input.checkpoint[field] = "e".repeat(64);
    expectNoWrite(f, command);
  });
  it.each(["buyer", "seller", "verifier", "dispatcher"] as const)("refuses %s continuation authority", kind => {
    const f = fixture({ continue: false }); expectNoWrite(f, { ...f.continuation, actor: { kind, id: OPERATOR.id } });
  });
  it("rejects skipped versions, implicit continuation, unknown metadata and a second continuation identity", () => {
    const f = fixture({ continue: false });
    for (const state of [f.v1State, f.v2State, { ...f.source, futurePermit: true }] as Array<State | V2State | V3State>) {
      expect(() => applyV4Command(state, f.continuation, { ...f.sourceHead, stateHash: walletDigest(state), at: NOW + 100 })).toThrow();
    }
    expectNoWrite(f, v4Command("pause", OPERATOR, "implicit", null));
    f.step(f.continuation); const before = walletDigest(f.state);
    expect(f.apply(f.continuation).result).toEqual(f.state.cancellationContinuation); expect(walletDigest(f.state)).toBe(before);
    expectNoWrite(f, { ...f.continuation, requestId: "second-upgrade" });
  });
  it("preserves a paused source and reconstructs it across subsequent pause commands", () => {
    const f = fixture({ paused: true }); expect(f.state.haltReason).toBe(f.source.haltReason); expectNoWrite(f, f.cancellation());
    f.step(v4Command("pause", OPERATOR, "pause-again", null)); f.step(v4Command("pause", OPERATOR, "pause-again-again", null));
    expect(baseV3StateForV4(f.state)).toEqual(f.source); assertV4Invariants(f.state);
  });
  it("refuses an empty source halt reason consistently with the new storage contract", () => {
    const f = fixture({ continue: false }), source = structuredClone(f.source); source.haltReason = "";
    const checkpoint = { ...f.sourceHead, stateHash: walletDigest(source) };
    const command = v4Command("continueFromV3", OPERATOR, "empty-halt-reason", { checkpoint });
    expect(() => applyV4Command(source, command, { ...checkpoint, at: checkpoint.lastCommandAtMs + 1 })).toThrow("continuation checkpoint");
  });
});

describe("initial principal cancellation", () => {
  it.each([TRON, BSC].flatMap(assetId => METHODS.flatMap(method => [BUYER, SELLER].flatMap(actor => ["1.00005", "500"].map(amount => ({ assetId, method, actor, amount }))))))(
    "returns only principal for $assetId / $method / $actor.kind / $amount", options => {
      const f = fixture(options), before = structuredClone(f.state), command = f.cancellation(options.actor), custody = expectedCustody(before, f.assetId);
      const receipt = f.step(command) as V4InitialCancellationReceipt, principal = parseUnits(options.amount, f.asset.decimals);
      expect(receipt).toMatchObject({ actorKind: options.actor.kind, actorUserId: options.actor.id, principalRaw: principal.toString(), transferAmountRaw: principal.toString(),
        acceptanceKey: command.input.originalAcceptance.acceptanceKey, commandRevision: command.input.preconditions.walletRevision + 1 });
      expect(balance(f.state, f.assetId, `trade:${TRADE}`)).toBe(BigInt(0));
      expect(balance(f.state, f.assetId, `listing:${LISTING}`)).toBe(parseUnits("500", f.asset.decimals));
      expect(expectedCustody(f.state, f.assetId)).toBe(custody);
      expect(f.state.trades.get(TRADE)).toEqual({ ...before.trades.get(TRADE), status: "cancelled" });
      expect(f.state.listings).toEqual(before.listings); expect(f.state.payouts).toEqual(before.payouts); expect(f.state.commissions).toEqual(before.commissions);
      expect(f.state.initialBindings).toEqual(before.initialBindings); expect(f.state.initialAcceptanceReceipts).toEqual(before.initialAcceptanceReceipts);
      expect(f.state.journal.slice(0, -1)).toEqual(before.journal);
      expect(f.state.journal.at(-1)).toEqual({ id: `journal-${before.journal.length + 1}`, operation: `v4:${v4CommandKey(command)}`, assetId: f.assetId,
        entries: [{ account: `trade:${TRADE}`, delta: -principal }, { account: `listing:${LISTING}`, delta: principal }] });
      expect(baseV3StateForV4(f.state)).toEqual(f.source); assertV3Invariants(baseV3StateForV4(f.state)); assertLedgerInvariants(f.state); assertV4Invariants(f.state);
    });
  it.each(["operator", "verifier", "dispatcher", "seller", "buyer"] as const)("rejects unrecorded %s identity", kind => {
    const f = fixture(), command = f.cancellation(); command.actor = { kind, id: "unrelated-person" }; rehash(command); expectNoWrite(f, command);
  });
  it("rejects a correct participant ID under the other participant role", () => {
    const f = fixture(), command = f.cancellation(); command.actor = { kind: "seller", id: BUYER.id }; rehash(command); expectNoWrite(f, command);
  });
  it.each([
    (input: V4InitialCancellationInput) => { input.principalReturn.assetId = BSC; },
    (input: V4InitialCancellationInput) => { input.principalReturn.walletListingId = "other-listing"; },
    (input: V4InitialCancellationInput) => { input.principalReturn.walletTradeId = "other-trade"; },
    (input: V4InitialCancellationInput) => { input.principalReturn.toAccount = "available:unrelated-person"; },
    (input: V4InitialCancellationInput) => { input.principalReturn.fromAccount = "trade:other-trade"; },
    (input: V4InitialCancellationInput) => { input.principalReturn.principalRaw = "199000000"; },
    (input: V4InitialCancellationInput) => { input.principalReturn.transferAmountRaw = "198000000"; },
    (input: V4InitialCancellationInput) => { input.principalReturn.expectedTradeReservedRaw = "0"; },
    (input: V4InitialCancellationInput) => { input.principalReturn.expectedListingAvailableRaw = "0"; },
    (input: V4InitialCancellationInput) => { input.terms.usdtAmount = "199"; },
    (input: V4InitialCancellationInput) => { input.terms.pricePerUsdt = "3.70"; },
    (input: V4InitialCancellationInput) => { input.terms.platformRequestId = "different-request"; },
  ])("rejects a changed financial basis even after rehashing the plan %#", mutate => {
    const f = fixture(), command = f.cancellation(); mutate(command.input); rehash(command); expectNoWrite(f, command);
  });
  it.each(["acceptanceKey", "commandKey", "commandRevision", "receiptDigest", "bindingDigest"] as const)("rejects changed original acceptance %s", key => {
    const f = fixture(), command = f.cancellation();
    if (key === "commandRevision") command.input.originalAcceptance[key]++;
    else command.input.originalAcceptance[key] = "a".repeat(64);
    rehash(command); expectNoWrite(f, command);
  });
  it.each(["walletRevision", "walletEventHash", "walletStateDigest", "walletTradeDigest", "walletListingDigest"] as const)("rejects stale current wallet %s", key => {
    const f = fixture(), command = f.cancellation();
    if (key === "walletRevision") command.input.preconditions[key]++;
    else command.input.preconditions[key] = "f".repeat(64);
    rehash(command); expectNoWrite(f, command);
  });
  it("keeps bank disclosure actor-specific and refuses unsupported Face-to-Face disclosure", () => {
    const buyer = fixture(), buyerCommand = buyer.cancellation(); buyerCommand.input.preconditions.buyerBankDetailsDisclosed = true; rehash(buyerCommand); expectNoWrite(buyer, buyerCommand);
    const seller = fixture(), sellerCommand = seller.cancellation(SELLER); sellerCommand.input.preconditions.buyerBankDetailsDisclosed = true; rehash(sellerCommand);
    expect(() => seller.step(sellerCommand)).not.toThrow();
    const cash = fixture({ method: METHODS[1] }), cashCommand = cash.cancellation(SELLER); cashCommand.input.preconditions.buyerBankDetailsDisclosed = true; rehash(cashCommand); expectNoWrite(cash, cashCommand);
  });
  it("allows absent expiry and rejects expiry at or before the decision without sweeping the listing", () => {
    const f = fixture(), command = f.cancellation(); command.input.preconditions.listingExpiresAt = null; rehash(command); f.step(command);
    for (const offset of [0, -1]) {
      const expired = fixture(), attempted = expired.cancellation(); attempted.input.preconditions.listingExpiresAt = new Date(attempted.input.cancelledAtMs + offset).toISOString();
      rehash(attempted); expectNoWrite(expired, attempted);
    }
  });
  it.each(["canonicalPrepayment", "canonicalTermsUnchanged"] as const)("requires the explicit recorded %s assertion", key => {
    const command = fixture().cancellation(); Object.assign(command.input.preconditions, { [key]: false }); expect(() => parseV4Command(command)).toThrow();
  });
  it("requires a current decision clock after the original acceptance and canonical request update", () => {
    for (const change of ["stale-update", "equal-update", "wrong-command-time"]) {
      const f = fixture(), command = f.cancellation();
      if (change === "stale-update") command.input.preconditions.requestUpdatedAt = new Date(f.sourceHead.lastCommandAtMs - 1).toISOString();
      else if (change === "equal-update") command.input.preconditions.requestUpdatedAt = new Date(command.input.cancelledAtMs).toISOString();
      else command.input.cancelledAtMs++;
      rehash(command); expectNoWrite(f, command);
    }
  });
  it("recovers the exact first receipt after transport changes and pause without a second effect", () => {
    const f = fixture(), command = f.cancellation(), receipt = f.step(command);
    f.step(v4Command("pause", OPERATOR, "after-cancellation", null)); const before = walletDigest(f.state), count = f.state.journal.length;
    const retry = { ...command, requestId: "retry-transport" }; expect(f.apply(retry).result).toEqual(receipt);
    expect(findV4InitialCancellationReplay(f.state, retry)).toEqual(receipt); expect(walletDigest(f.state)).toBe(before); expect(f.state.journal).toHaveLength(count);
    expect(baseV3StateForV4(f.state)).toEqual(f.source);
    const changed = structuredClone(command); changed.actor = SELLER; rehash(changed); expectNoWrite(f, changed);
    const changedPayload = structuredClone(command); changedPayload.input.preconditions.marketplaceDigest = "d".repeat(64); rehash(changedPayload); expectNoWrite(f, changedPayload);
  });
  it("does not grant a new cancellation after pause or a retry identity to a different input", () => {
    const f = fixture(); f.step(v4Command("pause", OPERATOR, "before-cancellation", null)); expectNoWrite(f, f.cancellation());
    const g = fixture(), command = g.cancellation(); g.step(command);
    command.input.cancellationKey = "a".repeat(64); rehash(command); expectNoWrite(g, command);
  });
  it("returns detached state and receipt evidence", () => {
    const f = fixture(), command = f.cancellation(), before = walletDigest(f.state), applied = f.apply(command);
    const receipt = applied.result as V4InitialCancellationReceipt; receipt.input.terms.usdtAmount = "1"; command.input.terms.usdtAmount = "2";
    expect(applied.state.initialCancellationReceipts.values().next().value?.input.terms.usdtAmount).toBe("200");
    expect(walletDigest(f.state)).toBe(before);
  });
});

describe("v4 source and terminal-state integrity", () => {
  it.each([
    (state: V4State) => { state.trades.get(TRADE)!.status = "payment_reported"; },
    (state: V4State) => { state.trades.get(TRADE)!.disputed = true; },
    (state: V4State) => { state.trades.get(TRADE)!.evidence = { reference: "payment", amountMinor: "1", currency: "ILS", kind: "simulated-bank-credit" }; },
    (state: V4State) => { state.trades.get(TRADE)!.authorization = { sellerId: SELLER.id, destination: "other", amountRaw: BigInt(1), evidenceReference: "evidence" }; },
    (state: V4State) => { state.trades.get(TRADE)!.payoutId = "new-payout"; },
    (state: V4State) => { state.listings.get(LISTING)!.price = "3.10"; },
    (state: V4State) => { state.listings.get(LISTING)!.closed = true; },
    (state: V4State) => { state.evidenceOwners.set("new-evidence", TRADE); },
    (state: V4State) => { state.receipts.set("new-private-receipt", "new-claim"); },
    (state: V4State) => { state.reconciliations.set(TRON, { expectedRaw: BigInt(1), at: NOW }); },
    (state: V4State) => { state.gasReady.add(BSC); },
    (state: V4State) => { state.initialBindings.get(REQUEST)!.acceptedAtMs++; },
    (state: V4State) => { state.initialAcceptanceReceipts.values().next().value!.principalRaw = "1"; },
    (state: V4State) => { state.cancellationContinuation.sourceHaltReason = "mutated-source"; },
    (state: V4State) => { Object.assign(state, { unsupportedLifecycle: true }); },
  ])("rejects mutation of frozen source or prepayment state %#", mutate => {
    const f = fixture(), command = f.cancellation(), changed = structuredClone(f.state); mutate(changed); f.replace(changed);
    expect(() => assertV4Invariants(changed)).toThrow(); expectNoWrite(f, command);
  });
  it.each([
    (state: V4State) => { state.initialCancellationReceipts.clear(); },
    (state: V4State) => { state.initialCancellationReceipts.values().next().value!.listingAvailableAfterRaw = "1"; },
    (state: V4State) => { state.initialCancellationReceipts.values().next().value!.commandRevision++; },
    (state: V4State) => { state.initialCancellationReceipts.values().next().value!.input.preconditions.walletStateDigest = "f".repeat(64); },
    (state: V4State) => { state.journal.at(-1)!.operation = "v4:forged"; },
    (state: V4State) => { state.journal.at(-1)!.id = "journal-999"; },
    (state: V4State) => { state.journal.at(-1)!.entries.reverse(); },
    (state: V4State) => { state.trades.get(TRADE)!.status = "reserved"; },
    (state: V4State) => { state.idempotency.delete(`v4:${state.initialCancellationReceipts.values().next().value!.commandKey}`); },
    (state: V4State) => { state.haltReason = "Operator emergency pause"; },
  ])("rejects changed cancellation receipt, journal, status or command suffix %#", mutate => {
    const f = fixture(); f.step(f.cancellation()); const changed = structuredClone(f.state); mutate(changed); expect(() => assertV4Invariants(changed)).toThrow();
  });
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects an invalid command clock %s", at => {
    const f = fixture(), before = walletDigest(f.state); expect(() => f.apply(f.cancellation(), at)).toThrow(); expect(walletDigest(f.state)).toBe(before);
  });
  it("rejects a supplied current revision inconsistent with the exact v4 command suffix", () => {
    const f = fixture(), checkpoint = f.checkpoint();
    expect(() => applyV4Command(f.state, f.cancellation(), { ...checkpoint, revision: checkpoint.revision + 1, at: checkpoint.lastCommandAtMs + 1 })).toThrow("revision");
  });
  it("reconstructs the real prior state even if a forged receipt and its retry hashes agree with each other", () => {
    const f = fixture(); f.step(f.cancellation()); const changed = structuredClone(f.state);
    const receipt = changed.initialCancellationReceipts.values().next().value!;
    receipt.input.preconditions.walletStateDigest = "e".repeat(64);
    receipt.input.plannerInputDigest = cancellationPlannerDigest(receipt.input, receipt.actorUserId);
    receipt.plannerInputDigest = receipt.input.plannerInputDigest;
    receipt.inputDigest = walletDigest({ actor: { kind: receipt.actorKind, id: receipt.actorUserId }, input: receipt.input });
    changed.idempotency.set(`v4:${receipt.commandKey}`, { fingerprint: walletDigest(receipt.input), result: structuredClone(receipt) });
    expect(() => assertV4Invariants(changed)).toThrow("exact prior wallet state");
  });
  it("keeps the runtime simulation gate on every new financial operation", () => {
    const f = fixture(), command = f.cancellation(); vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true"); expectNoWrite(f, command);
  });
});
