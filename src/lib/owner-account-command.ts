/** UI command planning only. Every existing API must still authorize the owner. */
export type OwnerAccountTarget = {
  id: string;
  fullName: string;
  role: string;
  roles?: readonly string[];
  sellerStatus?: string;
  disabled?: boolean;
};
export const OWNER_EDITABLE_ROLES = ["guest", "student", "buyer", "admin"] as const;
export type OwnerEditableRole = (typeof OWNER_EDITABLE_ROLES)[number];
export type OwnerAccountCommand = "change_role" | "disable" | "enable" | "suspend" | "reactivate" | "revoke_seller";

export function isProtectedOwnerTarget(target: OwnerAccountTarget): boolean {
  // Protect even a disabled owner; disabled is not permission to demote the root account.
  return target.role === "owner" || target.roles?.includes("owner") === true;
}
export function requiresSellerControls(target: OwnerAccountTarget): boolean {
  return ["approved_seller", "pending_seller_approval", "suspended"].includes(target.sellerStatus ?? "")
    || [target.role, ...(target.roles ?? [])].some(role => role === "approved_seller" || role === "pending_seller_approval");
}
export function availableOwnerAccountCommands(target: OwnerAccountTarget): OwnerAccountCommand[] {
  if (!target.id.trim() || isProtectedOwnerTarget(target)) return [];
  const actions: OwnerAccountCommand[] = [target.disabled ? "enable" : "disable"];
  if (requiresSellerControls(target)) {
    if (target.sellerStatus === "suspended" && !target.disabled) actions.push("reactivate");
    else if (target.role === "approved_seller" || target.roles?.includes("approved_seller") || target.sellerStatus === "approved_seller") actions.push("suspend");
    if (target.sellerStatus === "suspended" || target.sellerStatus === "approved_seller" || target.role === "approved_seller" || target.roles?.includes("approved_seller")) actions.push("revoke_seller");
  } else actions.push("change_role");
  return actions;
}
export function planOwnerAccountCommand(target: OwnerAccountTarget, command: OwnerAccountCommand, reason: string, role?: OwnerEditableRole) {
  if (!availableOwnerAccountCommands(target).includes(command)) throw new Error("Command not available for this account state.");
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("A reason is required.");
  const id = encodeURIComponent(target.id);
  const body: Record<string, string | boolean> = { reason: trimmedReason };
  let path: string;
  if (command === "change_role") {
    if (!OWNER_EDITABLE_ROLES.includes(role as OwnerEditableRole)) throw new Error("Choose a supported role.");
    body.role = role!;
    path = `/api/alpha-exchange/admin/users/${id}/role`;
  } else if (command === "disable" || command === "enable") {
    body.disabled = command === "disable";
    path = `/api/alpha-exchange/admin/users/${id}/disable`;
  } else if (command === "revoke_seller") {
    body.action = "revoke_seller";
    path = `/api/alpha-exchange/admin/sellers/${id}/enforcement`;
  } else path = `/api/alpha-exchange/admin/sellers/${id}/${command}`;
  return { path, body };
}

export type OwnerAccountCommandResult =
  | { outcome: "saved"; payload: Record<string, unknown> }
  | { outcome: "rejected"; code: string; status?: number }
  | { outcome: "unknown"; code: string };
/** Only a fresh server-derived account snapshot can reconcile a command. */
export function matchesOwnerAccountCommandState(target: OwnerAccountTarget, command: OwnerAccountCommand, role?: OwnerEditableRole): boolean {
  // Reconcile both authority representations. An inconsistent response must never
  // hide an old primary seller/admin role merely because its additive list differs.
  const roles = [target.role, ...(target.roles ?? [])];
  const hasSellerRole = roles.includes("approved_seller") || roles.includes("pending_seller_approval");
  if (command === "disable") return target.disabled === true;
  if (command === "enable") return target.disabled === false;
  if (command === "suspend") return target.sellerStatus === "suspended" && !hasSellerRole;
  if (command === "reactivate") {
    return target.sellerStatus === "approved_seller" && target.disabled === false && roles.includes("approved_seller");
  }
  if (command === "revoke_seller") return target.sellerStatus === "buyer" && !hasSellerRole;
  if (command !== "change_role" || !role || !OWNER_EDITABLE_ROLES.includes(role)) return false;
  return target.role === role
    && (!target.roles || target.roles.includes(role))
    && !requiresSellerControls(target)
    && (role === "admin" || !roles.includes("admin"));
}
const inFlightAccounts = new Set<string>();

/** One explicit command, no retry/replay. Transport failure never means confirmed rejection. */
export async function executeOwnerAccountCommand(
  target: OwnerAccountTarget,
  command: OwnerAccountCommand,
  reason: string,
  role?: OwnerEditableRole,
  fetcher: typeof fetch = globalThis.fetch,
  timeoutMs = 20_000,
): Promise<OwnerAccountCommandResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { outcome: "rejected", code: "invalid_timeout" };
  if (inFlightAccounts.has(target.id)) return { outcome: "rejected", code: "command_in_progress" };
  let plan: ReturnType<typeof planOwnerAccountCommand>;
  try { plan = planOwnerAccountCommand(target, command, reason, role); }
  catch { return { outcome: "rejected", code: "invalid_command" }; }
  inFlightAccounts.add(target.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(plan.path, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.body), signal: controller.signal,
    });
    if (!response.ok) {
      // A request timeout does not prove the server rolled back the command.
      if (response.status === 408) return { outcome: "unknown", code: "request_timeout" };
      if (response.status >= 500) return { outcome: "unknown", code: "server_error" };
      return { outcome: "rejected", code: response.status === 401 ? "sign_in_required" : response.status === 403 ? "owner_access_required" : "server_rejected", status: response.status };
    }
    let payload: Record<string, unknown>;
    try {
      payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid response");
    } catch { return { outcome: "unknown", code: "invalid_response" }; }
    const seller = payload.seller as { id?: string; sellerStatus?: string } | undefined;
    const enforcement = payload.enforcement as { latestRecord?: { sellerId?: string; status?: string } } | undefined;
    const confirmed = command === "suspend" ? seller?.id === target.id && seller.sellerStatus === "suspended"
      : command === "reactivate" ? seller?.id === target.id && seller.sellerStatus === "approved_seller"
      : command === "revoke_seller" ? enforcement?.latestRecord?.sellerId === target.id && enforcement.latestRecord.status === "revoked"
      : payload.success === true;
    return confirmed ? { outcome: "saved", payload } : { outcome: "unknown", code: "unconfirmed_response" };
  } catch { return { outcome: "unknown", code: controller.signal.aborted ? "timeout" : "connection_lost" }; }
  finally { clearTimeout(timeout); inFlightAccounts.delete(target.id); }
}
