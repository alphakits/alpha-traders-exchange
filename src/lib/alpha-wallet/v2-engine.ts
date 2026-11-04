import { calculateTradeTermsQuote } from "@alpha-traders/contracts";
import { DEVELOPMENT_TERMS_BINDING_VERSION, type DevelopmentTermsBinding, type DevelopmentTradeTerms } from "./accepted-terms";
import { formatUnits, parseRawUnits, parseUnits, quoteTrade, ZERO, type AssetId } from "./amounts";
import { applyWalletCommand, parseWalletCommand, walletDigest, WALLET_ENGINE_VERSION } from "./commands";
import { assertLedgerInvariants, balance, transfer } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import type { State, Trade } from "./types";
import { createHydratedV2Kernel } from "./v2-kernel";
import {
  parseV2Command, v2CheckpointSchema, v2TermsSchema, versionedCommandKey, WALLET_V2_ENGINE_VERSION,
  type V2AcceptanceInput, type V2Checkpoint, type V2Command, type V2CommandOf,
} from "./v2-commands";

export type V2Continuation = { checkpoint: V2Checkpoint; commandRevision: number; commandKey: string };
export type V2TermsBinding = {
  platformRequestId: string; platformListingId: string; walletListingId: string; walletTradeId: string; assetId: AssetId;
  revision: number; terms: DevelopmentTradeTerms; termsDigest: string; walletTradeDigest: string; enrollmentTermsDigest: string;
  enrollmentCommandRevision: number; enrollmentCommandKey: string; lastCommandRevision: number; lastCommandKey: string;
  lastSubmittedAdjustmentCount: number;
};
export type V2AcceptanceReceipt = {
  acceptanceKey: string; platformRequestId: string; proposalId: string; actorUserId: string; walletTradeId: string;
  commandRevision: number; commandKey: string; inputDigest: string; plannerInputDigest: string;
  priorTermsDigest: string; acceptedTermsDigest: string; bindingRevision: number;
  principalDeltaRaw: string; transferAmountRaw: string; terms: DevelopmentTradeTerms; acceptedAtMs: number;
};
export type V2State = State & {
  engineVersion: typeof WALLET_V2_ENGINE_VERSION;
  continuation: V2Continuation;
  termsBindings: Map<string, V2TermsBinding>;
  acceptanceReceipts: Map<string, V2AcceptanceReceipt>;
};
/** All checkpoint fields describe the verified state BEFORE this command. */
export type V2ApplyContext = V2Checkpoint & { at: number };

export class V2WalletError extends Error {
  readonly code = "ALPHA_WALLET_V2_REJECTED";
  constructor(message: string) { super(message); this.name = "V2WalletError"; }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new V2WalletError(message); }
const clone = <T>(value: T): T => structuredClone(value);
const hex = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const safe = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const fixed = (value: bigint) => `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
const metadataKeys = ["engineVersion", "continuation", "termsBindings", "acceptanceReceipts"] as const;

export function isV2State(state: State | V2State): state is V2State {
  return (state as Partial<V2State>).engineVersion === WALLET_V2_ENGINE_VERSION;
}

/** Strip only v2 metadata before invoking the separately pinned inherited reducer. */
function baseState(state: V2State): State {
  const { engineVersion: _version, continuation: _continuation, termsBindings: _bindings, acceptanceReceipts: _receipts, ...base } = state;
  return clone(base);
}

function canonicalTerms(value: DevelopmentTradeTerms): DevelopmentTradeTerms {
  const terms = v2TermsSchema.parse(value);
  check(terms.sellerId !== terms.buyerId, "Terms participants must be distinct");
  check(terms.receivingNetwork === (terms.assetId === "tron-sim-usdt" ? "TRC20" : "BEP20"), "Terms asset and receiving network disagree");
  const prefix = `sim://${terms.assetId}/recipient/`;
  check(terms.destination.startsWith(prefix) && id(terms.destination.slice(prefix.length)), "Only the recorded same-asset simulation destination is supported");
  const micros = parseUnits(terms.usdtAmount, 6), price = parseUnits(terms.pricePerUsdt, 2);
  check(formatUnits(micros, 6) === terms.usdtAmount && terms.usdtAmount.split(".")[0]!.length <= 9,
    "Canonical six-decimal marketplace principal required");
  check(price > ZERO && terms.pricePerUsdt === fixed(price) && terms.pricePerUsdt.split(".")[0]!.length <= 7,
    "Canonical locked marketplace price required");
  if (terms.listingPriceAtRequest !== null) {
    const original = parseUnits(terms.listingPriceAtRequest, 2);
    check(original > ZERO && fixed(original) === terms.listingPriceAtRequest && terms.listingPriceAtRequest.split(".")[0]!.length <= 7,
      "Canonical original listing price required");
  }
  const quote = quoteTrade(terms.assetId, terms.usdtAmount, terms.pricePerUsdt);
  for (const key of ["principalRaw", "buyerFeeRaw", "sellerFeeRaw", "totalFeeRaw", "fiatTotalMinor"] as const) {
    check(parseRawUnits(terms[key]) === quote[key] && terms[key] === quote[key].toString(), "Terms do not match the exact wallet quote");
  }
  check(terms.fiatAmount === fixed(quote.fiatTotalMinor), "Canonical buyer-inclusive fiat total required");
  const contract = calculateTradeTermsQuote({ paymentMethod: terms.paymentMethod, currency: terms.currency,
    usdtAmount: terms.usdtAmount, fiatAmount: terms.fiatAmount, pricePerUsdt: terms.pricePerUsdt,
    feePolicyVersion: terms.feePolicyVersion }, "propose_amount", terms.usdtAmount);
  check(contract && contract.usdtAmount === terms.usdtAmount && contract.pricePerUsdt === terms.pricePerUsdt
    && parseUnits(contract.fiatAmount, 2) === quote.fiatTotalMinor, "Terms disagree with the current marketplace quote contract");
  return terms;
}

function sameTradeTerms(trade: Trade, terms: DevelopmentTradeTerms) {
  check(trade.listingId === terms.walletListingId && trade.sellerId === terms.sellerId && trade.buyerId === terms.buyerId
    && trade.assetId === terms.assetId && trade.currency === terms.currency && trade.destination === terms.destination
    && trade.amountRaw.toString() === terms.principalRaw && trade.buyerFeeRaw.toString() === terms.buyerFeeRaw
    && trade.sellerFeeRaw.toString() === terms.sellerFeeRaw && trade.totalFeeRaw.toString() === terms.totalFeeRaw
    && trade.fiatTotalMinor.toString() === terms.fiatTotalMinor, "Reservation and canonical bound terms disagree");
}

function cleanReservation(state: State, walletTradeId: string, terms: DevelopmentTradeTerms, expectedDigest: string) {
  const trade = state.trades.get(walletTradeId);
  check(trade && trade.id === walletTradeId, "Existing wallet reservation is required");
  check(walletDigest(trade) === expectedDigest, "Wallet reservation digest changed");
  sameTradeTerms(trade, terms);
  check(trade.status === "reserved" && trade.disputed === false && trade.evidence === undefined && trade.authorization === undefined
    && trade.payoutId === undefined && ![...state.evidenceOwners.values()].some(owner => owner === trade.id)
    && ![...state.payouts.values()].some(payout => payout.tradeId === trade.id)
    && ![...state.commissions.values()].some(commission => commission.tradeId === trade.id),
  "Payment, evidence, dispute or settlement progress locks the reservation");
  const listing = state.listings.get(trade.listingId);
  check(listing && listing.id === terms.walletListingId && listing.sellerId === terms.sellerId && listing.assetId === terms.assetId
    && listing.currency === terms.currency && listing.funded && listing.approved && !listing.closed,
  "Reservation requires its open, funded, owner-approved listing");
  check(fixed(parseUnits(listing.price, 2)) === terms.pricePerUsdt, "Reserved v1 listing price differs from the locked terms");
  return trade;
}

export function planningBindingFor(state: V2State, platformRequestId: string): DevelopmentTermsBinding {
  assertSimulationRuntime("simulation-only");
  check(isV2State(state) && state.termsBindings instanceof Map, "Versioned terms state is required");
  const binding = state.termsBindings.get(platformRequestId);
  check(binding, "Trade has no explicit versioned enrollment");
  return clone({ version: DEVELOPMENT_TERMS_BINDING_VERSION, platformRequestId: binding.platformRequestId,
    platformListingId: binding.platformListingId, walletListingId: binding.walletListingId, assetId: binding.assetId,
    revision: binding.revision, termsDigest: binding.termsDigest,
    reservation: { kind: "reserved" as const, walletTradeId: binding.walletTradeId, walletTradeDigest: binding.walletTradeDigest } });
}

/** Metadata supplements the unchanged base accounting invariants. */
export function assertV2Invariants(state: V2State) {
  assertSimulationRuntime("simulation-only");
  check(isV2State(state) && state.termsBindings instanceof Map && state.acceptanceReceipts instanceof Map, "Malformed v2 state");
  assertLedgerInvariants(state);
  const continuation = state.continuation;
  check(continuation && v2CheckpointSchema.safeParse(continuation.checkpoint).success
    && continuation.commandRevision === continuation.checkpoint.revision + 1 && typeof continuation.commandKey === "string",
  "Invalid version continuation metadata");
  const enrolledTrades = new Set<string>();
  for (const [requestId, binding] of state.termsBindings) {
    const terms = canonicalTerms(binding.terms);
    check(requestId === binding.platformRequestId && requestId === terms.platformRequestId && id(binding.walletTradeId)
      && binding.platformListingId === terms.platformListingId && binding.walletListingId === terms.walletListingId && binding.assetId === terms.assetId,
    "Invalid enrollment identity");
    check(!enrolledTrades.has(binding.walletTradeId), "A wallet trade cannot have multiple platform enrollments");
    enrolledTrades.add(binding.walletTradeId);
    check(walletDigest(terms) === binding.termsDigest && hex(binding.walletTradeDigest) && hex(binding.enrollmentTermsDigest), "Invalid enrollment digests");
    check(safe(binding.revision) && binding.revision <= 2 && safe(binding.lastSubmittedAdjustmentCount)
      && binding.lastSubmittedAdjustmentCount <= 2 && binding.lastSubmittedAdjustmentCount >= binding.revision,
    "Invalid enrollment terms revision or submitted adjustment count");
    check(safe(binding.enrollmentCommandRevision) && binding.enrollmentCommandRevision > continuation.commandRevision
      && safe(binding.lastCommandRevision) && binding.lastCommandRevision >= binding.enrollmentCommandRevision
      && typeof binding.enrollmentCommandKey === "string" && typeof binding.lastCommandKey === "string", "Invalid enrollment command linkage");
    const trade = state.trades.get(binding.walletTradeId);
    check(trade && trade.id === binding.walletTradeId, "Enrolled wallet trade is missing");
    sameTradeTerms(trade, terms);
    const receipts = [...state.acceptanceReceipts.values()].filter(receipt => receipt.platformRequestId === requestId)
      .sort((a, b) => a.bindingRevision - b.bindingRevision);
    check(receipts.length === binding.revision, "Enrollment and acceptance receipt counts disagree");
    let priorDigest = binding.enrollmentTermsDigest, priorCommand = binding.enrollmentCommandRevision;
    for (const [index, receipt] of receipts.entries()) {
      check(receipt.bindingRevision === index + 1 && receipt.priorTermsDigest === priorDigest && receipt.commandRevision > priorCommand,
        "Acceptance receipt history has a gap or conflicting prior terms");
      priorDigest = receipt.acceptedTermsDigest; priorCommand = receipt.commandRevision;
    }
    check(priorDigest === binding.termsDigest && priorCommand === binding.lastCommandRevision, "Latest enrollment disagrees with acceptance history");
    if (!binding.revision) check(binding.lastSubmittedAdjustmentCount === 0 && binding.lastCommandKey === binding.enrollmentCommandKey,
      "A new enrollment cannot invent acceptance history");
    else check(receipts[receipts.length - 1]!.commandKey === binding.lastCommandKey, "Latest enrollment command key changed");
  }
  for (const [key, receipt] of state.acceptanceReceipts) {
    const terms = canonicalTerms(receipt.terms), binding = state.termsBindings.get(receipt.platformRequestId);
    check(binding && receipt.platformRequestId === terms.platformRequestId && receipt.walletTradeId === binding.walletTradeId
      && receipt.actorUserId === terms.buyerId && id(receipt.proposalId), "Invalid acceptance receipt identity");
    check(key === receipt.acceptanceKey && key === walletDigest(["alpha-wallet-amount-acceptance", receipt.platformRequestId, receipt.proposalId]),
      "Invalid acceptance receipt key");
    check(receipt.acceptedTermsDigest === walletDigest(terms) && hex(receipt.priorTermsDigest) && hex(receipt.inputDigest)
      && hex(receipt.plannerInputDigest) && safe(receipt.acceptedAtMs) && safe(receipt.commandRevision) && receipt.commandRevision > 0
      && typeof receipt.commandKey === "string", "Invalid acceptance receipt evidence");
    check(/^(?:0|-?[1-9]\d{0,77})$/.test(receipt.principalDeltaRaw)
      && parseRawUnits(receipt.transferAmountRaw) === (BigInt(receipt.principalDeltaRaw) < ZERO ? -BigInt(receipt.principalDeltaRaw) : BigInt(receipt.principalDeltaRaw)),
    "Acceptance transfer amount differs from its signed delta");
  }
}

function acceptanceIdentity(input: V2AcceptanceInput) {
  return walletDigest(["alpha-wallet-amount-acceptance", input.platformRequestId, input.proposalId]);
}
function acceptanceDigest(command: V2CommandOf<"acceptAmountCorrection">) {
  return walletDigest({ actor: command.actor, input: command.input });
}

/**
 * Only exact previously recorded evidence is recoverable here. The current
 * platform authorization/ownership check remains the future coordinator's job.
 * A transport retry never supplies a new acceptance identity or financial effect.
 */
export function findV2AcceptanceReplay(state: State | V2State, input: V2Command): V2AcceptanceReceipt | undefined {
  assertSimulationRuntime("simulation-only");
  const command = parseV2Command(input);
  if (!isV2State(state) || command.type !== "acceptAmountCorrection") return undefined;
  assertV2Invariants(state);
  const receipt = state.acceptanceReceipts.get(acceptanceIdentity(command.input));
  if (!receipt) return undefined;
  check(command.actor.kind === "buyer" && command.actor.id === receipt.actorUserId
    && receipt.inputDigest === acceptanceDigest(command), "Acceptance identity reused with different actor or input");
  return clone(receipt);
}

function recordNewCommand(state: V2State, command: V2Command, result: unknown) {
  state.idempotency.set(`v2:${versionedCommandKey(command)}`, { fingerprint: walletDigest(command.input), result: clone(result) });
}

/**
 * Copy-on-write simulation reducer. Source digests are recorded evidence supplied
 * by a trusted fixture/coordinator, not independent proof of marketplace consent.
 * No public route, marketplace enrollment cutover, signer or provider lives here.
 */
export function applyV2Command(previous: State | V2State, input: V2Command, context: V2ApplyContext): { state: V2State; result: unknown } {
  assertSimulationRuntime("simulation-only");
  const command = parseV2Command(input);
  const checkpoint = v2CheckpointSchema.parse({ revision: context.revision, eventHash: context.eventHash,
    stateHash: context.stateHash, lastCommandAtMs: context.lastCommandAtMs });
  check(safe(context.at) && context.at >= checkpoint.lastCommandAtMs && checkpoint.revision < Number.MAX_SAFE_INTEGER,
    "Invalid v2 command clock or exhausted revision");
  check(walletDigest(previous) === checkpoint.stateHash, "Verified wallet state and checkpoint disagree");
  assertLedgerInvariants(previous);
  if (isV2State(previous)) {
    assertV2Invariants(previous);
    const acceptance = findV2AcceptanceReplay(previous, command);
    if (acceptance) return { state: clone(previous), result: acceptance };
    const prior = previous.idempotency.get(`v2:${versionedCommandKey(command)}`);
    if (prior) {
      check(prior.fingerprint === walletDigest(command.input), "Idempotency key reused with different payload");
      return { state: clone(previous), result: clone(prior.result) };
    }
  }
  if (command.type === "continueFromV1") {
    check(command.actor.kind === "operator", "Requires operator authority");
    check(!metadataKeys.some(key => Object.hasOwn(previous, key)), "The v1 to v2 continuation may occur only once");
    check(walletDigest(command.input.checkpoint) === walletDigest(checkpoint), "Continuation does not match the verified v1 checkpoint");
    const result: V2Continuation = { checkpoint: clone(checkpoint), commandRevision: checkpoint.revision + 1, commandKey: versionedCommandKey(command) };
    const state: V2State = { ...clone(previous), engineVersion: WALLET_V2_ENGINE_VERSION, continuation: clone(result),
      termsBindings: new Map(), acceptanceReceipts: new Map() };
    recordNewCommand(state, command, result); assertV2Invariants(state);
    return { state, result: clone(result) };
  }
  check(isV2State(previous), "Explicit v1 to v2 continuation is required before v2 operations");
  const state = clone(previous);
  let result: unknown;
  if (command.type === "enrollReservedTrade") {
    check(command.actor.kind === "operator", "Requires operator authority");
    check(state.haltReason === null, "Wallet paused");
    const enrollment = command.input, terms = canonicalTerms(enrollment.terms);
    check(walletDigest(enrollment.expectedWallet) === walletDigest(checkpoint), "Enrollment wallet checkpoint changed");
    check(walletDigest(terms) === enrollment.termsDigest, "Enrollment terms digest mismatch");
    cleanReservation(state, enrollment.walletTradeId, terms, enrollment.walletTradeDigest);
    check(!state.termsBindings.has(terms.platformRequestId)
      && ![...state.termsBindings.values()].some(binding => binding.walletTradeId === enrollment.walletTradeId), "Trade already has a versioned enrollment");
    const binding: V2TermsBinding = { platformRequestId: terms.platformRequestId, platformListingId: terms.platformListingId,
      walletListingId: terms.walletListingId, walletTradeId: enrollment.walletTradeId, assetId: terms.assetId,
      revision: 0, terms: clone(terms), termsDigest: enrollment.termsDigest, walletTradeDigest: enrollment.walletTradeDigest,
      enrollmentTermsDigest: enrollment.termsDigest, enrollmentCommandRevision: checkpoint.revision + 1,
      enrollmentCommandKey: versionedCommandKey(command), lastCommandRevision: checkpoint.revision + 1,
      lastCommandKey: versionedCommandKey(command), lastSubmittedAdjustmentCount: 0 };
    state.termsBindings.set(terms.platformRequestId, binding); result = binding;
    recordNewCommand(state, command, result);
  } else if (command.type === "acceptAmountCorrection") {
    check(command.actor.kind === "buyer", "Requires buyer authority");
    check(state.haltReason === null, "Wallet paused");
    const input = command.input, binding = state.termsBindings.get(input.platformRequestId);
    check(binding && binding.walletTradeId === input.walletTradeId, "Explicit matching reserved trade enrollment required");
    check(command.actor.id === binding.terms.buyerId, "Only the enrolled buyer can accept corrected terms");
    const conditions = input.preconditions;
    check(conditions.walletRevision === checkpoint.revision && conditions.walletEventHash === checkpoint.eventHash
      && conditions.walletStateDigest === checkpoint.stateHash, "Accepted plan wallet checkpoint changed");
    check(conditions.bindingRevision === binding.revision && input.priorTermsDigest === binding.termsDigest
      && conditions.bindingDigest === walletDigest(planningBindingFor(state, input.platformRequestId)), "Accepted plan enrollment changed");
    const trade = cleanReservation(state, input.walletTradeId, binding.terms, conditions.walletTradeDigest);
    check(binding.walletTradeDigest === conditions.walletTradeDigest, "Enrolled reservation snapshot changed");
    const accepted = canonicalTerms(input.acceptedTerms), acceptedDigest = walletDigest(accepted);
    const mutable = new Set<keyof DevelopmentTradeTerms>(["usdtAmount", "fiatAmount", "principalRaw", "buyerFeeRaw", "sellerFeeRaw", "totalFeeRaw", "fiatTotalMinor"]);
    check((Object.keys(binding.terms) as Array<keyof DevelopmentTradeTerms>).every(key => mutable.has(key) || accepted[key] === binding.terms[key]),
      "Amount correction cannot change locked price, identity, asset, destination, instructions or policy");
    check(input.plannerInputDigest === walletDigest({ actorUserId: command.actor.id, prior: binding.termsDigest,
      accepted: acceptedDigest, preconditions: conditions }), "Canonical planner input digest mismatch");
    check(input.submittedAdjustmentCount > binding.lastSubmittedAdjustmentCount && input.submittedAdjustmentCount <= 2,
      "Submitted amount proposal limit is exhausted or moved backwards");
    check(input.invalidatePreparedCardlessCredentials === (accepted.paymentMethod === "Cardless ATM Withdrawal" && accepted.fiatAmount !== binding.terms.fiatAmount),
      "Prepared cardless credential invalidation differs from accepted terms");
    const principal = BigInt(accepted.principalRaw), delta = principal - trade.amountRaw;
    if (delta > ZERO) check(![...state.commissions.values()].some(due => due.sellerId === trade.sellerId && !due.paid),
      "Unpaid commission blocks increased seller commitments");
    if (delta > ZERO) transfer(state, `v2:${versionedCommandKey(command)}`, trade.assetId, `listing:${trade.listingId}`, `trade:${trade.id}`, delta);
    else if (delta < ZERO) transfer(state, `v2:${versionedCommandKey(command)}`, trade.assetId, `trade:${trade.id}`, `listing:${trade.listingId}`, -delta);
    trade.amountRaw = principal; trade.buyerFeeRaw = BigInt(accepted.buyerFeeRaw); trade.sellerFeeRaw = BigInt(accepted.sellerFeeRaw);
    trade.totalFeeRaw = BigInt(accepted.totalFeeRaw); trade.fiatTotalMinor = BigInt(accepted.fiatTotalMinor);
    check(balance(state, trade.assetId, `trade:${trade.id}`) === principal, "Resized reservation is inconsistent");
    const receipt: V2AcceptanceReceipt = {
      acceptanceKey: acceptanceIdentity(input), platformRequestId: input.platformRequestId, proposalId: input.proposalId,
      actorUserId: command.actor.id, walletTradeId: trade.id, commandRevision: checkpoint.revision + 1,
      commandKey: versionedCommandKey(command), inputDigest: acceptanceDigest(command), plannerInputDigest: input.plannerInputDigest,
      priorTermsDigest: binding.termsDigest, acceptedTermsDigest: acceptedDigest, bindingRevision: binding.revision + 1,
      principalDeltaRaw: delta.toString(), transferAmountRaw: (delta < ZERO ? -delta : delta).toString(), terms: clone(accepted), acceptedAtMs: context.at,
    };
    state.acceptanceReceipts.set(receipt.acceptanceKey, receipt);
    state.termsBindings.set(binding.platformRequestId, { ...binding, revision: receipt.bindingRevision, terms: clone(accepted),
      termsDigest: acceptedDigest, walletTradeDigest: walletDigest(trade), lastCommandRevision: receipt.commandRevision,
      lastCommandKey: receipt.commandKey, lastSubmittedAdjustmentCount: input.submittedAdjustmentCount });
    result = receipt; recordNewCommand(state, command, result);
  } else {
    // A hydrated copy executes the exact inherited rules against the CURRENT
    // balances/trade amounts. Replaying v1 from genesis after resize would lose it.
    const kernel = createHydratedV2Kernel({ mode: "simulation-only", initialState: baseState(state), clock: () => context.at });
    const inherited = parseWalletCommand({ ...command, version: 1, engineVersion: WALLET_ENGINE_VERSION });
    result = applyWalletCommand(kernel, inherited);
    Object.assign(state, kernel.snapshot());
  }
  assertV2Invariants(state);
  return { state, result: clone(result) };
}
