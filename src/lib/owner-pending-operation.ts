/** Browser-session recovery only; this is never authorization or a server receipt. */
export type OwnerPendingOperation = {
  id: string;
  targetId: string;
  command: "disable" | "enable" | "suspend" | "reactivate" | "revoke_seller" | "change_role" | "rank" | "dashboard_action";
  value?: string;
  outcome: "pending" | "saved" | "unknown";
};
const KEY = "alpha-owner-pending-operations-v1";
export const OWNER_OPERATION_EVENT = "alpha-owner-operation-change";
const commands = ["disable", "enable", "suspend", "reactivate", "revoke_seller", "change_role", "rank", "dashboard_action"];
export function readOwnerPendingOperations(): OwnerPendingOperation[] {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return [];
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.every(row => row && typeof row.id === "string"
    && typeof row.targetId === "string" && commands.includes(row.command)
    && ["pending", "saved", "unknown"].includes(row.outcome)
    && (row.value === undefined || typeof row.value === "string"))) throw new Error("Operation recovery unavailable");
  return rows;
}
function save(rows: OwnerPendingOperation[]) {
  sessionStorage.setItem(KEY, JSON.stringify(rows));
  window.dispatchEvent(new Event(OWNER_OPERATION_EVENT));
}
export function beginOwnerPendingOperation(input: Omit<OwnerPendingOperation, "id" | "outcome">) {
  const rows = readOwnerPendingOperations();
  if (rows.some(row => row.targetId === input.targetId)) throw new Error("Refresh the previous account action first");
  const operation: OwnerPendingOperation = { ...input, id: crypto.randomUUID(), outcome: "pending" };
  // Persist before sending; storage failure cannot leave an untracked request.
  save([...rows, operation]);
  return operation;
}
export function finishOwnerPendingOperation(id: string, outcome: "saved" | "unknown" | "clear") {
  const rows = readOwnerPendingOperations();
  save(outcome === "clear" ? rows.filter(row => row.id !== id)
    : rows.map(row => row.id === id ? { ...row, outcome } : row));
}
