// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetFor, formatUnits, parseUnits, quoteTrade, type AssetId } from "./amounts";
import { planAcceptedAmountTerms } from "./accepted-terms";
import { applyWalletCommand, parseWalletCommand, walletCommandKey, walletDigest, walletJson, type WalletCommand } from "./commands";
import { verifyDurableHistory, walletCommand } from "./durable";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { createAlphaWalletSandbox, simulatedDestination } from "./sandbox";
import type { Actor, State } from "./types";
import { acceptanceInputFromPlan, parseV2Command, parseVersionedCommand, v2Command, versionedCommandKey, WALLET_V2_ENGINE_VERSION,
  type V2Command, type V2Checkpoint } from "./v2-commands";
import { applyV2Command, assertV2Invariants, findV2AcceptanceReplay, planningBindingFor, type V2AcceptanceReceipt, type V2State, type V2TermsBinding } from "./v2-engine";
import { createV2TermsFixture } from "./v2-fixtures";
import { createHydratedV2Kernel } from "./v2-kernel";

const TRON: AssetId = "tron-sim-usdt", BSC: AssetId = "bsc-sim-binance-peg-usdt";
const SELLER: Actor = { kind: "seller", id: "v2-seller" }, BUYER: Actor = { kind: "buyer", id: "v2-buyer" };
const OPERATOR: Actor = { kind: "operator", id: "v2-operator" }, VERIFIER: Actor = { kind: "verifier", id: "v2-verifier" };
const DISPATCHER: Actor = { kind: "dispatcher", id: "v2-dispatcher" };
const NOW = Date.parse("2026-11-05T00:00:00.000Z");
const GENESIS = "0".repeat(64);

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

function model(state: State, initial: V2Checkpoint) {
  let current = structuredClone(state) as State | V2State;
  let checkpoint = structuredClone(initial);
  const head = () => ({ ...checkpoint, stateHash: walletDigest(current) });
  const step = (command: V2Command) => {
    const before = head(), at = checkpoint.lastCommandAtMs + 1;
    const result = applyV2Command(current, command, { ...before, at });
    current = result.state;
    checkpoint = { revision: before.revision + 1, stateHash: walletDigest(current), lastCommandAtMs: at,
      eventHash: walletDigest({ revision: before.revision + 1, commandKey: versionedCommandKey(command), at,
        inputHash: walletDigest(command), resultHash: walletDigest(result.result), stateHash: walletDigest(current), previousHash: before.eventHash }) };
    return result.result;
  };
  return { get state() { return current as V2State; }, head, step,
    apply(command: V2Command) { return applyV2Command(current, command, { ...head(), at: checkpoint.lastCommandAtMs + 1 }); } };
}

function fixture(options: { assetId?: AssetId; amount?: string; continue?: boolean } = {}) {
  const assetId = options.assetId ?? TRON, asset = assetFor(assetId);
  let clock = NOW;
  const wallet = createAlphaWalletSandbox({ mode: "simulation-only", clock: () => clock });
  const records: Array<Record<string, unknown>> = [];
  let hash = GENESIS;
  const commitV1 = (command: WalletCommand) => {
    clock++;
    const result = applyWalletCommand(wallet, command), revision = records.length + 1;
    const commandKey = walletCommandKey(command), inputHash = walletDigest(command), resultHash = walletDigest(result), stateHash = walletDigest(wallet.snapshot());
    const eventHash = walletDigest({ revision, commandKey, at: clock, inputHash, resultHash, stateHash, previousHash: hash });
    records.push({ revision, command_key: commandKey, command_type: command.type, occurred_at_ms: String(clock), command_json: command,
      input_hash: inputHash, result_json: walletJson(result), result_hash: resultHash, state_hash: stateHash, previous_event_hash: hash, event_hash: eventHash });
    hash = eventHash;
    return result;
  };
  const intent = commitV1(walletCommand("createDepositIntent", SELLER, "v1-funding-intent", { id: "v2-funding", assetId, purpose: "principal" })) as { destination: string };
  commitV1(walletCommand("observeDeposit", VERIFIER, "v1-funding-observation", { intentId: "v2-funding", assetId, network: asset.network, token: asset.token,
    transactionId: "sim-tx-v2-funding", eventIndex: 0, destination: intent.destination, amountRaw: parseUnits("500", asset.decimals).toString(),
    blockHash: "sim-block-v2-funding", finalized: true, successful: true }));
  commitV1(walletCommand("createListing", SELLER, "v1-create-listing", { id: "v2-listing", assetId, amount: "500", price: "3.20", currency: "ILS" }));
  commitV1(walletCommand("approveListing", OPERATOR, "v1-approve-listing", "v2-listing"));
  const originalReserve = walletCommand("reserveTrade", BUYER, "v1-reservation", { id: "v2-trade", listingId: "v2-listing",
    amount: options.amount ?? "200", destination: simulatedDestination(assetId, BUYER.id) });
  commitV1(originalReserve);
  const verified = verifyDurableHistory(records);
  const oldState = wallet.snapshot(), oldCheckpoint = { revision: verified.revision, eventHash: verified.eventHash,
    stateHash: walletDigest(verified.state), lastCommandAtMs: verified.occurredAtMs };
  const m = model(oldState, oldCheckpoint);
  const continuation = v2Command("continueFromV1", OPERATOR, "v2-upgrade", { checkpoint: oldCheckpoint });
  if (options.continue !== false) m.step(continuation);
  const recordsFor = (amount = options.amount ?? "300", proposalId = "v2-proposal-one", submittedAdjustmentCount: 1 | 2 = 1) =>
    createV2TermsFixture({ mode: "simulation-only", state: m.state, walletTradeId: "v2-trade", platformRequestId: "v2-request", platformListingId: "v2-market-listing",
      proposedAmount: amount, proposalId, submittedAdjustmentCount });
  const enroll = () => {
    const f = recordsFor();
    const command = v2Command("enrollReservedTrade", OPERATOR, "v2-enrollment", { walletTradeId: "v2-trade", terms: f.description.terms,
      termsDigest: f.description.digest, expectedWallet: m.head(), walletTradeDigest: walletDigest(m.state.trades.get("v2-trade")) });
    return { command, binding: m.step(command) as V2TermsBinding };
  };
  const acceptance = (amount = "300", proposalId = "v2-proposal-one", submittedAdjustmentCount: 1 | 2 = 1, requestId = "v2-acceptance") => {
    const f = recordsFor(amount, proposalId, submittedAdjustmentCount);
    const plan = planAcceptedAmountTerms({ mode: "simulation-only", actorUserId: BUYER.id, requestId: f.request.id, proposalId,
      expectedBindingRevision: planningBindingFor(m.state, f.request.id).revision, marketplace: f.marketplace,
      wallet: { revision: m.head().revision, eventHash: m.head().eventHash, state: m.state }, binding: planningBindingFor(m.state, f.request.id) });
    return { f, plan, command: v2Command("acceptAmountCorrection", BUYER, requestId, acceptanceInputFromPlan(plan)) };
  };
  return { m, oldState, oldCheckpoint, continuation, originalReserve, records, assetId, asset, recordsFor, enroll, acceptance };
}

function rehashPlanner(command: ReturnType<ReturnType<typeof fixture>["acceptance"]>["command"], prior = command.input.priorTermsDigest) {
  command.input.plannerInputDigest = walletDigest({ actorUserId: command.actor.id, prior,
    accepted: walletDigest(command.input.acceptedTerms), preconditions: command.input.preconditions });
}

describe("strict v2 protocol and pinned inherited reducer", () => {
  it("keeps the hydrated kernel source identical to v1 except explicit internal construction", () => {
    const original = readFileSync(new URL("./sandbox.ts", import.meta.url), "utf8");
    const copied = readFileSync(new URL("./v2-kernel.ts", import.meta.url), "utf8");
    const initialization = original.slice(original.indexOf("  let state: State = {"), original.indexOf("\n  function command<T>"));
    const normalized = copied.slice(copied.indexOf('import { assetFor'))
      .replace('export function createHydratedV2Kernel(options: { mode: "simulation-only"; initialState: State; clock?: () => number })',
        'export function createAlphaWalletSandbox(options: { mode: "simulation-only"; clock?: () => number })')
      .replace("  let state: State = clone(options.initialState);\n  assertLedgerInvariants(state);", initialization)
      .replace("export type HydratedV2Kernel = ReturnType<typeof createHydratedV2Kernel>;", "export type AlphaWalletSandbox = ReturnType<typeof createAlphaWalletSandbox>;");
    expect(normalized).toBe(original);
  });

  it("hydrates every frozen v1 command without changing its original result or state hash", () => {
    const frozen = JSON.parse(readFileSync(new URL("./fixtures/v1/settlement-and-held-withdrawal.backup.json", import.meta.url), "utf8")) as { commands: Array<Record<string, unknown>> };
    let state = createAlphaWalletSandbox({ mode: "simulation-only" }).snapshot();
    for (const row of frozen.commands) {
      const kernel = createHydratedV2Kernel({ mode: "simulation-only", initialState: state, clock: () => Number(row.occurred_at_ms) });
      const result = applyWalletCommand(kernel, parseWalletCommand(row.command_json));
      state = kernel.snapshot();
      expect(walletJson(result)).toEqual(row.result_json);
      expect(walletDigest(result)).toBe(row.result_hash);
      expect(walletDigest(state)).toBe(row.state_hash);
    }
    expect(frozen.commands).toHaveLength(41);
  });

  it("strictly separates versions while preserving the global command key", () => {
    const old = walletCommand("pause", OPERATOR, "same-identity", null);
    const next = v2Command("pause", OPERATOR, "same-identity", null);
    expect(versionedCommandKey(next)).toBe(walletCommandKey(old));
    expect(walletDigest(next)).not.toBe(walletDigest(old));
    expect(parseVersionedCommand(old)).toEqual(old);
    expect(parseVersionedCommand(next)).toEqual(next);
    expect(() => parseWalletCommand(next)).toThrow();
    expect(() => parseV2Command(old)).toThrow();
    for (const extra of [{ authority: true }, { owner: true }, { accepted: true }]) expect(() => parseV2Command({ ...next, ...extra })).toThrow();
    for (const version of [0, 3, "2", null]) expect(() => parseVersionedCommand({ ...next, version })).toThrow();
    expect(() => parseV2Command({ ...next, type: "sendRealTransfer" })).toThrow();
    expect(() => parseV2Command({ ...next, engineVersion: "alpha-wallet-mainnet" })).toThrow();
  });

  it("rejects extra enrollment, acceptance and private payment fields", () => {
    const f = fixture(); const { command: enrollment } = f.enroll();
    const { command } = f.acceptance();
    expect(() => parseV2Command({ ...enrollment, input: { ...enrollment.input, trusted: true } })).toThrow();
    expect(() => parseV2Command({ ...command, input: { ...command.input, accepted: true } })).toThrow();
    expect(() => parseV2Command({ ...command, input: { ...command.input, acceptedTerms: { ...command.input.acceptedTerms, bankAccountNumber: "real-looking-secret" } } })).toThrow();
    expect(JSON.stringify(command)).not.toContain("00001234");
  });
});

describe("explicit one-way continuation and synthetic enrollment", () => {
  it("adds metadata only at its exact checkpoint and moves no funds or inherited evidence", () => {
    const f = fixture({ continue: false });
    expect(Object.hasOwn(f.m.state, "termsBindings")).toBe(false);
    const result = f.m.step(f.continuation);
    const { engineVersion, continuation, termsBindings, acceptanceReceipts, ...base } = f.m.state;
    expect(engineVersion).toBe(WALLET_V2_ENGINE_VERSION);
    expect(result).toEqual(continuation);
    expect(continuation).toEqual({ checkpoint: f.oldCheckpoint, commandRevision: 6, commandKey: versionedCommandKey(f.continuation) });
    expect(termsBindings.size).toBe(0); expect(acceptanceReceipts.size).toBe(0);
    base.idempotency.delete(`v2:${versionedCommandKey(f.continuation)}`);
    expect(walletJson(base)).toEqual(walletJson(f.oldState));
    expect(walletDigest(f.oldState)).toBe(f.oldCheckpoint.stateHash);
    assertV2Invariants(f.m.state);
  });

  it.each(["revision", "eventHash", "stateHash", "lastCommandAtMs"] as const)("rejects a changed continuation %s without touching the original state", field => {
    const f = fixture({ continue: false });
    const changed = structuredClone(f.continuation);
    if (field === "revision" || field === "lastCommandAtMs") changed.input.checkpoint[field]++;
    else changed.input.checkpoint[field] = "e".repeat(64);
    expect(() => f.m.apply(changed)).toThrow("verified v1 checkpoint");
    expect(walletDigest(f.m.state)).toBe(f.oldCheckpoint.stateHash);
  });

  it("requires operator authority, one transition and a non-backwards command time", () => {
    const f = fixture({ continue: false });
    expect(() => f.m.apply({ ...f.continuation, actor: BUYER })).toThrow("operator");
    expect(() => f.m.apply(v2Command("pause", OPERATOR, "before-continuation", null))).toThrow("continuation is required");
    expect(() => applyV2Command(f.m.state, f.continuation, { ...f.m.head(), at: f.m.head().lastCommandAtMs - 1 })).toThrow("clock");
    f.m.step(f.continuation);
    expect(() => f.m.apply({ ...f.continuation, requestId: "second-upgrade" })).toThrow("only once");
    expect(f.m.apply(f.continuation)).toEqual({ state: f.m.state, result: f.m.state.continuation });
  });

  it("enrolls exactly one clean reservation without changing principal and clones returned values", () => {
    const f = fixture(), journal = structuredClone(f.m.state.journal);
    const { binding } = f.enroll();
    expect(binding).toMatchObject({ platformRequestId: "v2-request", walletTradeId: "v2-trade", revision: 0,
      enrollmentCommandRevision: 7, lastCommandRevision: 7, lastSubmittedAdjustmentCount: 0, terms: { usdtAmount: "200", pricePerUsdt: "3.20" } });
    expect(f.m.state.journal).toEqual(journal);
    expect(f.m.state.termsBindings.size).toBe(1);
    binding.terms.usdtAmount = "1";
    expect(f.m.state.termsBindings.get("v2-request")!.terms.usdtAmount).toBe("200");
    const planBinding = planningBindingFor(f.m.state, "v2-request");
    expect(planBinding).toMatchObject({ revision: 0, reservation: { kind: "reserved", walletTradeId: "v2-trade" } });
    planBinding.termsDigest = "0".repeat(64);
    expect(planningBindingFor(f.m.state, "v2-request").termsDigest).not.toBe(planBinding.termsDigest);
  });

  it.each(["wrong-actor", "stale-head", "stale-trade", "bad-terms", "missing-trade", "duplicate-request", "duplicate-trade"])("rejects %s enrollment", variant => {
    const f = fixture(); const context = f.recordsFor();
    const command = v2Command("enrollReservedTrade", OPERATOR, "enrollment-case", { walletTradeId: "v2-trade", terms: context.description.terms,
      termsDigest: context.description.digest, expectedWallet: f.m.head(), walletTradeDigest: walletDigest(f.m.state.trades.get("v2-trade")) });
    if (variant.startsWith("duplicate")) {
      f.enroll(); command.input.expectedWallet = f.m.head();
      if (variant === "duplicate-trade") { command.input.terms.platformRequestId = "another-request"; command.input.termsDigest = walletDigest(command.input.terms); }
    }
    if (variant === "wrong-actor") command.actor = BUYER;
    if (variant === "stale-head") command.input.expectedWallet.revision++;
    if (variant === "stale-trade") command.input.walletTradeDigest = "1".repeat(64);
    if (variant === "bad-terms") command.input.termsDigest = "1".repeat(64);
    if (variant === "missing-trade") command.input.walletTradeId = "absent-trade";
    const before = walletDigest(f.m.state);
    expect(() => f.m.apply(command)).toThrow();
    expect(walletDigest(f.m.state)).toBe(before);
  });

  it("refuses a changed locked price even when the rounded fiat total is identical", () => {
    const f = fixture({ amount: "0.1" }), records = f.recordsFor("0.1");
    const changed = { ...records.description.terms, pricePerUsdt: "3.21" };
    expect(quoteTrade(TRON, "0.1", "3.20").fiatTotalMinor).toBe(quoteTrade(TRON, "0.1", "3.21").fiatTotalMinor);
    const command = v2Command("enrollReservedTrade", OPERATOR, "wrong-same-cent-price", { walletTradeId: "v2-trade", terms: changed,
      termsDigest: walletDigest(changed), expectedWallet: f.m.head(), walletTradeDigest: walletDigest(f.m.state.trades.get("v2-trade")) });
    expect(() => f.m.apply(command)).toThrow("listing price differs");
  });
});

describe("durable-receipt-ready amount correction reducer", () => {
  it.each([TRON, BSC])("increases and decreases the same trade by exact deltas on %s", assetId => {
    const f = fixture({ assetId }); f.enroll();
    const original = structuredClone(f.m.state), first = f.acceptance();
    const receipt = f.m.step(first.command) as V2AcceptanceReceipt;
    expect(receipt).toMatchObject({ bindingRevision: 1, principalDeltaRaw: parseUnits("100", f.asset.decimals).toString(),
      transferAmountRaw: parseUnits("100", f.asset.decimals).toString(), terms: { usdtAmount: "300", buyerFeeRaw: parseUnits("3", f.asset.decimals).toString() } });
    expect(f.m.state.trades.size).toBe(1);
    expect(f.m.state.trades.get("v2-trade")).toMatchObject({ id: "v2-trade", status: "reserved", destination: original.trades.get("v2-trade")!.destination,
      amountRaw: parseUnits("300", f.asset.decimals), totalFeeRaw: parseUnits("6", f.asset.decimals) });
    expect(balance(f.m.state, assetId, "listing:v2-listing")).toBe(parseUnits("200", f.asset.decimals));
    expect(balance(f.m.state, assetId, "trade:v2-trade")).toBe(parseUnits("300", f.asset.decimals));
    expect(f.m.state.journal.length).toBe(original.journal.length + 1);
    expect(expectedCustody(f.m.state, assetId)).toBe(parseUnits("500", f.asset.decimals));
    const second = f.acceptance("150", "v2-proposal-two", 2, "v2-acceptance-two");
    expect(f.m.step(second.command)).toMatchObject({ bindingRevision: 2, principalDeltaRaw: `-${parseUnits("150", f.asset.decimals)}` });
    expect(balance(f.m.state, assetId, "listing:v2-listing")).toBe(parseUnits("350", f.asset.decimals));
    expect(balance(f.m.state, assetId, "trade:v2-trade")).toBe(parseUnits("150", f.asset.decimals));
    expect(f.m.state.acceptanceReceipts.size).toBe(2);
    expect(original.trades.get("v2-trade")!.amountRaw).toBe(parseUnits("200", f.asset.decimals));
    assertV2Invariants(f.m.state);
  });

  it("records zero-delta acceptance without a zero journal or any allocation change", () => {
    const f = fixture(); f.enroll();
    const original = structuredClone(f.m.state);
    const result = f.m.step(f.acceptance("200").command) as V2AcceptanceReceipt;
    expect(result).toMatchObject({ bindingRevision: 1, principalDeltaRaw: "0", transferAmountRaw: "0" });
    expect(f.m.state.journal).toEqual(original.journal);
    expect(f.m.state.accounts).toEqual(original.accounts);
    expect(f.m.state.acceptanceReceipts.size).toBe(1);
    expect(f.m.state.termsBindings.get("v2-request")!.termsDigest).toBe(original.termsBindings.get("v2-request")!.termsDigest);
  });

  it("recovers one exact proposal receipt across transport identities and after later payment/pause", () => {
    const f = fixture(); f.enroll(); const first = f.acceptance();
    const receipt = f.m.step(first.command) as V2AcceptanceReceipt;
    const second = f.acceptance("150", "v2-proposal-two", 2, "v2-acceptance-two"); f.m.step(second.command);
    f.m.step(v2Command("markBuyerPaid", BUYER, "paid-after-corrections", "v2-trade"));
    f.m.step(v2Command("pause", OPERATOR, "pause-after-corrections", null));
    const alternate = { ...first.command, requestId: "mobile-retry-other-transport" };
    const before = walletDigest(f.m.state);
    expect(findV2AcceptanceReplay(f.m.state, alternate)).toEqual(receipt);
    expect(f.m.apply(alternate)).toEqual({ state: f.m.state, result: receipt });
    expect(walletDigest(f.m.state)).toBe(before);
    const changed = structuredClone(alternate); changed.input.proposalId = "different-proposal";
    expect(findV2AcceptanceReplay(f.m.state, changed)).toBeUndefined();
    expect(() => f.m.apply(changed)).toThrow("paused");
    const tampered = structuredClone(alternate); tampered.input.acceptedTerms.usdtAmount = "301";
    expect(() => findV2AcceptanceReplay(f.m.state, tampered)).toThrow("different actor or input");
    expect(() => findV2AcceptanceReplay(f.m.state, { ...alternate, actor: SELLER })).toThrow("different actor or input");
  });

  it.each(["wallet-revision", "wallet-hash", "state-hash", "trade-hash", "binding-revision", "binding-hash", "prior-terms", "planner-hash", "wrong-buyer", "wrong-role"])("rejects %s acceptance without changing either balance", variant => {
    const f = fixture(); f.enroll(); const { command } = f.acceptance();
    if (variant === "wallet-revision") command.input.preconditions.walletRevision++;
    if (variant === "wallet-hash") command.input.preconditions.walletEventHash = "b".repeat(64);
    if (variant === "state-hash") command.input.preconditions.walletStateDigest = "b".repeat(64);
    if (variant === "trade-hash") command.input.preconditions.walletTradeDigest = "b".repeat(64);
    if (variant === "binding-revision") command.input.preconditions.bindingRevision++;
    if (variant === "binding-hash") command.input.preconditions.bindingDigest = "b".repeat(64);
    if (variant === "prior-terms") command.input.priorTermsDigest = "b".repeat(64);
    if (variant === "planner-hash") command.input.plannerInputDigest = "b".repeat(64);
    if (variant === "wrong-buyer") command.actor.id = "other-buyer";
    if (variant === "wrong-role") command.actor = { kind: "operator", id: BUYER.id };
    const before = walletDigest(f.m.state);
    expect(() => f.m.apply(command)).toThrow();
    expect(walletDigest(f.m.state)).toBe(before);
  });

  it.each(["fees", "principal", "fiat", "price", "destination", "instructions", "unsupported-fee-policy"])("rechecks %s even if a caller recomputes source digests", variant => {
    const f = fixture(); f.enroll(); const { command } = f.acceptance();
    const terms = command.input.acceptedTerms;
    if (variant === "fees") terms.totalFeeRaw = "1";
    if (variant === "principal") terms.principalRaw = "1";
    if (variant === "fiat") terms.fiatAmount = "1.00";
    if (variant === "price") {
      terms.pricePerUsdt = "3.21";
      const quoted = quoteTrade(f.assetId, terms.usdtAmount, terms.pricePerUsdt);
      terms.fiatTotalMinor = quoted.fiatTotalMinor.toString(); terms.fiatAmount = formatUnits(quoted.fiatTotalMinor, 2);
    }
    if (variant === "destination") terms.destination = simulatedDestination(f.assetId, "wrong-recipient");
    if (variant === "instructions") terms.paymentInstructionsDigest = "c".repeat(64);
    if (variant === "unsupported-fee-policy") Object.assign(terms, { feePolicyVersion: "seller_2pct_legacy" });
    rehashPlanner(command);
    const before = walletDigest(f.m.state);
    expect(() => f.m.apply(command)).toThrow();
    expect(walletDigest(f.m.state)).toBe(before);
  });

  it("never lets a descriptor reserve beyond funded capacity and preserves the first accepted amount", () => {
    const f = fixture(); f.enroll(); const { command } = f.acceptance();
    const forged = createV2TermsFixture({ mode: "simulation-only", state: f.m.state, walletTradeId: "v2-trade", platformRequestId: "v2-request", platformListingId: "v2-market-listing", proposedAmount: "600" });
    const quote = quoteTrade(f.assetId, "600", "3.20");
    command.input.acceptedTerms = { ...forged.description.terms, usdtAmount: "600", fiatAmount: "1939.20", principalRaw: quote.principalRaw.toString(),
      buyerFeeRaw: quote.buyerFeeRaw.toString(), sellerFeeRaw: quote.sellerFeeRaw.toString(), totalFeeRaw: quote.totalFeeRaw.toString(), fiatTotalMinor: quote.fiatTotalMinor.toString() };
    rehashPlanner(command);
    expect(() => f.m.apply(command)).toThrow("Insufficient funds");
    expect(balance(f.m.state, f.assetId, "listing:v2-listing")).toBe(parseUnits("300", f.asset.decimals));
    expect(f.m.state.acceptanceReceipts.size).toBe(0);
  });

  it("blocks increased commitments while a completed sibling trade owes commission, while permitting a decrease", () => {
    const f = fixture(); f.enroll();
    f.m.step(v2Command("reserveTrade", BUYER, "reserve-sibling", { id: "v2-sibling", listingId: "v2-listing",
      amount: "50", destination: simulatedDestination(f.assetId, BUYER.id) }));
    f.m.step(v2Command("markBuyerPaid", BUYER, "sibling-paid", "v2-sibling"));
    f.m.step(v2Command("verifyPayment", VERIFIER, "sibling-payment", { tradeId: "v2-sibling",
      evidence: { reference: "sim-evidence-sibling", amountMinor: "16160", currency: "ILS", kind: "simulated-bank-credit" } }));
    f.m.step(v2Command("authorizeRelease", SELLER, "sibling-authorized", "v2-sibling"));
    f.m.step(v2Command("reconcileAsset", VERIFIER, "sibling-reconciled", { assetId: f.assetId,
      observedRaw: expectedCustody(f.m.state, f.assetId).toString(), complete: true }));
    f.m.step(v2Command("setNativeFeeReadiness", OPERATOR, "sibling-gas", { assetId: f.assetId, ready: true }));
    const payout = f.m.step(v2Command("queueRelease", DISPATCHER, "sibling-queued", "v2-sibling")) as {
      id: string; destination: string; providerReference: string; amountRaw: bigint;
    };
    f.m.step(v2Command("beginDispatch", DISPATCHER, "sibling-claimed", payout.id));
    f.m.step(v2Command("confirmPayout", VERIFIER, "sibling-confirmed", { payoutId: payout.id, providerReference: payout.providerReference,
      assetId: f.assetId, network: f.asset.network, token: f.asset.token, transactionId: "sim-tx-sibling-final", eventIndex: 0,
      destination: payout.destination, amountRaw: payout.amountRaw.toString(), finalized: true, successful: true }));
    expect(f.m.state.commissions.get("v2-sibling")).toMatchObject({ amountRaw: parseUnits("1", f.asset.decimals), paid: false });
    const before = walletDigest(f.m.state);
    expect(() => f.m.apply(f.acceptance("300").command)).toThrow("Unpaid commission blocks increased seller commitments");
    expect(walletDigest(f.m.state)).toBe(before);
    const decreased = f.m.step(f.acceptance("150", "decrease-with-unpaid-fee").command) as V2AcceptanceReceipt;
    expect(decreased.principalDeltaRaw).toBe((-parseUnits("50", f.asset.decimals)).toString());
    expect(f.m.state.trades.get("v2-trade")!.amountRaw).toBe(parseUnits("150", f.asset.decimals));
    expect(f.m.state.commissions.get("v2-sibling")!.paid).toBe(false);
    expect(expectedCustody(f.m.state, f.assetId)).toBe(parseUnits("450", f.asset.decimals));
  });

  it("requires monotonically submitted proposals, including a skipped declined first proposal", () => {
    const f = fixture(); f.enroll();
    f.m.step(f.acceptance("250", "second-submission", 2).command);
    const third = f.acceptance("275", "invented-third-submission", 2, "third-transport");
    expect(() => f.m.apply(third.command)).toThrow("proposal limit");
    expect(f.m.state.termsBindings.get("v2-request")!.lastSubmittedAdjustmentCount).toBe(2);
    expect(f.m.state.acceptanceReceipts.size).toBe(1);
  });

  it.each(["payment", "dispute", "evidence-owner", "closed-listing", "paused"])("blocks a fresh correction after %s even with freshly recomputed checkpoint evidence", variant => {
    const f = fixture(); f.enroll(); const saved = f.acceptance().command;
    if (variant === "payment") f.m.step(v2Command("markBuyerPaid", BUYER, "payment-lock", "v2-trade"));
    if (variant === "dispute") f.m.step(v2Command("openDispute", BUYER, "dispute-lock", "v2-trade"));
    if (variant === "closed-listing") f.m.step(v2Command("closeListing", SELLER, "close-listing-lock", "v2-listing"));
    if (variant === "paused") f.m.step(v2Command("pause", OPERATOR, "pause-lock", null));
    if (variant === "evidence-owner") f.m.state.evidenceOwners.set("retained-evidence", "v2-trade");
    Object.assign(saved.input.preconditions, { walletRevision: f.m.head().revision, walletEventHash: f.m.head().eventHash,
      walletStateDigest: f.m.head().stateHash, walletTradeDigest: walletDigest(f.m.state.trades.get("v2-trade")) });
    rehashPlanner(saved);
    const before = walletDigest(f.m.state);
    expect(() => f.m.apply(saved)).toThrow();
    expect(walletDigest(f.m.state)).toBe(before);
  });
});

describe("inherited recovery and settlement after a resize", () => {
  it.each([TRON, BSC])("settles the new full principal and separate fees through inherited rules on %s", assetId => {
    const f = fixture({ assetId }); f.enroll(); f.m.step(f.acceptance().command);
    const binding = structuredClone(f.m.state.termsBindings.get("v2-request"));
    f.m.step(v2Command("markBuyerPaid", BUYER, "buyer-paid", "v2-trade"));
    f.m.step(v2Command("verifyPayment", VERIFIER, "trusted-payment", { tradeId: "v2-trade", evidence: { reference: "sim-evidence-v2", amountMinor: "96960", currency: "ILS", kind: "simulated-bank-credit" } }));
    f.m.step(v2Command("authorizeRelease", SELLER, "seller-authorized", "v2-trade"));
    f.m.step(v2Command("reconcileAsset", VERIFIER, "reconcile-resized", { assetId, observedRaw: expectedCustody(f.m.state, assetId).toString(), complete: true }));
    f.m.step(v2Command("setNativeFeeReadiness", OPERATOR, "fixture-gas", { assetId, ready: true }));
    const payout = f.m.step(v2Command("queueRelease", DISPATCHER, "queue-resized", "v2-trade")) as { id: string; destination: string; providerReference: string; amountRaw: bigint };
    expect(payout.amountRaw).toBe(parseUnits("300", f.asset.decimals));
    const dispatch = v2Command("beginDispatch", DISPATCHER, "dispatch-resized", payout.id);
    expect(f.m.step(dispatch)).toMatchObject({ shouldDispatch: true });
    f.m.step(v2Command("recordSubmission", DISPATCHER, "lost-resized-reply", { payoutId: payout.id, outcome: "unknown" }));
    expect(f.m.apply(dispatch).result).toMatchObject({ shouldDispatch: false, payout: { state: "submission_unknown", dispatchCount: 1 } });
    f.m.step(v2Command("confirmPayout", VERIFIER, "final-resized-receipt", { payoutId: payout.id, providerReference: payout.providerReference,
      assetId, network: f.asset.network, token: f.asset.token, transactionId: "sim-tx-resized-final", eventIndex: 0, destination: payout.destination,
      amountRaw: payout.amountRaw.toString(), finalized: true, successful: true }));
    expect(f.m.state.trades.get("v2-trade")!.status).toBe("completed");
    expect(expectedCustody(f.m.state, assetId)).toBe(parseUnits("200", f.asset.decimals));
    expect(f.m.state.commissions.get("v2-trade")).toMatchObject({ amountRaw: parseUnits("6", f.asset.decimals), paid: false });
    const feeIntent = f.m.step(v2Command("createDepositIntent", SELLER, "separate-fee-intent", { id: "v2-fees", assetId, purpose: "commission" })) as { destination: string };
    f.m.step(v2Command("observeDeposit", VERIFIER, "separate-fee-observation", { intentId: "v2-fees", assetId, network: f.asset.network, token: f.asset.token,
      transactionId: "sim-tx-v2-fees", eventIndex: 0, destination: feeIntent.destination, amountRaw: parseUnits("6", f.asset.decimals).toString(),
      blockHash: "sim-block-v2-fees", finalized: true, successful: true }));
    expect(f.m.state.commissions.get("v2-trade")!.paid).toBe(true);
    expect(balance(f.m.state, assetId, "platform-revenue")).toBe(parseUnits("6", f.asset.decimals));
    expect(f.m.state.termsBindings.get("v2-request")).toEqual(binding);
    expect(f.m.state.acceptanceReceipts.size).toBe(1);
    assertV2Invariants(f.m.state);
  });

  it("records inherited unknown payout finality after continuation and pause without losing exact large units", () => {
    const frozen = JSON.parse(readFileSync(new URL("./fixtures/v1/settlement-and-held-withdrawal.backup.json", import.meta.url), "utf8")) as { commands: Array<Record<string, unknown>> };
    const old = verifyDurableHistory(frozen.commands), checkpoint = { revision: old.revision, eventHash: old.eventHash, stateHash: walletDigest(old.state), lastCommandAtMs: old.occurredAtMs };
    const m = model(old.state, checkpoint);
    m.step(v2Command("continueFromV1", OPERATOR, "continue-golden-v1", { checkpoint }));
    m.step(v2Command("pause", OPERATOR, "pause-golden-v2", null));
    const payout = m.state.payouts.get("withdrawal-v1-bsc-withdrawal")!, asset = assetFor(payout.assetId);
    const originalReference = payout.providerReference, held = payout.amountRaw;
    expect(held).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    m.step(v2Command("confirmPayout", VERIFIER, "golden-unknown-finality", { payoutId: payout.id, providerReference: originalReference,
      assetId: payout.assetId, network: asset.network, token: asset.token, transactionId: "sim-tx-golden-withdrawal-final", eventIndex: 0,
      destination: payout.destination, amountRaw: held.toString(), finalized: true, successful: true }));
    expect(m.state.payouts.get(payout.id)).toMatchObject({ state: "confirmed", dispatchCount: 1, providerReference: originalReference, amountRaw: held });
    expect(balance(m.state, BSC, "available:v1-seller")).toBe(BigInt(1));
    expect(m.state.haltReason).toBe("Operator emergency pause");
    assertLedgerInvariants(m.state); assertV2Invariants(m.state);
  });

  it("rejects production/hosted changes before applying a versioned operation", () => {
    const f = fixture(); const before = walletDigest(f.m.state);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => f.m.apply(v2Command("pause", OPERATOR, "prod-pause", null))).toThrow("local development or test");
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("VERCEL", "1");
    expect(() => f.m.apply(v2Command("pause", OPERATOR, "hosted-pause", null))).toThrow("hosted");
    vi.stubEnv("VERCEL", undefined);
    expect(walletDigest(f.m.state)).toBe(before);
  });
});
