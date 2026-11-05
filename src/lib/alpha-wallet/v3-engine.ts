import { calculateTradeTermsQuote } from "@alpha-traders/contracts";
import { formatUnits, parseRawUnits, parseUnits, quoteTrade, ZERO, type AssetId } from "./amounts";
import { walletDigest } from "./commands";
import { assertLedgerInvariants, balance, transfer } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import type { State, Trade } from "./types";
import { v2CheckpointSchema, WALLET_V2_ENGINE_VERSION, type V2Checkpoint } from "./v2-commands";
import { assertV2Invariants, isV2State, type V2State } from "./v2-engine";
import {
  initialPlannerDigest, parseV3Command, v3CommandKey, v3InitialInputSchema, v3InitialTermsSchema, WALLET_V3_ENGINE_VERSION,
  type V3Command, type V3InitialAcceptanceInput, type V3InitialTerms,
} from "./v3-commands";

export type V3Continuation = { checkpoint: V2Checkpoint; commandRevision: number; commandKey: string };
export type V3InitialBinding = {
  platformRequestId: string; platformTradeId: string; platformListingId: string; walletListingId: string; walletTradeId: string; assetId: AssetId;
  revision: 0; terms: V3InitialTerms; termsDigest: string; walletTradeDigest: string; acceptanceKey: string;
  commandRevision: number; commandKey: string; inputDigest: string; acceptedAtMs: number;
};
export type V3InitialAcceptanceReceipt = {
  acceptanceKey: string; platformRequestId: string; platformTradeId: string; actorUserId: string; buyerId: string; walletTradeId: string;
  commandRevision: number; commandKey: string; inputDigest: string; plannerInputDigest: string; termsDigest: string;
  principalRaw: string; transferAmountRaw: string; acceptedAtMs: number; input: V3InitialAcceptanceInput;
};
export type V3State = Omit<V2State, "engineVersion"> & {
  engineVersion: typeof WALLET_V3_ENGINE_VERSION;
  initialContinuation: V3Continuation;
  initialBindings: Map<string, V3InitialBinding>;
  initialAcceptanceReceipts: Map<string, V3InitialAcceptanceReceipt>;
};
export type V3ApplyContext = V2Checkpoint & { at: number };

export class V3WalletError extends Error {
  readonly code = "ALPHA_WALLET_V3_REJECTED";
  constructor(message: string) { super(message); this.name = "V3WalletError"; }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new V3WalletError(message); }
const clone = <T>(value: T): T => structuredClone(value);
const safe = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const fixed = (value: bigint) => `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
const initialKeys = ["initialContinuation", "initialBindings", "initialAcceptanceReceipts"] as const;
const baseKeys = ["accounts", "journal", "depositIntents", "deposits", "listings", "trades", "payouts", "commissions",
  "receipts", "evidenceOwners", "idempotency", "reconciliations", "gasReady", "haltReason", "engineVersion", "continuation", "termsBindings", "acceptanceReceipts"] as const;
function exactKeys(value: object, keys: readonly string[], message: string) {
  check(walletDigest(Object.keys(value).sort()) === walletDigest([...keys].sort()), message);
}
function commandKeyParts(key: string, kind: "seller" | "operator", type: "continueFromV2" | "acceptInitialSellerRequest") {
  let parts: unknown;
  try { parts = JSON.parse(key); } catch { throw new V3WalletError("Malformed v3 command identity"); }
  check(Array.isArray(parts) && parts.length === 4 && parts[0] === kind && id(parts[1]) && parts[2] === type && id(parts[3])
    && JSON.stringify(parts) === key, "Malformed v3 command identity");
  return parts as [typeof kind, string, typeof type, string];
}

export function isV3State(state: State | V2State | V3State): state is V3State {
  return (state as Partial<V3State>).engineVersion === WALLET_V3_ENGINE_VERSION;
}

/**
 * Explicit read-only accounting/old-metadata view for invariant and projection
 * verification. This is NOT an execution downgrade: no v2 command may run after
 * the v3 continuation. The original v2 reducer and its parser remain unchanged.
 */
export function baseV2StateForV3(state: V3State): V2State {
  assertSimulationRuntime("simulation-only");
  check(isV3State(state), "A v3 state is required for the explicit inherited view");
  const base = clone(state);
  for (const key of initialKeys) Reflect.deleteProperty(base, key);
  return { ...base, engineVersion: WALLET_V2_ENGINE_VERSION };
}

function canonicalTerms(value: V3InitialTerms): V3InitialTerms {
  const terms = v3InitialTermsSchema.parse(value);
  check(terms.sellerId !== terms.buyerId, "Initial terms participants must be distinct");
  check(terms.receivingNetwork === (terms.assetId === "tron-sim-usdt" ? "TRC20" : "BEP20"), "Initial terms asset and receiving network disagree");
  const prefix = `sim://${terms.assetId}/recipient/`;
  check(terms.destination.startsWith(prefix) && id(terms.destination.slice(prefix.length)), "Only a same-asset simulation destination is supported");
  const micros = parseUnits(terms.usdtAmount, 6), price = parseUnits(terms.pricePerUsdt, 2);
  check(formatUnits(micros, 6) === terms.usdtAmount && terms.usdtAmount.split(".")[0]!.length <= 9,
    "Canonical six-decimal marketplace principal required");
  check(price > ZERO && terms.pricePerUsdt === fixed(price) && terms.pricePerUsdt.split(".")[0]!.length <= 7
    && terms.listingPriceAtRequest === terms.pricePerUsdt, "The original request listing price must remain locked");
  const quote = quoteTrade(terms.assetId, terms.usdtAmount, terms.pricePerUsdt);
  for (const key of ["principalRaw", "buyerFeeRaw", "sellerFeeRaw", "totalFeeRaw", "fiatTotalMinor"] as const) {
    check(parseRawUnits(terms[key]) === quote[key] && terms[key] === quote[key].toString(), "Initial terms do not match the exact wallet quote");
  }
  check(terms.fiatAmount === fixed(quote.fiatTotalMinor), "Canonical buyer-inclusive fiat total required");
  const contract = calculateTradeTermsQuote({ paymentMethod: terms.paymentMethod, currency: terms.currency,
    usdtAmount: terms.usdtAmount, fiatAmount: terms.fiatAmount, pricePerUsdt: terms.pricePerUsdt,
    feePolicyVersion: terms.feePolicyVersion }, "propose_amount", terms.usdtAmount);
  check(contract && contract.usdtAmount === terms.usdtAmount && contract.pricePerUsdt === terms.pricePerUsdt
    && parseUnits(contract.fiatAmount, 2) === quote.fiatTotalMinor, "Initial terms disagree with the marketplace quote contract");
  return terms;
}

function validateInitialEvidence(value: V3InitialAcceptanceInput, sellerId: string) {
  const input = v3InitialInputSchema.parse(value), terms = canonicalTerms(input.terms);
  const action = input.sellerAction, buyer = input.buyerRequestEvidence, reservation = input.reservation, conditions = input.preconditions;
  check(sellerId === terms.sellerId && action.requestedByUserId === sellerId && action.requestId === terms.platformRequestId,
    "Only the recorded seller can accept this buyer request");
  check(input.acceptanceKey === walletDigest(["alpha-wallet-initial-seller-acceptance-v1", terms.platformRequestId, sellerId]),
    "Initial acceptance business identity changed");
  check(input.termsDigest === walletDigest(terms) && buyer.termsDigest === input.termsDigest
    && buyer.requestId === terms.platformRequestId && buyer.tradeId === terms.platformTradeId && buyer.buyerId === terms.buyerId
    && buyer.requestDigest === conditions.requestDigest && buyer.feePolicyVersion === terms.feePolicyVersion
    && buyer.commissionCalculationVersion === terms.commissionCalculationVersion,
  "Retained buyer request and accepted terms disagree");
  check(Date.parse(buyer.createdAt) <= Date.parse(conditions.requestUpdatedAt), "Retained request chronology moved backwards");
  check(action.faceToFaceSafetyAcknowledged === (terms.paymentMethod === "Face-to-Face (Meet in Person)"),
    "The seller safety action must match the supported payment method");
  check(reservation.assetId === terms.assetId && reservation.walletListingId === terms.walletListingId
    && reservation.principalRaw === terms.principalRaw && reservation.transferAmountRaw === terms.principalRaw
    && reservation.fromAccount === `listing:${terms.walletListingId}` && reservation.toAccount === `trade:${reservation.walletTradeId}`
    && reservation.expectedListingAvailableRaw === reservation.availableForRequestRaw,
  "The initial reservation must move the exact full principal between its mapped accounts");
  const listingPrice = parseUnits(input.pricing.walletListingPrice, 2);
  check(listingPrice > ZERO && input.pricing.requiresFrozenPriceTransition === (listingPrice !== parseUnits(terms.pricePerUsdt, 2)),
    "Recorded wallet price and frozen-price transition disagree");
  check(input.plannerInputDigest === initialPlannerDigest(input, sellerId), "Initial acceptance planner input digest mismatch");
  return input;
}

function initialTrade(input: V3InitialAcceptanceInput): Trade {
  const terms = input.terms;
  return { id: input.reservation.walletTradeId, listingId: terms.walletListingId, sellerId: terms.sellerId, buyerId: terms.buyerId,
    assetId: terms.assetId, destination: terms.destination, amountRaw: BigInt(terms.principalRaw), buyerFeeRaw: BigInt(terms.buyerFeeRaw),
    sellerFeeRaw: BigInt(terms.sellerFeeRaw), totalFeeRaw: BigInt(terms.totalFeeRaw), fiatTotalMinor: BigInt(terms.fiatTotalMinor), currency: "ILS",
    status: "reserved", disputed: false };
}
function inputDigest(input: V3InitialAcceptanceInput, sellerId: string) {
  return walletDigest({ actor: { kind: "seller", id: sellerId }, input });
}
function recordNewCommand(state: V3State, command: V3Command, result: unknown) {
  state.idempotency.set(`v3:${v3CommandKey(command)}`, { fingerprint: walletDigest(command.input), result: clone(result) });
}

/** The third contract can add an initial reservation or pause; no later lifecycle exists here. */
export function assertV3Invariants(state: V3State) {
  assertSimulationRuntime("simulation-only");
  check(isV3State(state) && state.initialBindings instanceof Map && state.initialAcceptanceReceipts instanceof Map, "Malformed v3 state");
  exactKeys(state, [...baseKeys, ...initialKeys], "Unknown or incomplete v3 state metadata");
  assertV2Invariants(baseV2StateForV3(state));
  const continuation = state.initialContinuation;
  check(continuation && v2CheckpointSchema.safeParse(continuation.checkpoint).success
    && continuation.commandRevision === continuation.checkpoint.revision + 1
    && continuation.checkpoint.revision >= state.continuation.commandRevision, "Invalid v3 continuation checkpoint");
  exactKeys(continuation, ["checkpoint", "commandRevision", "commandKey"], "Unknown v3 continuation evidence");
  commandKeyParts(continuation.commandKey, "operator", "continueFromV2");
  const continuationReplay = state.idempotency.get(`v3:${continuation.commandKey}`);
  check(continuationReplay && continuationReplay.fingerprint === walletDigest({ checkpoint: continuation.checkpoint })
    && walletDigest(continuationReplay.result) === walletDigest(continuation), "V3 continuation and replay evidence disagree");
  check([...state.termsBindings.values()].every(binding => binding.lastCommandRevision <= continuation.checkpoint.revision)
    && [...state.acceptanceReceipts.values()].every(receipt => receipt.commandRevision <= continuation.checkpoint.revision),
  "Legacy v2 metadata cannot acquire new operations after continuation");
  check(state.initialBindings.size === state.initialAcceptanceReceipts.size, "Initial bindings and receipt counts disagree");
  const trades = new Set<string>(), platformTrades = new Set<string>(), revisions = new Set<number>(), keys = new Set<string>();
  for (const [requestId, binding] of state.initialBindings) {
    exactKeys(binding, ["platformRequestId", "platformTradeId", "platformListingId", "walletListingId", "walletTradeId", "assetId",
      "revision", "terms", "termsDigest", "walletTradeDigest", "acceptanceKey", "commandRevision", "commandKey", "inputDigest", "acceptedAtMs"],
    "Unknown or incomplete initial binding");
    const receipt = state.initialAcceptanceReceipts.get(binding.acceptanceKey);
    check(receipt, "Initial binding lacks its immutable receipt");
    exactKeys(receipt, ["acceptanceKey", "platformRequestId", "platformTradeId", "actorUserId", "buyerId", "walletTradeId", "commandRevision",
      "commandKey", "inputDigest", "plannerInputDigest", "termsDigest", "principalRaw", "transferAmountRaw", "acceptedAtMs", "input"],
    "Unknown or incomplete initial receipt");
    const input = validateInitialEvidence(receipt.input, receipt.actorUserId), terms = input.terms;
    const commandParts = commandKeyParts(receipt.commandKey, "seller", "acceptInitialSellerRequest");
    check(requestId === binding.platformRequestId && requestId === terms.platformRequestId && binding.revision === 0
      && binding.platformTradeId === terms.platformTradeId && binding.platformListingId === terms.platformListingId
      && binding.walletListingId === terms.walletListingId && binding.walletTradeId === input.reservation.walletTradeId && binding.assetId === terms.assetId
      && !trades.has(binding.walletTradeId) && !platformTrades.has(binding.platformTradeId), "Invalid or duplicate initial identity binding");
    trades.add(binding.walletTradeId); platformTrades.add(binding.platformTradeId);
    check(!state.termsBindings.has(requestId) && ![...state.termsBindings.values()].some(old => old.walletTradeId === binding.walletTradeId
      || old.terms.platformTradeId === binding.platformTradeId), "An initial reservation cannot alias a legacy enrollment");
    check(receipt.acceptanceKey === input.acceptanceKey && receipt.platformRequestId === requestId
      && receipt.platformTradeId === binding.platformTradeId && receipt.walletTradeId === binding.walletTradeId
      && receipt.buyerId === terms.buyerId && commandParts[1] === receipt.actorUserId
      && receipt.inputDigest === inputDigest(input, receipt.actorUserId) && receipt.plannerInputDigest === input.plannerInputDigest
      && receipt.termsDigest === input.termsDigest && receipt.principalRaw === terms.principalRaw && receipt.transferAmountRaw === terms.principalRaw,
    "Initial receipt and original command evidence disagree");
    check(safe(receipt.commandRevision) && receipt.commandRevision > continuation.commandRevision
      && receipt.commandRevision === input.preconditions.walletRevision + 1
      && !revisions.has(receipt.commandRevision) && !keys.has(receipt.commandKey)
      && safe(receipt.acceptedAtMs) && Number.isFinite(new Date(receipt.acceptedAtMs).getTime())
      && receipt.acceptedAtMs > Date.parse(input.preconditions.requestUpdatedAt), "Invalid initial receipt chronology");
    revisions.add(receipt.commandRevision); keys.add(receipt.commandKey);
    check(binding.commandRevision === receipt.commandRevision && binding.commandKey === receipt.commandKey
      && binding.inputDigest === receipt.inputDigest && binding.acceptedAtMs === receipt.acceptedAtMs
      && binding.termsDigest === input.termsDigest && walletDigest(binding.terms) === input.termsDigest,
    "Initial binding and receipt terms disagree");
    const trade = state.trades.get(binding.walletTradeId), expected = initialTrade(input);
    check(trade && walletDigest(trade) === walletDigest(expected) && binding.walletTradeDigest === walletDigest(trade),
      "Initial reservation has unsupported terms or lifecycle progress");
    const listing = state.listings.get(binding.walletListingId);
    check(listing && listing.id === terms.walletListingId && listing.sellerId === terms.sellerId && listing.assetId === terms.assetId
      && listing.currency === terms.currency && listing.funded && listing.approved && !listing.closed
      && walletDigest(listing) === input.preconditions.walletListingDigest && listing.price === input.pricing.walletListingPrice,
    "An initial binding requires its unchanged approved funding listing");
    check(![...state.payouts.values()].some(payout => payout.tradeId === trade.id)
      && ![...state.commissions.values()].some(due => due.tradeId === trade.id)
      && ![...state.evidenceOwners.values()].includes(trade.id), "An initial reservation cannot acquire unsupported payout or evidence history");
    const journals = state.journal.filter(journal => journal.operation === `v3:${receipt.commandKey}`);
    check(journals.length === 1 && journals[0]!.assetId === terms.assetId
      && walletDigest(journals[0]!.entries) === walletDigest([{ account: `listing:${terms.walletListingId}`, delta: -BigInt(terms.principalRaw) },
        { account: `trade:${trade.id}`, delta: BigInt(terms.principalRaw) }]), "Initial receipt lacks its exact principal journal");
    const replay = state.idempotency.get(`v3:${receipt.commandKey}`);
    check(replay && replay.fingerprint === walletDigest(input) && walletDigest(replay.result) === walletDigest(receipt),
      "Initial receipt and replay evidence disagree");
  }
  for (const [key, receipt] of state.initialAcceptanceReceipts) {
    check(key === receipt.acceptanceKey && state.initialBindings.get(receipt.platformRequestId)?.acceptanceKey === key,
      "Orphaned or aliased initial acceptance receipt");
  }
  check(state.journal.filter(journal => journal.operation.startsWith("v3:")).length === state.initialBindings.size,
    "Unexpected v3 financial journal without an initial binding");
}

/** Current platform/session authority is deliberately not inferred from a historic receipt. */
export function findV3InitialAcceptanceReplay(state: State | V2State | V3State, value: V3Command): V3InitialAcceptanceReceipt | undefined {
  assertSimulationRuntime("simulation-only");
  const command = parseV3Command(value);
  if (!isV3State(state) || command.type !== "acceptInitialSellerRequest") return undefined;
  assertV3Invariants(state);
  const receipt = state.initialAcceptanceReceipts.get(command.input.acceptanceKey);
  if (!receipt) return undefined;
  check(command.actor.kind === "seller" && command.actor.id === receipt.actorUserId
    && receipt.inputDigest === inputDigest(command.input, command.actor.id), "Initial acceptance identity reused with different actor or input");
  return clone(receipt);
}

/**
 * Copy-on-write, simulation-only seller-native reducer. Source digests are
 * recorded facts supplied by a trusted fixture/future coordinator, not proof of
 * authentication, complete canonical reads or permission to expose a route.
 */
export function applyV3Command(previous: State | V2State | V3State, value: V3Command, context: V3ApplyContext): { state: V3State; result: unknown } {
  assertSimulationRuntime("simulation-only");
  const command = parseV3Command(value), checkpoint = v2CheckpointSchema.parse({ revision: context.revision, eventHash: context.eventHash,
    stateHash: context.stateHash, lastCommandAtMs: context.lastCommandAtMs });
  check(safe(context.at) && Number.isFinite(new Date(context.at).getTime()) && context.at >= checkpoint.lastCommandAtMs
    && checkpoint.revision < Number.MAX_SAFE_INTEGER, "Invalid v3 command clock or exhausted revision");
  check(walletDigest(previous) === checkpoint.stateHash, "Verified wallet state and checkpoint disagree");
  if (isV3State(previous)) {
    assertV3Invariants(previous);
    const replay = findV3InitialAcceptanceReplay(previous, command);
    if (replay) return { state: clone(previous), result: replay };
    const prior = previous.idempotency.get(`v3:${v3CommandKey(command)}`);
    if (prior) {
      check(prior.fingerprint === walletDigest(command.input), "Idempotency key reused with different payload");
      return { state: clone(previous), result: clone(prior.result) };
    }
  }
  if (command.type === "continueFromV2") {
    check(command.actor.kind === "operator", "Requires operator authority");
    check(isV2State(previous) && !initialKeys.some(key => Object.hasOwn(previous, key)), "The explicit v2 to v3 continuation may occur only once");
    exactKeys(previous, baseKeys, "A complete known v2 state is required for continuation");
    assertV2Invariants(previous);
    check(walletDigest(command.input.checkpoint) === walletDigest(checkpoint), "Continuation does not match the verified v2 checkpoint");
    const result: V3Continuation = { checkpoint: clone(checkpoint), commandRevision: checkpoint.revision + 1, commandKey: v3CommandKey(command) };
    const state: V3State = { ...clone(previous), engineVersion: WALLET_V3_ENGINE_VERSION, initialContinuation: clone(result),
      initialBindings: new Map(), initialAcceptanceReceipts: new Map() };
    recordNewCommand(state, command, result); assertV3Invariants(state);
    return { state, result: clone(result) };
  }
  check(isV3State(previous), "Explicit v2 to v3 continuation is required before seller-native operations");
  const state = clone(previous);
  if (command.type === "pause") {
    check(command.actor.kind === "operator", "Requires operator authority");
    state.haltReason = "Operator emergency pause";
    const result = { halted: true as const };
    recordNewCommand(state, command, result); assertV3Invariants(state);
    return { state, result };
  }
  check(command.actor.kind === "seller", "Requires actual seller authority");
  check(state.haltReason === null, "Wallet paused");
  const input = validateInitialEvidence(command.input, command.actor.id), terms = input.terms;
  const conditions = input.preconditions, reservation = input.reservation;
  check(conditions.walletRevision === checkpoint.revision && conditions.walletEventHash === checkpoint.eventHash
    && conditions.walletStateDigest === checkpoint.stateHash, "Initial acceptance wallet checkpoint changed");
  check(context.at > Date.parse(conditions.requestUpdatedAt), "Initial acceptance clock must follow retained request evidence");
  check(!state.initialBindings.has(terms.platformRequestId) && !state.termsBindings.has(terms.platformRequestId)
    && !state.initialAcceptanceReceipts.has(input.acceptanceKey)
    && ![...state.initialBindings.values()].some(binding => binding.walletTradeId === reservation.walletTradeId || binding.platformTradeId === terms.platformTradeId)
    && ![...state.termsBindings.values()].some(binding => binding.walletTradeId === reservation.walletTradeId || binding.terms.platformTradeId === terms.platformTradeId),
  "The initial request or trade already has an immutable binding");
  check(!state.trades.has(reservation.walletTradeId) && ![...state.payouts.values()].some(payout => payout.tradeId === reservation.walletTradeId)
    && ![...state.commissions.values()].some(due => due.tradeId === reservation.walletTradeId)
    && ![...state.evidenceOwners.values()].includes(reservation.walletTradeId), "The initial wallet trade identity already has history");
  const listing = state.listings.get(terms.walletListingId);
  check(listing && listing.id === terms.walletListingId && listing.sellerId === command.actor.id && listing.assetId === terms.assetId
    && listing.currency === terms.currency && listing.funded && listing.approved && !listing.closed,
  "Initial acceptance requires its open, funded, owner-approved seller listing");
  check(walletDigest(listing) === conditions.walletListingDigest && listing.price === input.pricing.walletListingPrice,
    "Initial acceptance wallet listing changed");
  const active = [...state.trades.values()].filter(trade => !["completed", "cancelled"].includes(trade.status));
  check(!active.some(trade => trade.sellerId === terms.sellerId), "Active seller wallet trades require complete canonical identity mappings");
  check(!active.some(trade => trade.buyerId === terms.buyerId), "The buyer already has an active wallet trade");
  check(![...state.trades.values()].some(trade => trade.listingId === terms.walletListingId && trade.status !== "cancelled"),
    "Prior trade history on this listing requires complete canonical identity mappings");
  check(![...state.commissions.values()].some(due => [terms.sellerId, terms.buyerId].includes(due.sellerId) && due.paid !== true),
    "Unpaid commission prevents a new commitment");
  const available = balance(state, terms.assetId, `listing:${listing.id}`), principal = BigInt(terms.principalRaw);
  check(available.toString() === reservation.expectedListingAvailableRaw && available === listing.amountRaw && principal <= available,
    "The full initial principal is no longer available");
  check([...state.accounts].every(([key, amount]) => !key.endsWith(`|trade:${reservation.walletTradeId}`) || amount === ZERO),
    "The initial trade account already contains principal");
  const trade = initialTrade(input);
  transfer(state, `v3:${v3CommandKey(command)}`, terms.assetId, `listing:${listing.id}`, `trade:${trade.id}`, principal);
  state.trades.set(trade.id, trade);
  const receipt: V3InitialAcceptanceReceipt = { acceptanceKey: input.acceptanceKey, platformRequestId: terms.platformRequestId,
    platformTradeId: terms.platformTradeId, actorUserId: command.actor.id, buyerId: terms.buyerId, walletTradeId: trade.id,
    commandRevision: checkpoint.revision + 1, commandKey: v3CommandKey(command), inputDigest: inputDigest(input, command.actor.id),
    plannerInputDigest: input.plannerInputDigest, termsDigest: input.termsDigest, principalRaw: terms.principalRaw,
    transferAmountRaw: terms.principalRaw, acceptedAtMs: context.at, input: clone(input) };
  const binding: V3InitialBinding = { platformRequestId: terms.platformRequestId, platformTradeId: terms.platformTradeId,
    platformListingId: terms.platformListingId, walletListingId: terms.walletListingId, walletTradeId: trade.id, assetId: terms.assetId,
    revision: 0, terms: clone(terms), termsDigest: input.termsDigest, walletTradeDigest: walletDigest(trade), acceptanceKey: input.acceptanceKey,
    commandRevision: receipt.commandRevision, commandKey: receipt.commandKey, inputDigest: receipt.inputDigest, acceptedAtMs: context.at };
  state.initialBindings.set(terms.platformRequestId, binding); state.initialAcceptanceReceipts.set(receipt.acceptanceKey, receipt);
  recordNewCommand(state, command, receipt); assertLedgerInvariants(state); assertV3Invariants(state);
  return { state, result: clone(receipt) };
}
