import { parseRawUnits, ZERO } from "./amounts";
import { walletDigest } from "./commands";
import { accountKey, assertLedgerInvariants, balance } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import type { Actor, State } from "./types";
import { v2CheckpointSchema, type V2Checkpoint } from "./v2-commands";
import type { V2State } from "./v2-engine";
import type { V3InitialBinding, V3State } from "./v3-engine";
import { WALLET_V4_ENGINE_VERSION } from "./v4-commands";
import { assertV4Invariants, isV4State, type V4State } from "./v4-engine";
import {
  disputeFreezePlannerDigest, parseV5Command, paymentClaimPlannerDigest, v5CommandKey,
  v5DisputeFreezeInputSchema, v5DisputeFreezeKey, v5PaymentClaimInputSchema, v5PaymentClaimKey,
  WALLET_V5_ENGINE_VERSION, type V5Command, type V5InitialDisputeFreezeInput, type V5InitialPaymentClaimInput,
} from "./v5-commands";

export type V5Continuation = { checkpoint: V2Checkpoint; commandRevision: number; commandKey: string; sourceHaltReason: string | null };
type ReceiptBasis = {
  platformRequestId: string; platformTradeId: string; platformListingId: string; walletTradeId: string; walletListingId: string;
  acceptanceKey: string; actorUserId: string; actorKind: "buyer"; commandRevision: number; commandKey: string;
  inputDigest: string; plannerInputDigest: string; termsDigest: string; principalRaw: string; transferAmountRaw: "0";
};
export type V5InitialPaymentClaimReceipt = ReceiptBasis & {
  claimKey: string; claimedAtMs: number; input: V5InitialPaymentClaimInput;
};
export type V5InitialDisputeFreezeReceipt = ReceiptBasis & {
  disputeKey: string; claimKey: string; disputedAtMs: number; input: V5InitialDisputeFreezeInput;
};
export type V5State = Omit<V4State, "engineVersion"> & {
  engineVersion: typeof WALLET_V5_ENGINE_VERSION;
  paymentContinuation: V5Continuation;
  initialPaymentClaimReceipts: Map<string, V5InitialPaymentClaimReceipt>;
  initialDisputeFreezeReceipts: Map<string, V5InitialDisputeFreezeReceipt>;
};
export type V5ApplyContext = V2Checkpoint & { at: number };
type LifecycleInput = V5InitialPaymentClaimInput | V5InitialDisputeFreezeInput;
type LifecycleReceipt = V5InitialPaymentClaimReceipt | V5InitialDisputeFreezeReceipt;

export class V5WalletError extends Error {
  readonly code = "ALPHA_WALLET_V5_REJECTED";
  constructor(message: string) { super(message); this.name = "V5WalletError"; }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new V5WalletError(message); }
const clone = <T>(value: T): T => structuredClone(value);
const safe = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const v4Keys = ["accounts", "journal", "depositIntents", "deposits", "listings", "trades", "payouts", "commissions", "receipts",
  "evidenceOwners", "idempotency", "reconciliations", "gasReady", "haltReason", "engineVersion", "continuation", "termsBindings",
  "acceptanceReceipts", "initialContinuation", "initialBindings", "initialAcceptanceReceipts", "cancellationContinuation", "initialCancellationReceipts"] as const;
const v5Keys = ["paymentContinuation", "initialPaymentClaimReceipts", "initialDisputeFreezeReceipts"] as const;
const receiptBasisKeys = ["platformRequestId", "platformTradeId", "platformListingId", "walletTradeId", "walletListingId", "acceptanceKey",
  "actorUserId", "actorKind", "commandRevision", "commandKey", "inputDigest", "plannerInputDigest", "termsDigest", "principalRaw", "transferAmountRaw", "input"] as const;
function exactKeys(value: object, keys: readonly string[], message: string) {
  check(walletDigest(Object.keys(value).sort()) === walletDigest([...keys].sort()), message);
}
function commandKeyParts(key: string) {
  let parts: unknown;
  try { parts = JSON.parse(key); } catch { throw new V5WalletError("Malformed v5 command identity"); }
  check(Array.isArray(parts) && parts.length === 4 && ["buyer", "operator"].includes(parts[0]) && id(parts[1])
    && ["continueFromV4", "claimInitialPayment", "freezeInitialDispute", "pause"].includes(parts[2]) && id(parts[3])
    && JSON.stringify(parts) === key, "Malformed v5 command identity");
  const result = parts as ["buyer" | "operator", string, V5Command["type"], string];
  check(["claimInitialPayment", "freezeInitialDispute"].includes(result[2]) ? result[0] === "buyer" : result[0] === "operator",
    "Invalid v5 command actor");
  return result;
}
function inputDigest(input: LifecycleInput, actor: Pick<Actor, "kind" | "id">) { return walletDigest({ actor, input }); }
function record(state: V5State, command: V5Command, result: unknown) {
  state.idempotency.set(`v5:${v5CommandKey(command)}`, { fingerprint: walletDigest(command.input), result: clone(result) });
}
export function isV5State(state: State | V2State | V3State | V4State | V5State): state is V5State {
  return (state as Partial<V5State>).engineVersion === WALLET_V5_ENGINE_VERSION;
}

/** Recorded assertions bind an original acceptance; the authenticated coordinator establishes their origin. */
function validateShared(state: Pick<V4State, "initialBindings" | "initialAcceptanceReceipts" | "initialCancellationReceipts">,
  input: LifecycleInput, actor: Actor, at: number) {
  const terms = input.terms, original = input.originalAcceptance, conditions = input.preconditions;
  const binding = state.initialBindings.get(terms.platformRequestId), accepted = state.initialAcceptanceReceipts.get(original.acceptanceKey);
  check(binding && accepted, "The exact original initial acceptance is required");
  check(actor.kind === "buyer" && actor.id === terms.buyerId && actor.id !== terms.sellerId, "Only the original buyer can claim payment or open its dispute");
  check(input.termsDigest === walletDigest(terms) && input.termsDigest === binding.termsDigest
    && walletDigest(terms) === walletDigest(binding.terms), "Payment lifecycle must retain the original initial terms");
  check(original.acceptanceKey === binding.acceptanceKey && original.commandRevision === accepted.commandRevision
    && original.commandKey === accepted.commandKey && original.receiptDigest === walletDigest(accepted)
    && original.bindingDigest === walletDigest(binding), "Original acceptance identity or evidence changed");
  check(![...state.initialCancellationReceipts.values()].some(receipt => receipt.walletTradeId === binding.walletTradeId),
    "A cancelled original trade remains archival in the payment profile");
  check(conditions.walletListingDigest === accepted.input.preconditions.walletListingDigest,
    "Payment lifecycle listing basis changed");
  check(safe(at) && Number.isFinite(new Date(at).getTime()) && at > accepted.acceptedAtMs
    && Date.parse(conditions.requestUpdatedAt) >= accepted.acceptedAtMs && at > Date.parse(conditions.requestUpdatedAt),
  "Payment lifecycle clock must follow the accepted canonical request");
  const held = input.principalHold, principal = parseRawUnits(terms.principalRaw);
  check(principal > ZERO && held.assetId === binding.assetId && held.walletTradeId === binding.walletTradeId
    && held.walletListingId === binding.walletListingId && held.principalRaw === terms.principalRaw
    && held.transferAmountRaw === "0" && held.expectedTradeReservedRaw === terms.principalRaw,
  "Payment lifecycle must retain the exact full principal in the original trade");
  parseRawUnits(held.expectedListingAvailableRaw);
  return { binding, accepted };
}
function validateClaim(state: V4State | V5State, value: V5InitialPaymentClaimInput, actor: Actor) {
  const input = v5PaymentClaimInputSchema.parse(value), retained = validateShared(state, input, actor, input.claimedAtMs);
  check(input.claimKey === v5PaymentClaimKey(input.terms.platformRequestId, retained.binding.acceptanceKey), "Payment claim business identity changed");
  check(input.preconditions.canonicalStatus === "accepted", "A buyer payment claim requires the accepted canonical status");
  check(input.claim.buyerId === actor.id && input.claim.amountMinor === input.terms.fiatTotalMinor
    && input.claim.currency === input.terms.currency, "Buyer claim must acknowledge the full original fiat amount including buyer fee");
  check(input.terms.paymentMethod === "Bank Transfer" ? input.claim.proof !== null : input.claim.proof === null,
    "Bank claims require their exact safe upload reference; in-person cash claims have no uploaded proof");
  check(input.plannerInputDigest === paymentClaimPlannerDigest(input, actor.id), "Payment claim planner input digest mismatch");
  return { input, ...retained };
}
function validateDispute(state: V5State, value: V5InitialDisputeFreezeInput, actor: Actor) {
  const input = v5DisputeFreezeInputSchema.parse(value), retained = validateShared(state, input, actor, input.disputedAtMs);
  check(input.disputeKey === v5DisputeFreezeKey(input.terms.platformRequestId, retained.binding.acceptanceKey), "Dispute freeze business identity changed");
  check(input.preconditions.canonicalStatus === "payment_sent", "A dispute requires the exact buyer payment claim first");
  const claim = state.initialPaymentClaimReceipts.get(input.priorClaim.claimKey);
  check(claim && claim.claimKey === v5PaymentClaimKey(input.terms.platformRequestId, retained.binding.acceptanceKey)
    && claim.commandRevision === input.priorClaim.commandRevision && walletDigest(claim) === input.priorClaim.receiptDigest
    && claim.actorUserId === actor.id && claim.walletTradeId === retained.binding.walletTradeId
    && claim.termsDigest === input.termsDigest && input.disputedAtMs > claim.claimedAtMs
    && Date.parse(input.preconditions.requestUpdatedAt) >= claim.claimedAtMs,
  "Dispute must bind the exact original buyer claim and its immutable receipt");
  check(input.plannerInputDigest === disputeFreezePlannerDigest(input, actor.id), "Dispute freeze planner input digest mismatch");
  return { input, claim, ...retained };
}
function validateReservation(state: V5State, input: LifecycleInput, binding: V3InitialBinding, expectedStatus: "reserved" | "payment_reported") {
  const trade = state.trades.get(binding.walletTradeId), listing = state.listings.get(binding.walletListingId), held = input.principalHold;
  check(trade && trade.status === expectedStatus && !trade.disputed && !trade.evidence && !trade.authorization && !trade.payoutId
    && walletDigest(trade) === input.preconditions.walletTradeDigest
    && walletDigest({ ...trade, status: "reserved", disputed: false }) === binding.walletTradeDigest,
  "Payment lifecycle requires its exact original reservation without independent evidence or release progress");
  check(listing && listing.approved && listing.funded && !listing.closed && walletDigest(listing) === input.preconditions.walletListingDigest,
    "Payment lifecycle requires its unchanged open funded approved listing");
  check(![...state.payouts.values()].some(payout => payout.tradeId === trade.id)
    && ![...state.commissions.values()].some(due => due.tradeId === trade.id)
    && ![...state.evidenceOwners.values()].includes(trade.id), "Original reservation has unsupported evidence or settlement history");
  check(balance(state, held.assetId, `trade:${trade.id}`).toString() === held.expectedTradeReservedRaw
    && balance(state, held.assetId, `listing:${listing.id}`).toString() === held.expectedListingAvailableRaw,
  "Payment lifecycle full principal or listing balance changed");
  check([...state.accounts].every(([key, amount]) => !key.endsWith(`|trade:${trade.id}`)
    || key === accountKey(held.assetId, `trade:${trade.id}`) || amount === ZERO), "Initial trade contains another asset");
  return trade;
}
function receiptBasis(input: LifecycleInput, binding: V3InitialBinding, actorUserId: string, commandRevision: number, commandKey: string): ReceiptBasis {
  return { platformRequestId: binding.platformRequestId, platformTradeId: binding.platformTradeId, platformListingId: binding.platformListingId,
    walletTradeId: binding.walletTradeId, walletListingId: binding.walletListingId, acceptanceKey: binding.acceptanceKey,
    actorUserId, actorKind: "buyer", commandRevision, commandKey, inputDigest: inputDigest(input, { kind: "buyer", id: actorUserId }),
    plannerInputDigest: input.plannerInputDigest, termsDigest: input.termsDigest, principalRaw: input.principalHold.principalRaw, transferAmountRaw: "0" };
}
function claimedReceipt(input: V5InitialPaymentClaimInput, binding: V3InitialBinding, actorUserId: string, revision: number, key: string): V5InitialPaymentClaimReceipt {
  return { ...receiptBasis(input, binding, actorUserId, revision, key), claimKey: input.claimKey, claimedAtMs: input.claimedAtMs, input: clone(input) };
}
function disputedReceipt(input: V5InitialDisputeFreezeInput, binding: V3InitialBinding, actorUserId: string, revision: number, key: string): V5InitialDisputeFreezeReceipt {
  return { ...receiptBasis(input, binding, actorUserId, revision, key), disputeKey: input.disputeKey,
    claimKey: input.priorClaim.claimKey, disputedAtMs: input.disputedAtMs, input: clone(input) };
}

/** Reverse only V5 status/flag evidence. The exact original V4 source still passes its unchanged invariants. */
function validatedSourceV4(state: V5State): V4State {
  assertSimulationRuntime("simulation-only");
  check(isV5State(state) && state.initialPaymentClaimReceipts instanceof Map && state.initialDisputeFreezeReceipts instanceof Map
    && state.idempotency instanceof Map, "Malformed v5 state");
  exactKeys(state, [...v4Keys, ...v5Keys], "Unknown or incomplete v5 state metadata");
  const continuation = state.paymentContinuation;
  check(continuation && v2CheckpointSchema.safeParse(continuation.checkpoint).success && safe(continuation.commandRevision)
    && continuation.commandRevision === continuation.checkpoint.revision + 1
    && (continuation.sourceHaltReason === null || (typeof continuation.sourceHaltReason === "string" && continuation.sourceHaltReason.length > 0)),
  "Invalid v5 continuation checkpoint");
  exactKeys(continuation, ["checkpoint", "commandRevision", "commandKey", "sourceHaltReason"], "Unknown v5 continuation evidence");
  check(commandKeyParts(continuation.commandKey)[2] === "continueFromV4", "Invalid v5 continuation identity");
  assertLedgerInvariants(state);
  const entries = [...state.idempotency], first = entries.findIndex(([key]) => key.startsWith("v5:"));
  check(first >= 0 && entries.slice(first).every(([key]) => key.startsWith("v5:")), "V5 commands must be an append-only suffix");
  const suffix = entries.slice(first), receipts = new Map<string, LifecycleReceipt>();
  const proofIds = new Set<string>(), proofContents = new Set<string>();
  for (const [key, receipt] of state.initialPaymentClaimReceipts) {
    exactKeys(receipt, [...receiptBasisKeys, "claimKey", "claimedAtMs"], "Unknown or incomplete payment claim receipt");
    const parts = commandKeyParts(receipt.commandKey), actor: Actor = { kind: "buyer", id: receipt.actorUserId };
    const { input, binding } = validateClaim(state, receipt.input, actor);
    check(key === receipt.claimKey && parts[2] === "claimInitialPayment" && parts[1] === receipt.actorUserId
      && safe(receipt.commandRevision) && receipt.commandRevision > continuation.commandRevision && !receipts.has(receipt.commandKey)
      && walletDigest(receipt) === walletDigest(claimedReceipt(input, binding, actor.id, receipt.commandRevision, receipt.commandKey)),
    "Payment claim receipt disagrees with its original evidence");
    const proof = input.claim.proof;
    if (proof) {
      check(!proofIds.has(proof.evidenceId) && !proofContents.has(proof.contentSha256), "Buyer proof is already bound to another payment claim");
      proofIds.add(proof.evidenceId); proofContents.add(proof.contentSha256);
    }
    receipts.set(receipt.commandKey, receipt);
  }
  for (const [key, receipt] of state.initialDisputeFreezeReceipts) {
    exactKeys(receipt, [...receiptBasisKeys, "disputeKey", "claimKey", "disputedAtMs"], "Unknown or incomplete dispute freeze receipt");
    const parts = commandKeyParts(receipt.commandKey), actor: Actor = { kind: "buyer", id: receipt.actorUserId };
    const { input, binding, claim } = validateDispute(state, receipt.input, actor);
    check(key === receipt.disputeKey && parts[2] === "freezeInitialDispute" && parts[1] === receipt.actorUserId
      && safe(receipt.commandRevision) && receipt.commandRevision > claim.commandRevision && !receipts.has(receipt.commandKey)
      && walletDigest(receipt) === walletDigest(disputedReceipt(input, binding, actor.id, receipt.commandRevision, receipt.commandKey)),
    "Dispute freeze receipt disagrees with its original claim");
    receipts.set(receipt.commandKey, receipt);
  }
  let paused = continuation.sourceHaltReason !== null, priorAt = continuation.checkpoint.lastCommandAtMs, count = 0;
  const haltBefore: Array<string | null> = [];
  let halt = continuation.sourceHaltReason;
  for (const [index, [key, recorded]] of suffix.entries()) {
    exactKeys(recorded, ["fingerprint", "result"], "Unknown v5 idempotency evidence");
    const commandKey = key.slice(3), parts = commandKeyParts(commandKey);
    haltBefore.push(halt);
    if (index === 0) {
      check(commandKey === continuation.commandKey && parts[2] === "continueFromV4"
        && recorded.fingerprint === walletDigest({ checkpoint: continuation.checkpoint }) && walletDigest(recorded.result) === walletDigest(continuation),
      "V5 continuation must be the exact first new command");
    } else if (parts[2] === "pause") {
      check(recorded.fingerprint === walletDigest(null) && walletDigest(recorded.result) === walletDigest({ halted: true }), "Invalid v5 pause evidence");
      paused = true; halt = "Operator emergency pause";
    } else {
      const receipt = receipts.get(commandKey);
      check(!paused && receipt && parts[2] !== "continueFromV4" && receipt.commandRevision === continuation.commandRevision + index
        && receipt.input.preconditions.walletRevision === receipt.commandRevision - 1
        && recorded.fingerprint === walletDigest(receipt.input) && walletDigest(recorded.result) === walletDigest(receipt),
      "Invalid v5 lifecycle order or idempotency evidence");
      const at = "claimedAtMs" in receipt ? receipt.claimedAtMs : receipt.disputedAtMs;
      check(at >= priorAt, "V5 lifecycle time moved backwards"); priorAt = at; count++;
    }
  }
  check(count === receipts.size && state.haltReason === halt, "Orphan lifecycle receipt or uncommanded pause");
  const source = clone(state);
  for (let index = suffix.length - 1; index >= 1; index--) {
    const key = suffix[index]![0], parts = commandKeyParts(key.slice(3));
    source.idempotency.delete(key);
    if (parts[2] === "pause") { source.haltReason = haltBefore[index]!; continue; }
    const receipt = receipts.get(key.slice(3))!, trade = source.trades.get(receipt.walletTradeId);
    check(trade && trade.status === "payment_reported" && trade.disputed === (parts[2] === "freezeInitialDispute"),
      "Claim/dispute state changed without its exact command");
    if (parts[2] === "freezeInitialDispute") {
      trade.disputed = false; source.initialDisputeFreezeReceipts.delete((receipt as V5InitialDisputeFreezeReceipt).disputeKey);
    } else {
      trade.status = "reserved"; source.initialPaymentClaimReceipts.delete((receipt as V5InitialPaymentClaimReceipt).claimKey);
    }
    const binding = source.initialBindings.get(receipt.platformRequestId)!;
    validateReservation(source, receipt.input, binding, parts[2] === "freezeInitialDispute" ? "payment_reported" : "reserved");
    check(walletDigest(source) === receipt.input.preconditions.walletStateDigest, "V5 command does not reconstruct its exact prior wallet state");
  }
  source.idempotency.delete(`v5:${continuation.commandKey}`); source.haltReason = continuation.sourceHaltReason;
  for (const key of v5Keys) Reflect.deleteProperty(source, key);
  const frozen: V4State = { ...source, engineVersion: WALLET_V4_ENGINE_VERSION };
  assertV4Invariants(frozen);
  check(continuation.checkpoint.revision >= frozen.cancellationContinuation.commandRevision
    && walletDigest(frozen) === continuation.checkpoint.stateHash, "V5 must reconstruct its exact frozen V4 checkpoint");
  return frozen;
}
/** Validation and immutable historical receipt recovery only; never old-reducer execution authority. */
export function baseV4StateForV5(state: V5State): V4State { return validatedSourceV4(state); }
export function assertV5Invariants(state: V5State) { validatedSourceV4(state); }

export function findV5LifecycleReplay(state: V5State, value: V5Command): LifecycleReceipt | undefined {
  assertV5Invariants(state);
  const command = parseV5Command(value);
  const receipt = command.type === "claimInitialPayment" ? state.initialPaymentClaimReceipts.get(command.input.claimKey)
    : command.type === "freezeInitialDispute" ? state.initialDisputeFreezeReceipts.get(command.input.disputeKey) : undefined;
  if (!receipt) return undefined;
  check(command.actor.kind === receipt.actorKind && command.actor.id === receipt.actorUserId
    && receipt.inputDigest === inputDigest(command.input as LifecycleInput, command.actor), "Lifecycle identity reused with different actor or input");
  return clone(receipt);
}

/** Simulation-only copy-on-write reducer. Supplied canonical assertions do not authenticate a caller or an upload. */
export function applyV5Command(previous: State | V2State | V3State | V4State | V5State, value: V5Command,
  context: V5ApplyContext): { state: V5State; result: unknown } {
  assertSimulationRuntime("simulation-only");
  const command = parseV5Command(value), checkpoint = v2CheckpointSchema.parse({ revision: context.revision, eventHash: context.eventHash,
    stateHash: context.stateHash, lastCommandAtMs: context.lastCommandAtMs });
  check(safe(context.at) && Number.isFinite(new Date(context.at).getTime()) && context.at >= checkpoint.lastCommandAtMs
    && checkpoint.revision < Number.MAX_SAFE_INTEGER, "Invalid v5 command clock or exhausted revision");
  check(walletDigest(previous) === checkpoint.stateHash, "Verified wallet state and checkpoint disagree");
  if (isV5State(previous)) {
    assertV5Invariants(previous);
    const count = [...previous.idempotency.keys()].filter(key => key.startsWith("v5:")).length;
    check(checkpoint.revision === previous.paymentContinuation.commandRevision + count - 1, "Verified v5 revision and command evidence disagree");
    const replay = findV5LifecycleReplay(previous, command);
    if (replay) return { state: clone(previous), result: replay };
    const prior = previous.idempotency.get(`v5:${v5CommandKey(command)}`);
    if (prior) {
      check(prior.fingerprint === walletDigest(command.input), "Idempotency key reused with different payload");
      return { state: clone(previous), result: clone(prior.result) };
    }
  }
  if (command.type === "continueFromV4") {
    check(command.actor.kind === "operator", "Requires operator authority");
    check(isV4State(previous) && !v5Keys.some(key => Object.hasOwn(previous, key)), "The explicit V4 to V5 continuation may occur only once");
    exactKeys(previous, v4Keys, "A complete known V4 source is required"); assertV4Invariants(previous);
    check(![...previous.idempotency.keys()].some(key => key.startsWith("v5:")), "V4 source contains future command evidence");
    check(walletDigest(command.input.checkpoint) === walletDigest(checkpoint), "Continuation does not match the verified V4 checkpoint");
    const result: V5Continuation = { checkpoint: clone(checkpoint), commandRevision: checkpoint.revision + 1,
      commandKey: v5CommandKey(command), sourceHaltReason: previous.haltReason };
    const state: V5State = { ...clone(previous), engineVersion: WALLET_V5_ENGINE_VERSION, paymentContinuation: clone(result),
      initialPaymentClaimReceipts: new Map(), initialDisputeFreezeReceipts: new Map() };
    record(state, command, result); assertV5Invariants(state); return { state, result: clone(result) };
  }
  check(isV5State(previous), "Explicit V4 to V5 continuation is required");
  const state = clone(previous);
  if (command.type === "pause") {
    check(command.actor.kind === "operator", "Requires operator authority");
    state.haltReason = "Operator emergency pause"; const result = { halted: true as const };
    record(state, command, result); assertV5Invariants(state); return { state, result };
  }
  check(state.haltReason === null, "Wallet paused");
  const conditions = command.input.preconditions;
  check(conditions.walletRevision === checkpoint.revision && conditions.walletEventHash === checkpoint.eventHash
    && conditions.walletStateDigest === checkpoint.stateHash, "Payment lifecycle wallet checkpoint changed");
  let result: LifecycleReceipt;
  if (command.type === "claimInitialPayment") {
    const { input, binding } = validateClaim(state, command.input, command.actor);
    check(input.claimedAtMs === context.at, "Payment claim decision and command clock disagree");
    const trade = validateReservation(state, input, binding, "reserved");
    trade.status = "payment_reported";
    result = claimedReceipt(input, binding, command.actor.id, checkpoint.revision + 1, v5CommandKey(command));
    state.initialPaymentClaimReceipts.set(result.claimKey, result);
  } else {
    const { input, binding } = validateDispute(state, command.input, command.actor);
    check(input.disputedAtMs === context.at, "Dispute freeze decision and command clock disagree");
    const trade = validateReservation(state, input, binding, "payment_reported");
    trade.disputed = true;
    result = disputedReceipt(input, binding, command.actor.id, checkpoint.revision + 1, v5CommandKey(command));
    state.initialDisputeFreezeReceipts.set(result.disputeKey, result);
  }
  record(state, command, result); assertV5Invariants(state); return { state, result: clone(result) };
}
