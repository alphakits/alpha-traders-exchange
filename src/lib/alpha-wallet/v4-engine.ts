import { parseRawUnits, ZERO } from "./amounts";
import { walletDigest } from "./commands";
import { accountKey, assertLedgerInvariants, balance, transfer } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import type { Actor, State } from "./types";
import { v2CheckpointSchema, type V2Checkpoint } from "./v2-commands";
import type { V2State } from "./v2-engine";
import { WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { assertV3Invariants, isV3State, type V3InitialAcceptanceReceipt, type V3InitialBinding, type V3State } from "./v3-engine";
import {
  cancellationPlannerDigest, parseV4Command, v4CancellationInputSchema, v4CancellationKey, v4CommandKey, WALLET_V4_ENGINE_VERSION,
  type V4Command, type V4InitialCancellationInput,
} from "./v4-commands";

export type V4Continuation = {
  checkpoint: V2Checkpoint; commandRevision: number; commandKey: string; sourceHaltReason: string | null;
};
export type V4InitialCancellationReceipt = {
  cancellationKey: string; platformRequestId: string; platformTradeId: string; platformListingId: string;
  walletTradeId: string; walletListingId: string; acceptanceKey: string; actorUserId: string; actorKind: "seller" | "buyer";
  commandRevision: number; commandKey: string; inputDigest: string; plannerInputDigest: string; termsDigest: string;
  principalRaw: string; transferAmountRaw: string; listingAvailableBeforeRaw: string; listingAvailableAfterRaw: string;
  cancelledAtMs: number; input: V4InitialCancellationInput;
};
export type V4State = Omit<V3State, "engineVersion"> & {
  engineVersion: typeof WALLET_V4_ENGINE_VERSION;
  cancellationContinuation: V4Continuation;
  initialCancellationReceipts: Map<string, V4InitialCancellationReceipt>;
};
export type V4ApplyContext = V2Checkpoint & { at: number };

export class V4WalletError extends Error {
  readonly code = "ALPHA_WALLET_V4_REJECTED";
  constructor(message: string) { super(message); this.name = "V4WalletError"; }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new V4WalletError(message); }
const clone = <T>(value: T): T => structuredClone(value);
const safe = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const v3Keys = ["accounts", "journal", "depositIntents", "deposits", "listings", "trades", "payouts", "commissions",
  "receipts", "evidenceOwners", "idempotency", "reconciliations", "gasReady", "haltReason", "engineVersion", "continuation", "termsBindings", "acceptanceReceipts",
  "initialContinuation", "initialBindings", "initialAcceptanceReceipts"] as const;
const v4Keys = ["cancellationContinuation", "initialCancellationReceipts"] as const;
const receiptKeys = ["cancellationKey", "platformRequestId", "platformTradeId", "platformListingId", "walletTradeId", "walletListingId",
  "acceptanceKey", "actorUserId", "actorKind", "commandRevision", "commandKey", "inputDigest", "plannerInputDigest", "termsDigest",
  "principalRaw", "transferAmountRaw", "listingAvailableBeforeRaw", "listingAvailableAfterRaw", "cancelledAtMs", "input"] as const;
function exactKeys(value: object, keys: readonly string[], message: string) {
  check(walletDigest(Object.keys(value).sort()) === walletDigest([...keys].sort()), message);
}
function commandKeyParts(key: string) {
  let parts: unknown;
  try { parts = JSON.parse(key); } catch { throw new V4WalletError("Malformed v4 command identity"); }
  check(Array.isArray(parts) && parts.length === 4 && ["seller", "buyer", "operator"].includes(parts[0]) && id(parts[1])
    && ["continueFromV3", "cancelInitialTrade", "pause"].includes(parts[2]) && id(parts[3]) && JSON.stringify(parts) === key,
  "Malformed v4 command identity");
  const result = parts as ["seller" | "buyer" | "operator", string, V4Command["type"], string];
  check(result[2] === "cancelInitialTrade" ? result[0] !== "operator" : result[0] === "operator", "Invalid v4 command actor");
  return result;
}
function inputDigest(input: V4InitialCancellationInput, actor: Pick<Actor, "kind" | "id">) { return walletDigest({ actor, input }); }
function recordNewCommand(state: V4State, command: V4Command, result: unknown) {
  state.idempotency.set(`v4:${v4CommandKey(command)}`, { fingerprint: walletDigest(command.input), result: clone(result) });
}
export function isV4State(state: State | V2State | V3State | V4State): state is V4State {
  return (state as Partial<V4State>).engineVersion === WALLET_V4_ENGINE_VERSION;
}

/** Binds the recorded canonical assertions to one immutable initial acceptance; it does not authenticate their origin. */
function validateCancellationEvidence(state: Pick<V3State, "initialBindings" | "initialAcceptanceReceipts">,
  value: V4InitialCancellationInput, actor: Actor): {
    input: V4InitialCancellationInput; binding: V3InitialBinding; originalReceipt: V3InitialAcceptanceReceipt;
  } {
  const input = v4CancellationInputSchema.parse(value), terms = input.terms, original = input.originalAcceptance, conditions = input.preconditions;
  const binding = state.initialBindings.get(terms.platformRequestId), originalReceipt = state.initialAcceptanceReceipts.get(original.acceptanceKey);
  check(binding && originalReceipt, "The exact original v3 initial acceptance is required");
  check((actor.kind === "seller" && actor.id === terms.sellerId) || (actor.kind === "buyer" && actor.id === terms.buyerId),
    "Only the recorded seller or buyer can cancel this initial trade");
  check(input.cancellationKey === v4CancellationKey(terms.platformRequestId, original.acceptanceKey), "Initial cancellation business identity changed");
  check(input.termsDigest === walletDigest(terms) && input.termsDigest === binding.termsDigest
    && walletDigest(terms) === walletDigest(binding.terms), "Cancellation must retain the original initial terms");
  check(original.acceptanceKey === binding.acceptanceKey && original.commandRevision === originalReceipt.commandRevision
    && original.commandKey === originalReceipt.commandKey && original.receiptDigest === walletDigest(originalReceipt)
    && original.bindingDigest === walletDigest(binding), "Original acceptance identity or evidence changed");
  check(conditions.walletTradeDigest === binding.walletTradeDigest
    && conditions.walletListingDigest === originalReceipt.input.preconditions.walletListingDigest,
  "Cancellation wallet reservation or listing basis changed");
  check(Number.isFinite(new Date(input.cancelledAtMs).getTime()) && input.cancelledAtMs > originalReceipt.acceptedAtMs
    && Date.parse(conditions.requestUpdatedAt) >= originalReceipt.acceptedAtMs
    && input.cancelledAtMs > Date.parse(conditions.requestUpdatedAt), "Cancellation clock must follow the accepted canonical request");
  check(conditions.listingExpiresAt === null || Date.parse(conditions.listingExpiresAt) > input.cancelledAtMs,
    "Expired listings require a separate lifecycle contract");
  check(!conditions.buyerBankDetailsDisclosed || terms.paymentMethod === "Bank Transfer", "Bank disclosure does not match the original payment method");
  check(actor.kind !== "buyer" || !conditions.buyerBankDetailsDisclosed, "Buyer cancellation is unavailable after bank details disclosure");
  const returned = input.principalReturn, principal = parseRawUnits(terms.principalRaw);
  check(principal > ZERO && returned.assetId === binding.assetId && returned.walletTradeId === binding.walletTradeId
    && returned.walletListingId === binding.walletListingId && returned.principalRaw === terms.principalRaw
    && returned.transferAmountRaw === terms.principalRaw && returned.expectedTradeReservedRaw === terms.principalRaw
    && returned.fromAccount === `trade:${binding.walletTradeId}` && returned.toAccount === `listing:${binding.walletListingId}`,
  "Cancellation must return the exact full principal to its original listing");
  parseRawUnits(returned.expectedListingAvailableRaw);
  check(input.plannerInputDigest === cancellationPlannerDigest(input, actor.id), "Cancellation planner input digest mismatch");
  return { input, binding, originalReceipt };
}

/**
 * Validates the current state and reverses only this version's closed effects.
 * The resulting V3 state must have its original checkpoint hash and must pass
 * the unchanged V3 invariants, including its still-reserved initial trades.
 */
function validatedSourceV3(state: V4State): V3State {
  assertSimulationRuntime("simulation-only");
  check(isV4State(state) && state.initialCancellationReceipts instanceof Map && state.idempotency instanceof Map,
    "Malformed v4 state");
  exactKeys(state, [...v3Keys, ...v4Keys], "Unknown or incomplete v4 state metadata");
  const continuation = state.cancellationContinuation;
  check(continuation && v2CheckpointSchema.safeParse(continuation.checkpoint).success
    && safe(continuation.commandRevision) && continuation.commandRevision === continuation.checkpoint.revision + 1
    && (continuation.sourceHaltReason === null || (typeof continuation.sourceHaltReason === "string" && continuation.sourceHaltReason.length > 0)),
  "Invalid v4 continuation checkpoint");
  exactKeys(continuation, ["checkpoint", "commandRevision", "commandKey", "sourceHaltReason"], "Unknown v4 continuation evidence");
  const continuationParts = commandKeyParts(continuation.commandKey);
  check(continuationParts[2] === "continueFromV3", "Invalid v4 continuation command identity");
  assertLedgerInvariants(state);

  const entries = [...state.idempotency], firstV4 = entries.findIndex(([key]) => key.startsWith("v4:"));
  check(firstV4 >= 0 && entries.slice(firstV4).every(([key]) => key.startsWith("v4:")), "V4 command evidence must be an append-only suffix");
  const v4Entries = entries.slice(firstV4);
  check(v4Entries[0]![0] === `v4:${continuation.commandKey}`, "V4 continuation must be the first new command");
  const receiptByCommand = new Map<string, V4InitialCancellationReceipt>(), seenTrades = new Set<string>();
  let previousRevision = continuation.commandRevision;
  for (const [key, receipt] of state.initialCancellationReceipts) {
    exactKeys(receipt, receiptKeys, "Unknown or incomplete initial cancellation receipt");
    check(key === receipt.cancellationKey && safe(receipt.commandRevision) && receipt.commandRevision > previousRevision
      && !receiptByCommand.has(receipt.commandKey) && !seenTrades.has(receipt.walletTradeId), "Invalid or duplicate initial cancellation identity");
    previousRevision = receipt.commandRevision; seenTrades.add(receipt.walletTradeId); receiptByCommand.set(receipt.commandKey, receipt);
    const parts = commandKeyParts(receipt.commandKey);
    check(parts[2] === "cancelInitialTrade" && parts[0] === receipt.actorKind && parts[1] === receipt.actorUserId,
      "Initial cancellation command and actor disagree");
    const actor: Actor = { kind: receipt.actorKind, id: receipt.actorUserId };
    const { input, binding } = validateCancellationEvidence(state, receipt.input, actor);
    const returned = input.principalReturn, principal = parseRawUnits(returned.principalRaw);
    check(receipt.cancellationKey === input.cancellationKey && receipt.platformRequestId === input.terms.platformRequestId
      && receipt.platformTradeId === binding.platformTradeId && receipt.platformListingId === binding.platformListingId
      && receipt.walletTradeId === binding.walletTradeId && receipt.walletListingId === binding.walletListingId
      && receipt.acceptanceKey === binding.acceptanceKey && receipt.inputDigest === inputDigest(input, actor)
      && receipt.plannerInputDigest === input.plannerInputDigest && receipt.termsDigest === input.termsDigest
      && receipt.principalRaw === returned.principalRaw && receipt.transferAmountRaw === returned.transferAmountRaw
      && receipt.listingAvailableBeforeRaw === returned.expectedListingAvailableRaw
      && parseRawUnits(receipt.listingAvailableAfterRaw) === parseRawUnits(receipt.listingAvailableBeforeRaw) + principal
      && receipt.cancelledAtMs === input.cancelledAtMs && receipt.cancelledAtMs >= continuation.checkpoint.lastCommandAtMs,
    "Initial cancellation receipt does not match its recorded input");
    const trade = state.trades.get(binding.walletTradeId), listing = state.listings.get(binding.walletListingId);
    check(trade && trade.status === "cancelled" && walletDigest({ ...trade, status: "reserved" }) === binding.walletTradeDigest,
      "Cancelled initial trade must retain its original reservation terms and prepayment state");
    check(listing && walletDigest(listing) === input.preconditions.walletListingDigest && !listing.closed && listing.approved && listing.funded,
      "Cancellation cannot change or close its original funded listing");
  }

  const pausedBefore: boolean[] = [];
  let paused = continuation.sourceHaltReason !== null, cancellationCount = 0, lastCancelledAt = continuation.checkpoint.lastCommandAtMs;
  for (const [index, [key, recorded]] of v4Entries.entries()) {
    exactKeys(recorded, ["fingerprint", "result"], "Unknown v4 idempotency evidence");
    const commandKey = key.slice(3), parts = commandKeyParts(commandKey);
    pausedBefore.push(paused);
    if (index === 0) {
      check(parts[2] === "continueFromV3" && recorded.fingerprint === walletDigest({ checkpoint: continuation.checkpoint })
        && walletDigest(recorded.result) === walletDigest(continuation), "V4 continuation idempotency evidence changed");
    } else if (parts[2] === "pause") {
      check(recorded.fingerprint === walletDigest(null) && walletDigest(recorded.result) === walletDigest({ halted: true }), "Invalid v4 pause evidence");
      paused = true;
    } else {
      const receipt = receiptByCommand.get(commandKey);
      check(parts[2] === "cancelInitialTrade" && !paused && receipt
        && receipt.commandRevision === continuation.commandRevision + index
        && receipt.input.preconditions.walletRevision === receipt.commandRevision - 1
        && receipt.cancelledAtMs >= lastCancelledAt && recorded.fingerprint === walletDigest(receipt.input)
        && walletDigest(recorded.result) === walletDigest(receipt), "Invalid v4 cancellation order or idempotency evidence");
      cancellationCount++; lastCancelledAt = receipt.cancelledAtMs;
    }
  }
  check(cancellationCount === state.initialCancellationReceipts.size, "Orphan initial cancellation receipt");
  const hasPause = v4Entries.some(([key]) => commandKeyParts(key.slice(3))[2] === "pause");
  check(state.haltReason === (hasPause ? "Operator emergency pause" : continuation.sourceHaltReason), "V4 pause state changed without its command");
  const financialStart = state.journal.length - cancellationCount;
  check(financialStart >= 0 && state.journal.slice(0, financialStart).every(journal => !journal.operation.startsWith("v4:"))
    && state.journal.slice(financialStart).every(journal => journal.operation.startsWith("v4:")), "V4 financial effects must be an exact append-only suffix");

  const source = clone(state);
  for (let index = v4Entries.length - 1; index >= 1; index--) {
    const key = v4Entries[index]![0], commandKey = key.slice(3), parts = commandKeyParts(commandKey);
    source.idempotency.delete(key);
    if (parts[2] === "pause") {
      source.haltReason = pausedBefore[index] ? "Operator emergency pause" : continuation.sourceHaltReason;
      // A source may have a different historical halt reason; V4 never resumes it.
      if (pausedBefore[index] && !v4Entries.slice(1, index).some(([prior]) => commandKeyParts(prior.slice(3))[2] === "pause")) {
        source.haltReason = continuation.sourceHaltReason;
      }
      continue;
    }
    const receipt = receiptByCommand.get(commandKey)!;
    const input = receipt.input, returned = input.principalReturn, principal = parseRawUnits(receipt.principalRaw);
    const journal = source.journal.pop();
    check(journal && journal.id === `journal-${source.journal.length + 1}` && journal.operation === `v4:${commandKey}`
      && journal.assetId === returned.assetId && walletDigest(journal.entries) === walletDigest([
        { account: returned.fromAccount, delta: -principal }, { account: returned.toAccount, delta: principal },
      ]), "Initial cancellation requires exactly its full-principal return journal");
    exactKeys(journal, ["id", "operation", "assetId", "entries"], "Unknown initial cancellation journal evidence");
    check(balance(source, returned.assetId, returned.fromAccount) === ZERO
      && balance(source, returned.assetId, returned.toAccount).toString() === receipt.listingAvailableAfterRaw,
    "Initial cancellation account balances changed");
    for (const entry of journal.entries) {
      const account = accountKey(journal.assetId, entry.account);
      check(source.accounts.has(account), "Cancellation cannot create or remove an account identity");
      source.accounts.set(account, source.accounts.get(account)! - entry.delta);
    }
    check(balance(source, returned.assetId, returned.fromAccount).toString() === returned.expectedTradeReservedRaw
      && balance(source, returned.assetId, returned.toAccount).toString() === returned.expectedListingAvailableRaw,
    "Initial cancellation prior account balances changed");
    source.trades.get(receipt.walletTradeId)!.status = "reserved";
    source.initialCancellationReceipts.delete(receipt.cancellationKey);
    check(walletDigest(source) === input.preconditions.walletStateDigest, "Cancellation does not reconstruct its exact prior wallet state");
  }
  source.idempotency.delete(`v4:${continuation.commandKey}`);
  source.haltReason = continuation.sourceHaltReason;
  for (const key of v4Keys) Reflect.deleteProperty(source, key);
  const frozen: V3State = { ...source, engineVersion: WALLET_V3_ENGINE_VERSION };
  assertV3Invariants(frozen);
  check(continuation.checkpoint.revision >= frozen.initialContinuation.commandRevision
    && walletDigest(frozen) === continuation.checkpoint.stateHash, "V4 history must reconstruct its exact frozen v3 checkpoint");
  return frozen;
}

/** Validation/projection view only. Never use this historical state to execute an old command after V4. */
export function baseV3StateForV4(state: V4State): V3State { return validatedSourceV3(state); }
export function assertV4Invariants(state: V4State) { validatedSourceV3(state); }

export function findV4InitialCancellationReplay(state: V4State, value: V4Command): V4InitialCancellationReceipt | undefined {
  assertV4Invariants(state);
  const command = parseV4Command(value);
  if (command.type !== "cancelInitialTrade") return undefined;
  const receipt = state.initialCancellationReceipts.get(command.input.cancellationKey);
  if (!receipt) return undefined;
  check(command.actor.kind === receipt.actorKind && command.actor.id === receipt.actorUserId
    && receipt.inputDigest === inputDigest(command.input, command.actor), "Initial cancellation identity reused with different actor or input");
  return clone(receipt);
}

/**
 * Simulation-only and copy-on-write. Canonical assertions remain supplied facts;
 * this reducer is not a route, an authentication check or a canonical coordinator.
 */
export function applyV4Command(previous: State | V2State | V3State | V4State, value: V4Command, context: V4ApplyContext): { state: V4State; result: unknown } {
  assertSimulationRuntime("simulation-only");
  const command = parseV4Command(value), checkpoint = v2CheckpointSchema.parse({ revision: context.revision, eventHash: context.eventHash,
    stateHash: context.stateHash, lastCommandAtMs: context.lastCommandAtMs });
  check(safe(context.at) && Number.isFinite(new Date(context.at).getTime()) && context.at >= checkpoint.lastCommandAtMs
    && checkpoint.revision < Number.MAX_SAFE_INTEGER, "Invalid v4 command clock or exhausted revision");
  check(walletDigest(previous) === checkpoint.stateHash, "Verified wallet state and checkpoint disagree");
  if (isV4State(previous)) {
    assertV4Invariants(previous);
    const count = [...previous.idempotency.keys()].filter(key => key.startsWith("v4:")).length;
    check(checkpoint.revision === previous.cancellationContinuation.commandRevision + count - 1, "Verified v4 revision and command evidence disagree");
    const replay = findV4InitialCancellationReplay(previous, command);
    if (replay) return { state: clone(previous), result: replay };
    const prior = previous.idempotency.get(`v4:${v4CommandKey(command)}`);
    if (prior) {
      check(prior.fingerprint === walletDigest(command.input), "Idempotency key reused with different payload");
      return { state: clone(previous), result: clone(prior.result) };
    }
  }
  if (command.type === "continueFromV3") {
    check(command.actor.kind === "operator", "Requires operator authority");
    check(isV3State(previous) && !v4Keys.some(key => Object.hasOwn(previous, key)), "The explicit v3 to v4 continuation may occur only once");
    exactKeys(previous, v3Keys, "A complete known v3 state is required for continuation");
    assertV3Invariants(previous);
    check(![...previous.idempotency.keys()].some(key => key.startsWith("v4:")), "V3 source contains unsupported future command evidence");
    check(walletDigest(command.input.checkpoint) === walletDigest(checkpoint), "Continuation does not match the verified v3 checkpoint");
    const result: V4Continuation = { checkpoint: clone(checkpoint), commandRevision: checkpoint.revision + 1,
      commandKey: v4CommandKey(command), sourceHaltReason: previous.haltReason };
    const state: V4State = { ...clone(previous), engineVersion: WALLET_V4_ENGINE_VERSION,
      cancellationContinuation: clone(result), initialCancellationReceipts: new Map() };
    recordNewCommand(state, command, result); assertV4Invariants(state);
    return { state, result: clone(result) };
  }
  check(isV4State(previous), "Explicit v3 to v4 continuation is required before initial cancellation");
  const state = clone(previous);
  if (command.type === "pause") {
    check(command.actor.kind === "operator", "Requires operator authority");
    state.haltReason = "Operator emergency pause";
    const result = { halted: true as const };
    recordNewCommand(state, command, result); assertV4Invariants(state);
    return { state, result };
  }
  check(state.haltReason === null, "Wallet paused");
  const { input, binding } = validateCancellationEvidence(state, command.input, command.actor);
  const conditions = input.preconditions, returned = input.principalReturn;
  check(conditions.walletRevision === checkpoint.revision && conditions.walletEventHash === checkpoint.eventHash
    && conditions.walletStateDigest === checkpoint.stateHash, "Initial cancellation wallet checkpoint changed");
  check(input.cancelledAtMs === context.at, "Cancellation decision and command clock disagree");
  const trade = state.trades.get(binding.walletTradeId), listing = state.listings.get(binding.walletListingId);
  check(trade && trade.status === "reserved" && walletDigest(trade) === binding.walletTradeDigest
    && !trade.disputed && !trade.evidence && !trade.authorization && !trade.payoutId,
  "Only the unchanged prepayment initial reservation can be cancelled");
  check(listing && !listing.closed && listing.funded && listing.approved && walletDigest(listing) === conditions.walletListingDigest,
    "Cancellation requires its unchanged open, funded, approved listing");
  check(![...state.payouts.values()].some(payout => payout.tradeId === trade.id)
    && ![...state.commissions.values()].some(due => due.tradeId === trade.id)
    && ![...state.evidenceOwners.values()].includes(trade.id), "Initial reservation already has irreversible lifecycle evidence");
  const principal = parseRawUnits(returned.principalRaw), available = balance(state, returned.assetId, returned.toAccount);
  check(balance(state, returned.assetId, returned.fromAccount) === principal && available.toString() === returned.expectedListingAvailableRaw,
    "The exact initial principal or listing balance changed");
  check([...state.accounts].every(([key, amount]) => !key.endsWith(`|trade:${trade.id}`)
    || key === accountKey(returned.assetId, returned.fromAccount) || amount === ZERO), "Initial trade contains another asset");
  transfer(state, `v4:${v4CommandKey(command)}`, returned.assetId, returned.fromAccount, returned.toAccount, principal);
  trade.status = "cancelled";
  check(command.actor.kind === "seller" || command.actor.kind === "buyer", "Requires a recorded trade participant");
  const receipt: V4InitialCancellationReceipt = { cancellationKey: input.cancellationKey,
    platformRequestId: binding.platformRequestId, platformTradeId: binding.platformTradeId, platformListingId: binding.platformListingId,
    walletTradeId: binding.walletTradeId, walletListingId: binding.walletListingId, acceptanceKey: binding.acceptanceKey,
    actorUserId: command.actor.id, actorKind: command.actor.kind, commandRevision: checkpoint.revision + 1, commandKey: v4CommandKey(command),
    inputDigest: inputDigest(input, command.actor), plannerInputDigest: input.plannerInputDigest, termsDigest: input.termsDigest,
    principalRaw: returned.principalRaw, transferAmountRaw: returned.transferAmountRaw,
    listingAvailableBeforeRaw: available.toString(), listingAvailableAfterRaw: (available + principal).toString(),
    cancelledAtMs: context.at, input: clone(input) };
  state.initialCancellationReceipts.set(receipt.cancellationKey, receipt);
  recordNewCommand(state, command, receipt); assertV4Invariants(state);
  return { state, result: clone(receipt) };
}
