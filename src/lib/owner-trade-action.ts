import { classifyOwnerCommandFailure, requestOwnerCommandOnce } from "./owner-account-command";

export type OwnerTradeAction = "force-complete" | "force-close" | "unlock-review" | "resolve-dispute";
export type PendingTradeAction = { id: string; action: OwnerTradeAction; outcome: "pending" | "saved" | "unknown" };
export const TRADE_ACTION_EVENT = "alpha-trade-action-change";
const actions = ["force-complete", "force-close", "unlock-review", "resolve-dispute"];
const inFlight = new Set<string>();
export const isTradeActionInFlight = (tradeId: string) => inFlight.has(tradeId);
const key = (tradeId: string) => `alpha-pending-trade-action:${encodeURIComponent(tradeId)}`;

/** Only opaque recovery metadata is stored, never private names or reasons. */
export function readPendingTradeAction(tradeId: string): PendingTradeAction | null {
  const raw = sessionStorage.getItem(key(tradeId));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value || typeof value.id !== "string" || !actions.includes(value.action) || !["pending", "saved", "unknown"].includes(value.outcome)) throw new Error("Invalid action recovery state");
  return value;
}
function save(tradeId: string, operation: PendingTradeAction | null) {
  if (operation) sessionStorage.setItem(key(tradeId), JSON.stringify(operation));
  else sessionStorage.removeItem(key(tradeId));
  window.dispatchEvent(new Event(TRADE_ACTION_EVENT));
}
export function clearPendingTradeAction(tradeId: string, operationId: string) {
  if (inFlight.has(tradeId)) throw new Error("Action is still running");
  if (readPendingTradeAction(tradeId)?.id !== operationId) throw new Error("Action recovery changed");
  save(tradeId, null);
}

/** A single bounded attempt. An abort is never treated as a server rollback. */
export async function executeTradeOwnerAction(input: {
  tradeId: string; action: OwnerTradeAction; isOwner: boolean; disputeId?: string; reason: string;
}, fetcher = globalThis.fetch, timeoutMs = 20_000): Promise<{ outcome: "saved" | "unknown" | "rejected" | "blocked" }> {
  let operation: PendingTradeAction;
  try {
    if (!input.tradeId || !actions.includes(input.action) || !input.reason.trim() || input.reason.trim().length > 1000
      || (input.action === "resolve-dispute" && !input.disputeId) || inFlight.has(input.tradeId) || readPendingTradeAction(input.tradeId)) return { outcome: "blocked" };
    operation = { id: crypto.randomUUID(), action: input.action, outcome: "pending" };
    save(input.tradeId, operation);
  } catch { return { outcome: "blocked" }; }
  inFlight.add(input.tradeId);
  try {
    const path = input.action === "resolve-dispute"
      ? `/api/alpha-exchange/admin/disputes/${encodeURIComponent(input.disputeId!)}/resolve`
      : `/api/alpha-exchange/admin/purchase-requests/${encodeURIComponent(input.tradeId)}/${input.action === "force-close" && !input.isOwner ? "force-cancel" : input.action}`;
    const result = await requestOwnerCommandOnce(path, "POST", input.action === "resolve-dispute"
      ? { resolutionNotes: input.reason.trim() } : { reason: input.reason.trim() }, fetcher, timeoutMs);
    const payload = result.payload as { success?: unknown; error?: unknown; dispute?: { id?: unknown; status?: unknown } } | null;
    const acknowledged = input.action === "resolve-dispute"
      ? payload?.dispute?.id === input.disputeId && payload?.dispute?.status === "resolved"
      : payload?.success === true;
    const outcome = result.ok ? acknowledged && !payload?.error ? "saved" : "unknown"
      : classifyOwnerCommandFailure(result.status, result.payload).outcome;
    if (readPendingTradeAction(input.tradeId)?.id === operation.id) save(input.tradeId, outcome === "rejected" ? null : { ...operation, outcome });
    return { outcome };
  } catch {
    try { if (readPendingTradeAction(input.tradeId)?.id === operation.id) save(input.tradeId, { ...operation, outcome: "unknown" }); } catch { /* Persisted pending marker still blocks repeats. */ }
    return { outcome: "unknown" };
  } finally { inFlight.delete(input.tradeId); window.dispatchEvent(new Event(TRADE_ACTION_EVENT)); }
}
