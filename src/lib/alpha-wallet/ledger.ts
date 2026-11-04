import { assetFor, MAX_RAW_UNITS, ZERO, type AssetId } from "./amounts";
import type { State } from "./types";

export function accountKey(assetId: AssetId, account: string) { return `${assetId}|${account}`; }
export function balance(state: State, assetId: AssetId, account: string) { return state.accounts.get(accountKey(assetId, account)) ?? ZERO; }
export function expectedCustody(state: State, assetId: AssetId) { return -balance(state, assetId, "external"); }

/** Called only inside a sandbox command's copy-on-write transaction. */
export function transfer(state: State, operation: string, assetId: AssetId, from: string, to: string, amount: bigint) {
  assetFor(assetId);
  if (amount <= ZERO || amount > MAX_RAW_UNITS || from === to) throw new Error("Invalid ledger transfer");
  const debit = balance(state, assetId, from) - amount;
  const credit = balance(state, assetId, to) + amount;
  if (from !== "external" && debit < ZERO) throw new Error("Insufficient funds");
  if (to !== "external" && credit > MAX_RAW_UNITS) throw new Error("Balance overflow");
  state.accounts.set(accountKey(assetId, from), debit);
  state.accounts.set(accountKey(assetId, to), credit);
  state.journal.push({ id: `journal-${state.journal.length + 1}`, operation, assetId, entries: [
    { account: from, delta: -amount }, { account: to, delta: amount },
  ] });
}

export function assertLedgerInvariants(state: State) {
  const totals = new Map<string, bigint>();
  const rebuilt = new Map<string, bigint>();
  for (const journal of state.journal) {
    if (journal.entries.reduce((sum, entry) => sum + entry.delta, ZERO) !== ZERO) throw new Error("Unbalanced journal");
    for (const entry of journal.entries) {
      const key = accountKey(journal.assetId, entry.account);
      rebuilt.set(key, (rebuilt.get(key) ?? ZERO) + entry.delta);
    }
  }
  for (const [key, value] of state.accounts) {
    const [assetId, account] = key.split("|");
    if (account !== "external" && value < ZERO) throw new Error("Negative account balance");
    if (value > MAX_RAW_UNITS || value < -MAX_RAW_UNITS) throw new Error("Balance overflow");
    if ((rebuilt.get(key) ?? ZERO) !== value) throw new Error("Journal and balance disagree");
    totals.set(assetId!, (totals.get(assetId!) ?? ZERO) + value);
  }
  for (const [key, value] of rebuilt) {
    if ((state.accounts.get(key) ?? ZERO) !== value) throw new Error("Journal-derived balance is missing or corrupt");
  }
  for (const value of totals.values()) if (value !== ZERO) throw new Error("Asset conservation failed");
  for (const listing of state.listings.values()) {
    if (!listing.funded || listing.closed) continue;
    const committed = [...state.trades.values()].filter(t => t.listingId === listing.id && t.status !== "cancelled")
      .reduce((sum, trade) => sum + trade.amountRaw, ZERO);
    if (balance(state, listing.assetId, `listing:${listing.id}`) + committed !== listing.amountRaw) throw new Error("Listing principal conservation failed");
  }
  for (const trade of state.trades.values()) {
    const reserved = balance(state, trade.assetId, `trade:${trade.id}`);
    const shouldReserve = !["completed", "cancelled", "payout_pending"].includes(trade.status);
    if (reserved !== (shouldReserve ? trade.amountRaw : ZERO)) throw new Error("Trade reservation mismatch");
  }
  for (const payout of state.payouts.values()) {
    const held = balance(state, payout.assetId, `payout:${payout.id}`);
    if (held !== (payout.state === "confirmed" ? ZERO : payout.amountRaw)) throw new Error("Payout reservation mismatch");
  }
}
