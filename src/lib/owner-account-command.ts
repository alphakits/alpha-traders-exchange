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
/** A legacy HTTP 400 may be thrown after persistence; it is not a rollback receipt. */
export function classifyOwnerCommandFailure(status: number, payload: unknown): Exclude<OwnerAccountCommandResult, { outcome: "saved" }> {
  if (status === 401) return { outcome: "rejected", code: "sign_in_required", status };
  if (status === 403) return { outcome: "rejected", code: "owner_access_required", status };
  if (status === 429) return { outcome: "rejected", code: "rate_limited", status };
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as { code?: unknown; commandOutcome?: unknown; mutationAttempted?: unknown } : null;
  if (status === 400 && body?.code === "owner_command_validation" && body.commandOutcome === "rejected" && body.mutationAttempted === false) {
    return { outcome: "rejected", code: "invalid_command", status };
  }
  return { outcome: "unknown", code: status === 408 ? "request_timeout" : status >= 500 ? "server_error" : "unconfirmed_error_response" };
}

/** Bounded single attempt, including body parsing. Never retries or claims abort rolls back a write. */
export async function requestOwnerCommandOnce(
  path: string, method: "POST" | "PATCH", body: Record<string, unknown>, fetcher: typeof fetch, timeoutMs: number,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("invalid_timeout");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error("timeout")); controller.abort(); }, timeoutMs);
  });
  const operation = (async () => {
    const response = await fetcher(path, {
      method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    // Authentication/throttle gates can be displayed without waiting on an error body.
    if (!response.ok && [401, 403, 429].includes(response.status)) return { ok: false, status: response.status, payload: null };
    let payload: unknown;
    try { payload = await response.json(); }
    catch {
      if (response.ok) throw new Error("invalid_response");
      payload = null;
    }
    return { ok: response.ok, status: response.status, payload };
  })();
  try { return await Promise.race([operation, deadline]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
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
  const accountId = target.id;
  if (inFlightAccounts.has(accountId)) return { outcome: "rejected", code: "command_in_progress" };
  let plan: ReturnType<typeof planOwnerAccountCommand>;
  try { plan = planOwnerAccountCommand(target, command, reason, role); }
  catch { return { outcome: "rejected", code: "invalid_command" }; }
  inFlightAccounts.add(accountId);
  try {
    const response = await requestOwnerCommandOnce(plan.path, "POST", plan.body, fetcher, timeoutMs);
    if (!response.ok) return classifyOwnerCommandFailure(response.status, response.payload);
    if (!response.payload || typeof response.payload !== "object" || Array.isArray(response.payload)) {
      return { outcome: "unknown", code: "invalid_response" };
    }
    const payload = response.payload as Record<string, unknown>;
    const seller = payload.seller as { id?: string; sellerStatus?: string } | undefined;
    const enforcement = payload.enforcement as { latestRecord?: { sellerId?: string; status?: string } } | undefined;
    const confirmed = command === "suspend" ? seller?.id === accountId && seller.sellerStatus === "suspended"
      : command === "reactivate" ? seller?.id === accountId && seller.sellerStatus === "approved_seller"
      : command === "revoke_seller" ? enforcement?.latestRecord?.sellerId === accountId && enforcement.latestRecord.status === "revoked"
      : payload.success === true;
    return confirmed ? { outcome: "saved", payload } : { outcome: "unknown", code: "unconfirmed_response" };
  } catch (cause) {
    const code = cause instanceof Error && ["timeout", "invalid_response"].includes(cause.message) ? cause.message : "connection_lost";
    return { outcome: "unknown", code };
  } finally { inFlightAccounts.delete(accountId); }
}
