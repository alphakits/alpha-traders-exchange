// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER, OPERATOR, SELLER } from "../../../scripts/alpha-wallet/durable-fixtures";
import { V3_FIXTURE_LISTING, V3_FIXTURE_TRADE } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { createV5EngineFixture } from "../../../scripts/alpha-wallet/v5-engine-fixtures";
import { v5FixtureClaimInput, v5FixtureDisputeInput } from "../../../scripts/alpha-wallet/v5-durable-fixtures";
import { parseWalletCommand, walletDigest } from "./commands";
import { assertLedgerInvariants, balance, transfer } from "./ledger";
import { parseV2Command } from "./v2-commands";
import { parseV3Command } from "./v3-commands";
import { parseV4Command, v4Command } from "./v4-commands";
import { assertV4Invariants } from "./v4-engine";
import { disputeFreezePlannerDigest, parseV5Command, paymentClaimPlannerDigest, v5Command, v5CommandKey,
  type V5Command, type V5InitialDisputeFreezeInput, type V5InitialPaymentClaimInput } from "./v5-commands";
import { assertV5Invariants, baseV4StateForV5, findV5LifecycleReplay, type V5State } from "./v5-engine";
import { verifyV5History } from "./v5-durable";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
});
afterEach(() => vi.unstubAllEnvs());
type Fixture = ReturnType<typeof createV5EngineFixture>;
function claim(f: Fixture) { return v5Command("claimInitialPayment", BUYER, "buyer-claim", v5FixtureClaimInput(f.snapshot(), f.at + 1)); }
function dispute(f: Fixture) { return v5Command("freezeInitialDispute", BUYER, "buyer-dispute", v5FixtureDisputeInput(f.snapshot(), f.at + 1)); }
function refuses(f: Fixture, command: V5Command) { const before = walletDigest(f.state); expect(() => f.apply(command)).toThrow(); expect(walletDigest(f.state)).toBe(before); }

describe("V5 closed buyer claim protocol", () => {
  it("adds a new strict envelope while preserving global transport identity and old parsers", () => {
    const old = v4Command("pause", OPERATOR, "same-identity", null), next = v5Command("pause", OPERATOR, "same-identity", null);
    expect(v5CommandKey(old)).toBe(v5CommandKey(next)); expect(walletDigest(old)).not.toBe(walletDigest(next));
    for (const parse of [parseWalletCommand, parseV2Command, parseV3Command, parseV4Command]) expect(() => parse(next)).toThrow();
  });
  it.each(["cancelInitialTrade", "markBuyerPaid", "verifyPayment", "authorizeRelease", "queueRelease", "openDispute", "requestWithdrawal", "beginDispatch", "recordSubmission", "confirmPayout", "resolveDispute", "resume"])(
    "rejects unsupported fresh action %s", type => expect(() => parseV5Command({ ...v5Command("pause", OPERATOR, "unsupported", null), type })).toThrow());
  it.each(["outer", "actor", "input", "terms", "preconditions", "claim", "proof", "principalHold", "originalAcceptance"])(
    "rejects unknown/private %s fields", field => {
      const command = claim(createV5EngineFixture());
      const targets: Record<string, object> = { outer: command, actor: command.actor, input: command.input,
        terms: command.input.terms, preconditions: command.input.preconditions, claim: command.input.claim,
        proof: command.input.claim.proof!, principalHold: command.input.principalHold, originalAcceptance: command.input.originalAcceptance };
      Object.assign(targets[field]!, { bankAccountNumber: "private" }); expect(() => parseV5Command(command)).toThrow();
    });
});

describe("V5 exact predecessor continuation", () => {
  it("retains original V4 metadata, accounting and exact source hash", () => {
    const f = createV5EngineFixture();
    expect(baseV4StateForV5(f.state)).toEqual(f.source); expect(walletDigest(baseV4StateForV5(f.state))).toBe(f.sourceHead.stateHash);
    expect(f.state.journal).toEqual(f.source.journal); expect(f.state.initialCancellationReceipts).toEqual(f.source.initialCancellationReceipts);
    expect(f.state.paymentContinuation).toMatchObject({ checkpoint: f.sourceHead, sourceHaltReason: null });
    expect(f.state.initialPaymentClaimReceipts.size).toBe(0); expect(f.state.initialDisputeFreezeReceipts.size).toBe(0);
  });
  it.each(["revision", "eventHash", "stateHash", "lastCommandAtMs"] as const)("rejects changed source checkpoint %s", field => {
    const f = createV5EngineFixture({ continue: false }), command = structuredClone(f.continuation);
    if (field === "revision" || field === "lastCommandAtMs") command.input.checkpoint[field]++; else command.input.checkpoint[field] = "f".repeat(64);
    refuses(f, command);
  });
  it.each(["buyer", "seller", "verifier", "dispatcher"] as const)("rejects %s continuation or pause authority", kind => {
    const f = createV5EngineFixture({ continue: false }); refuses(f, { ...f.continuation, actor: { kind, id: OPERATOR.id } });
    f.step(f.continuation); refuses(f, v5Command("pause", { kind, id: OPERATOR.id }, "not-operator", null));
  });
  it("preserves inherited pauses, never resumes and permits exact continuation recovery", () => {
    const f = createV5EngineFixture({ sourcePaused: true });
    expect(f.state.haltReason).toBe("Operator emergency pause"); refuses(f, claim(f));
    f.step(v5Command("pause", OPERATOR, "pause-again", null));
    expect(baseV4StateForV5(f.state)).toEqual(f.source); expect(f.apply(f.continuation).result).toEqual(f.state.paymentContinuation);
    refuses(f, { ...f.continuation, requestId: "second-continuation" });
  });
});

describe("V5 claim and dispute reserve all principal", () => {
  it.each((["tron-sim-usdt", "bsc-sim-binance-peg-usdt"] as const).flatMap(assetId =>
    (["Bank Transfer", "Face-to-Face (Meet in Person)"] as const).flatMap(method => ["1.00005", "500"].map(amount => ({ assetId, method, amount })))))
    ("claims then freezes $amount $assetId via $method without moving principal", ({ assetId, method, amount }) => {
      const f = createV5EngineFixture({ assetId, method, amount }), original = structuredClone(f.state);
      const command = claim(f), receipt = f.step(command);
      expect(f.state.trades.get(V3_FIXTURE_TRADE)).toMatchObject({ status: "payment_reported", disputed: false });
      expect(f.state.trades.get(V3_FIXTURE_TRADE)!.evidence).toBeUndefined();
      const freeze = dispute(f), frozen = f.step(freeze);
      expect(f.state.trades.get(V3_FIXTURE_TRADE)).toMatchObject({ status: "payment_reported", disputed: true });
      expect(receipt).toMatchObject({ principalRaw: command.input.terms.principalRaw, transferAmountRaw: "0" });
      expect(frozen).toMatchObject({ claimKey: command.input.claimKey, transferAmountRaw: "0" });
      for (const key of ["accounts", "journal", "payouts", "commissions", "evidenceOwners", "receipts", "initialBindings", "initialAcceptanceReceipts", "initialCancellationReceipts"] as const) expect(f.state[key], key).toEqual(original[key]);
      expect(balance(f.state, assetId, `trade:${V3_FIXTURE_TRADE}`)).toBe(BigInt(command.input.terms.principalRaw));
      expect(baseV4StateForV5(f.state)).toEqual(f.source); assertLedgerInvariants(f.state); assertV5Invariants(f.state);
      expect(verifyV5History(f.records).state).toEqual(f.state);
    });
  it.each(["seller", "operator", "verifier", "dispatcher"] as const)("refuses %s buyer-claim and postclaim dispute authority", kind => {
    const f = createV5EngineFixture(), command = claim(f); refuses(f, { ...command, actor: { kind, id: BUYER.id } });
    f.step(command); refuses(f, { ...dispute(f), actor: { kind, id: BUYER.id } });
  });
  it("rejects an unrelated buyer despite matching role and rehashed planner evidence", () => {
    const f = createV5EngineFixture(), command = claim(f); command.actor.id = "other-buyer";
    command.input.claim.buyerId = command.actor.id; command.input.plannerInputDigest = paymentClaimPlannerDigest(command.input, command.actor.id);
    refuses(f, command);
  });
  it.each([
    (i: V5InitialPaymentClaimInput) => { i.claim.amountMinor = (BigInt(i.claim.amountMinor) - BigInt(1)).toString(); },
    (i: V5InitialPaymentClaimInput) => { i.claim.proof = null; },
    (i: V5InitialPaymentClaimInput) => { i.principalHold.expectedTradeReservedRaw = "0"; },
    (i: V5InitialPaymentClaimInput) => { i.principalHold.expectedListingAvailableRaw = "0"; },
    (i: V5InitialPaymentClaimInput) => { i.originalAcceptance.receiptDigest = "f".repeat(64); },
    (i: V5InitialPaymentClaimInput) => { i.originalAcceptance.bindingDigest = "f".repeat(64); },
    (i: V5InitialPaymentClaimInput) => { i.preconditions.walletStateDigest = "f".repeat(64); },
    (i: V5InitialPaymentClaimInput) => { i.preconditions.walletEventHash = "f".repeat(64); },
    (i: V5InitialPaymentClaimInput) => { i.preconditions.walletTradeDigest = "f".repeat(64); },
    (i: V5InitialPaymentClaimInput) => { i.preconditions.walletListingDigest = "f".repeat(64); },
    (i: V5InitialPaymentClaimInput) => { i.preconditions.canonicalStatus = "payment_sent"; },
    (i: V5InitialPaymentClaimInput) => { i.claimKey = "f".repeat(64); },
    (i: V5InitialPaymentClaimInput) => { i.claimedAtMs--; },
    (i: V5InitialPaymentClaimInput) => { i.preconditions.requestUpdatedAt = new Date(i.claimedAtMs).toISOString(); },
    (i: V5InitialPaymentClaimInput) => { i.terms.principalRaw = "1"; i.termsDigest = walletDigest(i.terms); },
  ])("rejects changed claim terms/basis/evidence without a partial write %#", mutate => {
    const f = createV5EngineFixture(), command = claim(f); mutate(command.input);
    command.input.plannerInputDigest = paymentClaimPlannerDigest(command.input, command.actor.id); refuses(f, command);
  });
  it("forbids proof on a cash claim and zero or oversized bank proof references", () => {
    const bank = claim(createV5EngineFixture()), cash = createV5EngineFixture({ method: "Face-to-Face (Meet in Person)" }), command = claim(cash);
    command.input.claim.proof = bank.input.claim.proof; command.input.plannerInputDigest = paymentClaimPlannerDigest(command.input, BUYER.id); refuses(cash, command);
    for (const sizeBytes of [0, 8388609, 1.5]) expect(() => parseV5Command({ ...bank, input: { ...bank.input, claim: { ...bank.input.claim, proof: { ...bank.input.claim.proof, sizeBytes } } } })).toThrow();
  });
  it("permits dispute only after the exact buyer claim", () => {
    const f = createV5EngineFixture(), claimed = claim(f); f.step(claimed); const freeze = dispute(f);
    const source = createV5EngineFixture(); refuses(source, freeze);
    f.step(freeze); refuses(f, { ...freeze, requestId: "changed-reason", input: { ...freeze.input, reasonDigest: "f".repeat(64) } });
    expect(f.state.initialPaymentClaimReceipts.size).toBe(1); expect(f.state.initialDisputeFreezeReceipts.size).toBe(1);
  });
  it.each([
    (i: V5InitialDisputeFreezeInput) => { i.priorClaim.claimKey = "f".repeat(64); },
    (i: V5InitialDisputeFreezeInput) => { i.priorClaim.commandRevision++; },
    (i: V5InitialDisputeFreezeInput) => { i.priorClaim.receiptDigest = "f".repeat(64); },
    (i: V5InitialDisputeFreezeInput) => { i.preconditions.canonicalStatus = "accepted"; },
    (i: V5InitialDisputeFreezeInput) => { i.disputedAtMs--; },
  ])("rejects rebound or stale dispute evidence %#", mutate => {
    const f = createV5EngineFixture(); f.step(claim(f)); const command = dispute(f); mutate(command.input);
    command.input.plannerInputDigest = disputeFreezePlannerDigest(command.input, BUYER.id); refuses(f, command);
  });
  it("recovers identical business receipts across transport ids and after dispute/pause without another command", () => {
    const f = createV5EngineFixture(), command = claim(f), receipt = f.step(command), freeze = dispute(f), frozen = f.step(freeze);
    f.step(v5Command("pause", OPERATOR, "pause", null)); const before = walletDigest(f.state);
    expect(f.apply({ ...command, requestId: "new-claim-transport" }).result).toEqual(receipt);
    expect(f.apply({ ...freeze, requestId: "new-freeze-transport" }).result).toEqual(frozen);
    expect(findV5LifecycleReplay(f.state, command)).toEqual(receipt); expect(walletDigest(f.state)).toBe(before);
    refuses(f, { ...command, actor: SELLER });
    const altered = structuredClone(command); altered.input.claim.proof!.contentSha256 = "e".repeat(64);
    altered.input.plannerInputDigest = paymentClaimPlannerDigest(altered.input, BUYER.id); refuses(f, altered);
  });
});

describe("V5 whole-state integrity", () => {
  it.each([
    (s: V5State) => { s.trades.get(V3_FIXTURE_TRADE)!.status = "payment_verified"; },
    (s: V5State) => { s.trades.get(V3_FIXTURE_TRADE)!.disputed = false; },
    (s: V5State) => { s.trades.get(V3_FIXTURE_TRADE)!.evidence = { reference: "sim-evidence-forged", amountMinor: "1", currency: "ILS", kind: "simulated-bank-credit" }; },
    (s: V5State) => { s.evidenceOwners.set("sim-evidence-forged", V3_FIXTURE_TRADE); },
    (s: V5State) => { s.initialPaymentClaimReceipts.clear(); },
    (s: V5State) => { s.initialDisputeFreezeReceipts.clear(); },
    (s: V5State) => { s.initialPaymentClaimReceipts.values().next().value!.input.claim.proof!.contentSha256 = "f".repeat(64); },
    (s: V5State) => { s.initialDisputeFreezeReceipts.values().next().value!.actorUserId = "other-buyer"; },
    (s: V5State) => { s.initialAcceptanceReceipts.values().next().value!.acceptedAtMs++; },
    (s: V5State) => { s.paymentContinuation.checkpoint.stateHash = "f".repeat(64); },
    (s: V5State) => { s.haltReason = "invented pause"; },
    (s: V5State) => { transfer(s, "v5:forged", "tron-sim-usdt", `listing:${V3_FIXTURE_LISTING}`, "available:attacker", BigInt(1)); },
  ])("detects altered state, immutable receipt or a conserved but unauthorized transfer %#", mutate => {
    const f = createV5EngineFixture(); f.step(claim(f)); f.step(dispute(f)); const altered = structuredClone(f.state); mutate(altered);
    expect(() => assertV5Invariants(altered)).toThrow(); expect(baseV4StateForV5(f.state)).toEqual(f.source);
  });
  it("keeps V4 invariants unchanged and rejects newly appended old commands after V5", () => {
    const f = createV5EngineFixture(); f.step(claim(f));
    const old = baseV4StateForV5(f.state); assertV4Invariants(old); old.trades.get(V3_FIXTURE_TRADE)!.status = "payment_reported";
    expect(() => assertV4Invariants(old)).toThrow();
    const command = v4Command("pause", OPERATOR, "new-old-command", null), last = f.records.at(-1)!;
    const row = { ...last, revision: Number(last.revision) + 1, previous_event_hash: last.event_hash, command_key: v5CommandKey(command),
      command_type: command.type, command_json: command, input_hash: walletDigest(command) };
    expect(() => verifyV5History([...f.records, row])).toThrow();
  });
});
