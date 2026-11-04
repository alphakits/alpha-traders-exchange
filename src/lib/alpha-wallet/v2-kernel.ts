/**
 * Internal v2 hydration of the pinned v1 reducer, copied from 44ac6c4.
 * Only the factory name, explicit verified initial state and final type name
 * differ. v2-engine supplies the state; this is not a public state-import API.
 * A source-equivalence regression keeps all inherited command logic unchanged.
 */
import { assetFor, parseRawUnits, parseUnits, quoteTrade, SANDBOX_ASSETS, ZERO, type AssetId } from "./amounts";
import { assertLedgerInvariants, balance, expectedCustody, transfer } from "./ledger";
import { assertSimulationRuntime } from "./runtime";
import type { Actor, DepositIntent, DepositObservation, DepositPurpose, Listing, PaymentEvidence, Payout, PayoutReceipt, State, Trade } from "./types";

const RECONCILIATION_MAX_AGE_MS = 60_000;
const roles = new Set(["seller", "buyer", "operator", "verifier", "dispatcher"]);
const clone = <T>(value: T): T => structuredClone(value);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function validId(id: string) { check(typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id), "Invalid fixture identifier"); }
function role(actor: Actor, kind: Actor["kind"]) { check(actor.kind === kind, `Requires ${kind} authority`); }
function live(state: State) { check(!state.haltReason, `Wallet paused: ${state.haltReason}`); }
function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
}
function getListing(state: State, id: string) { const item = state.listings.get(id); check(item, "Listing not found"); return item; }
function getTrade(state: State, id: string) { const item = state.trades.get(id); check(item, "Trade not found"); return item; }
function getPayout(state: State, id: string) { const item = state.payouts.get(id); check(item, "Payout not found"); return item; }
function noDebt(state: State, sellerId: string) { check(![...state.commissions.values()].some(c => c.sellerId === sellerId && !c.paid), "Unpaid commission blocks new seller commitments"); }
function eventKey(event: { network: string; token: string; transactionId: string; eventIndex: number }) {
  check(/^sim-tx-[A-Za-z0-9_-]{1,80}$/.test(event.transactionId), "Only simulation transaction identifiers are accepted");
  check(Number.isSafeInteger(event.eventIndex) && event.eventIndex >= 0, "Invalid event index");
  return JSON.stringify([event.network, event.token, event.transactionId, event.eventIndex]);
}
export function simulatedDestination(assetId: AssetId, account: string) {
  assetFor(assetId); validId(account); return `sim://${assetId}/recipient/${account}`;
}
function validDestination(assetId: AssetId, destination: string) {
  check(typeof destination === "string" && destination.startsWith(`sim://${assetId}/recipient/`), "Recipient must match the funded simulation asset");
  validId(destination.slice(`sim://${assetId}/recipient/`.length));
}
function assertAsset(event: { assetId: AssetId; network: string; token: string }) {
  const asset = assetFor(event.assetId);
  check(event.network === asset.network && event.token === asset.token, "Wrong chain or token");
  return asset;
}
function settleCommissions(state: State, sellerId: string, operation: string) {
  for (const due of state.commissions.values()) {
    if (due.sellerId !== sellerId || due.paid || balance(state, due.assetId, `commission:${sellerId}`) < due.amountRaw) continue;
    transfer(state, operation, due.assetId, `commission:${sellerId}`, "platform-revenue", due.amountRaw);
    due.paid = true;
  }
}
function fundListings(state: State, sellerId: string, operation: string) {
  for (const listing of state.listings.values()) {
    if (listing.sellerId !== sellerId || listing.funded || listing.closed) continue;
    if (balance(state, listing.assetId, `available:${sellerId}`) < listing.amountRaw) continue;
    transfer(state, operation, listing.assetId, `available:${sellerId}`, `listing:${listing.id}`, listing.amountRaw);
    listing.funded = true;
  }
}
function outgoingChecks(state: State, assetId: AssetId, now: number) {
  live(state);
  const reconciled = state.reconciliations.get(assetId);
  check(reconciled && reconciled.expectedRaw === expectedCustody(state, assetId)
    && now >= reconciled.at && now - reconciled.at <= RECONCILIATION_MAX_AGE_MS, "Fresh matching custody reconciliation required");
  check(state.gasReady.has(assetId), "Separate native network-fee reserve required");
}

/**
 * Offline executable specification, not a production repository or auth boundary.
 * All commands are synchronous copy-on-write transactions in ONE process. No RPC,
 * database client, private key, signer, HTTP route, or real destination exists here.
 */
export function createHydratedV2Kernel(options: { mode: "simulation-only"; initialState: State; clock?: () => number }) {
  assertSimulationRuntime(options.mode);
  const clock = options.clock ?? Date.now;
  let state: State = clone(options.initialState);
  assertLedgerInvariants(state);
  function command<T>(actor: Actor, requestId: string, operation: string, input: unknown, apply: (draft: State, operationId: string) => T): T {
    // Recheck actual runtime on every mutation; construction cannot retain authority after a runtime change.
    assertSimulationRuntime(options.mode);
    validId(actor.id); validId(requestId); check(roles.has(actor.kind), "Invalid fixture role");
    const operationId = `${actor.kind}:${actor.id}:${operation}:${requestId}`;
    const fingerprint = canonical(input);
    const previous = state.idempotency.get(operationId);
    if (previous) { check(previous.fingerprint === fingerprint, "Idempotency key reused with different payload"); return clone(previous.result) as T; }
    const draft = clone(state);
    const result = apply(draft, operationId);
    assertLedgerInvariants(draft);
    draft.idempotency.set(operationId, { fingerprint, result: clone(result) });
    state = draft;
    return clone(result);
  }
  const api = {
    createDepositIntent(actor: Actor, requestId: string, input: { id: string; assetId: AssetId; purpose: DepositPurpose }) {
      return command(actor, requestId, "deposit-intent", input, draft => {
        role(actor, "seller"); validId(input.id); assetFor(input.assetId);
        check(input.purpose === "principal" || input.purpose === "commission", "Invalid deposit purpose");
        check(!draft.depositIntents.has(input.id), "Deposit intent already exists");
        const intent: DepositIntent = { ...input, sellerId: actor.id, destination: `sim://${input.assetId}/deposit/${input.id}` };
        draft.depositIntents.set(intent.id, intent); return intent;
      });
    },
    observeDeposit(actor: Actor, requestId: string, event: DepositObservation) {
      return command(actor, requestId, "deposit-observation", event, (draft, op) => {
        role(actor, "verifier"); assertAsset(event);
        check(typeof event.finalized === "boolean" && typeof event.successful === "boolean", "Invalid confirmation evidence");
        check(/^sim-block-[A-Za-z0-9_-]{1,80}$/.test(event.blockHash), "Only simulation blocks are accepted");
        const intent = draft.depositIntents.get(event.intentId); check(intent, "Unknown deposit intent");
        check(intent.assetId === event.assetId && intent.destination === event.destination, "Deposit is not assigned to this recipient and asset");
        const amount = parseRawUnits(event.amountRaw); check(amount > ZERO, "Deposit must be positive");
        const key = eventKey(event); check(!draft.receipts.has(key), "Chain event already consumed as an outgoing payout");
        const prior = draft.deposits.get(key);
        if (prior) {
          for (const field of ["intentId", "assetId", "destination", "amountRaw"] as const) check(prior[field] === event[field], "Conflicting duplicate deposit");
          if (prior.credited && (prior.blockHash !== event.blockHash || !event.finalized || !event.successful)) {
            draft.haltReason = "Finalized deposit evidence changed; custody reconciliation required";
            return { credited: false, duplicate: true, halted: true };
          }
          if (prior.credited) return { credited: false, duplicate: true, halted: Boolean(draft.haltReason) };
          check(prior.blockHash !== event.blockHash || prior.successful === event.successful, "Conflicting execution outcome within the same block");
        }
        const credited = event.finalized && event.successful;
        draft.deposits.set(key, { ...event, credited });
        if (credited) {
          transfer(draft, op, event.assetId, "external", `${intent.purpose === "principal" ? "available" : "commission"}:${intent.sellerId}`, amount);
          settleCommissions(draft, intent.sellerId, op);
          if (!draft.haltReason) fundListings(draft, intent.sellerId, op);
        }
        return { credited, duplicate: false, halted: Boolean(draft.haltReason) };
      });
    },
    createListing(actor: Actor, requestId: string, input: { id: string; assetId: AssetId; amount: string; price: string; currency: "ILS" }) {
      return command(actor, requestId, "create-listing", input, (draft, op) => {
        role(actor, "seller"); live(draft); noDebt(draft, actor.id); validId(input.id); assetFor(input.assetId);
        check(!draft.listings.has(input.id), "Listing already exists"); check(input.currency === "ILS", "Development model currently supports ILS terms");
        const quote = quoteTrade(input.assetId, input.amount, input.price);
        const listing: Listing = { id: input.id, sellerId: actor.id, assetId: input.assetId, amountRaw: quote.principalRaw,
          price: input.price, currency: input.currency, approved: false, funded: false, closed: false };
        draft.listings.set(input.id, listing); fundListings(draft, actor.id, op); return listing;
      });
    },
    approveListing(actor: Actor, requestId: string, listingId: string) {
      return command(actor, requestId, "approve-listing", { listingId }, draft => {
        role(actor, "operator"); live(draft); const listing = getListing(draft, listingId); check(!listing.closed, "Listing closed");
        listing.approved = true; return listing;
      });
    },
    closeListing(actor: Actor, requestId: string, listingId: string) {
      return command(actor, requestId, "close-listing", { listingId }, (draft, op) => {
        role(actor, "seller"); const listing = getListing(draft, listingId); check(listing.sellerId === actor.id, "Not listing owner");
        listing.closed = true;
        const amount = balance(draft, listing.assetId, `listing:${listing.id}`);
        if (amount > ZERO) transfer(draft, op, listing.assetId, `listing:${listing.id}`, `available:${actor.id}`, amount);
        return listing;
      });
    },
    reserveTrade(actor: Actor, requestId: string, input: { id: string; listingId: string; amount: string; destination: string }) {
      return command(actor, requestId, "reserve-trade", input, (draft, op) => {
        role(actor, "buyer"); live(draft); validId(input.id); check(!draft.trades.has(input.id), "Trade already exists");
        const listing = getListing(draft, input.listingId); noDebt(draft, listing.sellerId);
        check(listing.approved && listing.funded && !listing.closed, "Listing must be approved and fully funded");
        check(listing.sellerId !== actor.id, "Self trade is not permitted"); validDestination(listing.assetId, input.destination);
        const active = [...draft.trades.values()].filter(t => t.sellerId === listing.sellerId && t.status !== "completed" && t.status !== "cancelled");
        check(active.length < 3, "Seller has three active trades");
        const quote = quoteTrade(listing.assetId, input.amount, listing.price);
        transfer(draft, op, listing.assetId, `listing:${listing.id}`, `trade:${input.id}`, quote.principalRaw);
        const trade: Trade = { id: input.id, listingId: listing.id, sellerId: listing.sellerId, buyerId: actor.id, assetId: listing.assetId,
          destination: input.destination, amountRaw: quote.principalRaw, buyerFeeRaw: quote.buyerFeeRaw, sellerFeeRaw: quote.sellerFeeRaw,
          totalFeeRaw: quote.totalFeeRaw, fiatTotalMinor: quote.fiatTotalMinor, currency: listing.currency, status: "reserved", disputed: false };
        draft.trades.set(input.id, trade); return trade;
      });
    },
    markBuyerPaid(actor: Actor, requestId: string, tradeId: string) {
      return command(actor, requestId, "buyer-reported-payment", { tradeId }, draft => {
        role(actor, "buyer"); const trade = getTrade(draft, tradeId); check(trade.buyerId === actor.id, "Not trade buyer");
        check(trade.status === "reserved" && !trade.disputed, "Trade cannot accept payment claim"); trade.status = "payment_reported"; return trade;
      });
    },
    verifyPayment(actor: Actor, requestId: string, input: { tradeId: string; evidence: PaymentEvidence }) {
      return command(actor, requestId, "verify-fiat", input, draft => {
        role(actor, "verifier"); const trade = getTrade(draft, input.tradeId);
        check(actor.id !== trade.buyerId && actor.id !== trade.sellerId, "Payment verifier must be independent of trade parties");
        check(trade.status === "payment_reported" && !trade.disputed, "Payment is not eligible for verification");
        check(input.evidence.kind === "simulated-bank-credit" || input.evidence.kind === "simulated-cash-receipt", "Payment claim is not receipt evidence");
        check(/^sim-evidence-[A-Za-z0-9_-]{1,80}$/.test(input.evidence.reference), "Only simulation payment evidence is supported");
        check(parseRawUnits(input.evidence.amountMinor) === trade.fiatTotalMinor && input.evidence.currency === trade.currency, "Full agreed fiat payment including buyer fee must be verified");
        check(!draft.evidenceOwners.has(input.evidence.reference), "Payment evidence already used");
        draft.evidenceOwners.set(input.evidence.reference, trade.id); trade.evidence = clone(input.evidence); trade.status = "payment_verified"; return trade;
      });
    },
    authorizeRelease(actor: Actor, requestId: string, tradeId: string) {
      return command(actor, requestId, "authorize-release", { tradeId }, draft => {
        role(actor, "seller"); const trade = getTrade(draft, tradeId); check(trade.sellerId === actor.id, "Not trade seller");
        check(trade.status === "payment_verified" && trade.evidence && !trade.disputed, "Independently verified payment required before release");
        trade.authorization = { sellerId: actor.id, destination: trade.destination, amountRaw: trade.amountRaw, evidenceReference: trade.evidence.reference };
        trade.status = "release_authorized"; return trade;
      });
    },
    queueRelease(actor: Actor, requestId: string, tradeId: string) {
      return command(actor, requestId, "queue-release", { tradeId }, (draft, op) => {
        role(actor, "dispatcher"); const trade = getTrade(draft, tradeId); outgoingChecks(draft, trade.assetId, clock());
        check(trade.status === "release_authorized" && !trade.disputed && trade.authorization && trade.evidence, "Release is not authorized");
        check(trade.authorization.destination === trade.destination && trade.authorization.amountRaw === trade.amountRaw
          && trade.authorization.evidenceReference === trade.evidence.reference, "Release authorization no longer matches trade terms");
        const payoutId = `trade-${trade.id}`; check(!draft.payouts.has(payoutId), "Trade already has a payout intent");
        const payout: Payout = { id: payoutId, assetId: trade.assetId, sellerId: trade.sellerId, kind: "trade", tradeId,
          amountRaw: trade.amountRaw, destination: trade.destination, state: "queued", providerReference: `sim-payout-${payoutId}`, dispatchCount: 0 };
        transfer(draft, op, trade.assetId, `trade:${trade.id}`, `payout:${payout.id}`, trade.amountRaw);
        draft.payouts.set(payout.id, payout); trade.payoutId = payout.id; trade.status = "payout_pending"; return payout;
      });
    },
    cancelTrade(actor: Actor, requestId: string, tradeId: string) {
      return command(actor, requestId, "cancel-trade", { tradeId }, (draft, op) => {
        const trade = getTrade(draft, tradeId);
        check((actor.kind === "buyer" && actor.id === trade.buyerId) || (actor.kind === "seller" && actor.id === trade.sellerId), "Not a trade party");
        check(trade.status === "reserved" && !trade.disputed, "Payment claim, dispute, or payout prevents automatic cancellation");
        const listing = getListing(draft, trade.listingId);
        transfer(draft, op, trade.assetId, `trade:${trade.id}`, listing.closed ? `available:${trade.sellerId}` : `listing:${trade.listingId}`, trade.amountRaw);
        trade.status = "cancelled"; return trade;
      });
    },
    openDispute(actor: Actor, requestId: string, tradeId: string) {
      return command(actor, requestId, "open-dispute", { tradeId }, draft => {
        const trade = getTrade(draft, tradeId);
        check((actor.kind === "buyer" && actor.id === trade.buyerId) || (actor.kind === "seller" && actor.id === trade.sellerId) || actor.kind === "operator", "Not a trade party or operator");
        check(trade.status !== "cancelled", "Cancelled trade"); trade.disputed = true;
        const payoutState = trade.payoutId ? getPayout(draft, trade.payoutId).state : null;
        return { tradeId, payoutState, inFlight: payoutState !== null && ["submitting", "submission_unknown", "broadcast"].includes(payoutState),
          frozen: payoutState === null || payoutState === "queued" || payoutState === "failed_final", alreadySettled: payoutState === "confirmed" };
      });
    },
    requestWithdrawal(actor: Actor, requestId: string, input: { id: string; assetId: AssetId; amount: string; destination: string; stepUpReference: string }) {
      return command(actor, requestId, "withdrawal", input, (draft, op) => {
        role(actor, "seller"); validId(input.id); noDebt(draft, actor.id); outgoingChecks(draft, input.assetId, clock()); validDestination(input.assetId, input.destination);
        check(/^sim-stepup-[A-Za-z0-9_-]{1,80}$/.test(input.stepUpReference), "Simulation withdrawal approval required");
        const amount = parseUnits(input.amount, assetFor(input.assetId).decimals); check(amount > ZERO, "Withdrawal must be positive");
        const payoutId = `withdrawal-${input.id}`; check(!draft.payouts.has(payoutId), "Withdrawal already exists");
        transfer(draft, op, input.assetId, `available:${actor.id}`, `payout:${payoutId}`, amount);
        const payout: Payout = { id: payoutId, assetId: input.assetId, sellerId: actor.id, kind: "withdrawal", amountRaw: amount,
          destination: input.destination, state: "queued", providerReference: `sim-payout-${payoutId}`, dispatchCount: 0 };
        draft.payouts.set(payoutId, payout); return payout;
      });
    },
    beginDispatch(actor: Actor, requestId: string, payoutId: string) {
      // A replay must not return an old instruction to send, even with the same key.
      // A durable implementation additionally enforces provider-side transfer identity.
      assertSimulationRuntime(options.mode);
      role(actor, "dispatcher"); validId(actor.id); validId(requestId);
      const prior = state.idempotency.get(`${actor.kind}:${actor.id}:begin-dispatch:${requestId}`);
      if (prior) {
        check(prior.fingerprint === canonical({ payoutId }), "Idempotency key reused with different payload");
        return { shouldDispatch: false, payout: clone(getPayout(state, payoutId)) };
      }
      const payout = command(actor, requestId, "begin-dispatch", { payoutId }, draft => {
        role(actor, "dispatcher"); const payout = getPayout(draft, payoutId); outgoingChecks(draft, payout.assetId, clock());
        check(payout.state === "queued", "Payout already dispatched; reconcile the existing provider reference");
        if (payout.tradeId) check(!getTrade(draft, payout.tradeId).disputed, "Disputed trade cannot dispatch");
        payout.state = "submitting"; payout.dispatchCount += 1; return payout;
      });
      return { shouldDispatch: true, payout };
    },
    recordSubmission(actor: Actor, requestId: string, input: { payoutId: string; outcome: "unknown" | "broadcast"; transactionId?: string }) {
      return command(actor, requestId, "submission-result", input, draft => {
        role(actor, "dispatcher"); const payout = getPayout(draft, input.payoutId);
        check(payout.state === "submitting" || payout.state === "submission_unknown", "Payout cannot accept submission result");
        if (input.outcome === "unknown") { check(!input.transactionId, "Unknown outcome must not replace a transaction identity"); payout.state = "submission_unknown"; }
        else {
          check(input.outcome === "broadcast" && input.transactionId && /^sim-tx-[A-Za-z0-9_-]{1,80}$/.test(input.transactionId), "Simulation transaction identity required");
          payout.transactionId = input.transactionId; payout.state = "broadcast";
        }
        return payout;
      });
    },
    confirmPayout(actor: Actor, requestId: string, receipt: PayoutReceipt) {
      return command(actor, requestId, "payout-receipt", receipt, (draft, op) => {
        role(actor, "verifier"); assertAsset(receipt); const payout = getPayout(draft, receipt.payoutId);
        check(payout.assetId === receipt.assetId && payout.destination === receipt.destination && payout.amountRaw === parseRawUnits(receipt.amountRaw)
          && payout.providerReference === receipt.providerReference, "Receipt does not match immutable payout intent");
        check(receipt.finalized === true, "Payout is not finalized"); check(typeof receipt.successful === "boolean", "Invalid payout execution evidence");
        if (payout.transactionId) check(payout.transactionId === receipt.transactionId, "Receipt transaction does not match original submission");
        const key = eventKey(receipt); check(!draft.deposits.has(key), "Chain event already consumed as an incoming deposit");
        const owner = draft.receipts.get(key);
        if (payout.state === "confirmed") { check(owner === payout.id && receipt.successful, "Conflicting payout receipt"); return payout; }
        if (payout.state === "failed_final") { check(owner === payout.id && !receipt.successful, "Conflicting terminal failure receipt"); return payout; }
        check(!owner, "Payout receipt already consumed");
        check(["submitting", "submission_unknown", "broadcast"].includes(payout.state), "Payout has not been dispatched");
        payout.transactionId = receipt.transactionId; draft.receipts.set(key, payout.id);
        if (!receipt.successful) { payout.state = "failed_final"; return payout; }
        // Even if paused/disputed after dispatch, record real settlement in the model; do not erase it.
        transfer(draft, op, payout.assetId, `payout:${payout.id}`, "external", payout.amountRaw); payout.state = "confirmed";
        if (payout.tradeId) {
          const trade = getTrade(draft, payout.tradeId); trade.status = "completed";
          check(!draft.commissions.has(trade.id), "Commission already exists");
          draft.commissions.set(trade.id, { tradeId: trade.id, sellerId: trade.sellerId, assetId: trade.assetId, amountRaw: trade.totalFeeRaw, paid: false });
          settleCommissions(draft, trade.sellerId, op);
        }
        return payout;
      });
    },
    reconcileAsset(actor: Actor, requestId: string, input: { assetId: AssetId; observedRaw: string; complete: boolean }) {
      return command(actor, requestId, "reconcile", input, draft => {
        role(actor, "verifier"); assetFor(input.assetId); check(input.complete === true, "Incomplete provider history cannot reconcile custody");
        const observed = parseRawUnits(input.observedRaw); const expected = expectedCustody(draft, input.assetId);
        if (observed !== expected) { draft.haltReason = "Custody assets and ledger liabilities disagree"; return { matched: false, halted: true }; }
        const now = clock(); check(Number.isSafeInteger(now) && now >= 0, "Invalid reconciliation clock");
        draft.reconciliations.set(input.assetId, { expectedRaw: expected, at: now }); return { matched: true, halted: Boolean(draft.haltReason) };
      });
    },
    setNativeFeeReadiness(actor: Actor, requestId: string, input: { assetId: AssetId; ready: boolean }) {
      return command(actor, requestId, "native-fee-readiness", input, draft => {
        role(actor, "operator"); assetFor(input.assetId); check(typeof input.ready === "boolean", "Invalid native fee readiness");
        if (input.ready) draft.gasReady.add(input.assetId); else draft.gasReady.delete(input.assetId); return { ready: input.ready };
      });
    },
    pause(actor: Actor, requestId: string) {
      return command(actor, requestId, "pause", {}, draft => { role(actor, "operator"); draft.haltReason = "Operator emergency pause"; return { halted: true }; });
    },
    getListing(id: string) {
      const listing = getListing(state, id); const availableRaw = balance(state, listing.assetId, `listing:${id}`);
      const status = listing.closed ? "closed" : !listing.funded ? "awaiting_funding" : !listing.approved ? "awaiting_owner_approval"
        : availableRaw > ZERO ? "active" : "no_available_inventory";
      return clone({ ...listing, availableRaw, status, walletPaused: Boolean(state.haltReason) });
    },
    getBalance(assetId: AssetId, account: string) { assetFor(assetId); return balance(state, assetId, account); },
    expectedCustody(assetId: AssetId) { assetFor(assetId); return expectedCustody(state, assetId); },
    getTrade(id: string) { return clone(getTrade(state, id)); },
    getPayout(id: string) { return clone(getPayout(state, id)); },
    snapshot() { return clone(state); },
    assertInvariants() { assertLedgerInvariants(state); return true; },
    assetIds: Object.keys(SANDBOX_ASSETS) as AssetId[],
  };
  return Object.freeze(api);
}

export type HydratedV2Kernel = ReturnType<typeof createHydratedV2Kernel>;
