import { classifyOwnerCommandFailure } from "./owner-account-command";
import { beginOwnerPendingOperation, finishOwnerPendingOperation, type OwnerPendingOperation } from "./owner-pending-operation";

export type OwnerDashboardRequest = { path: string; init: RequestInit };
export const prepareOwnerDashboardAction = (path: string, init: RequestInit): OwnerDashboardRequest => ({ path, init });
export type OwnerDashboardActionResult = {
  outcome: "saved" | "unknown" | "rejected" | "blocked";
  operation?: OwnerPendingOperation;
  payload?: Record<string, unknown>;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Validate the actual route's acknowledgment, never just HTTP 200 or an arbitrary JSON body. */
export function acknowledgesOwnerDashboardAction(request: OwnerDashboardRequest, payload: unknown): payload is Record<string, unknown> {
  if (!object(payload) || payload.error) return false;
  const path = request.path;
  if (/\/commissions\/[^/]+\/reverify$/.test(path)) return typeof payload.success === "boolean" && typeof payload.notes === "string";
  if (/\/notifications\/broadcast$/.test(path)) return payload.success === true;
  if (/\/approval-email$/.test(path)) return payload.status === "accepted_for_delivery";
  if (/\/(force-expire|recalculate-all|purge-smoke-test)$/.test(path) || request.init.method === "DELETE") return payload.success === true;
  if (/\/recovery-wallet$/.test(path)) return object(payload.config) && typeof payload.config.walletAddress === "string";
  const routes = [
    { pattern: /\/sellers\/([^/]+)\/profile-state$/, key: "seller" },
    { pattern: /\/seller-applications\/([^/]+)\/(approve|reject)$/, key: "application" },
    { pattern: /\/listings\/([^/]+)$/, key: "listing" },
    { pattern: /\/commissions(?:\/([^/]+))?$/, key: "commission" },
    { pattern: /\/private-beta\/invites(?:\/([^/]+))?$/, key: "invite" },
    { pattern: /\/private-beta\/feedback\/([^/]+)$/, key: "feedback" },
    { pattern: /\/private-beta\/announcements(?:\/([^/]+))?$/, key: "announcement" },
  ];
  for (const { pattern, key } of routes) {
    const match = path.match(pattern);
    if (!match) continue;
    const entity = payload[key];
    return object(entity) && typeof entity.id === "string" && entity.id.length > 0 && (!match[1] || entity.id === decodeURIComponent(match[1]));
  }
  return false;
}

/** Persist before a lazy single attempt; ambiguous outcomes survive navigation and are never replayed. */
export async function executeOwnerDashboardAction(request: OwnerDashboardRequest, fetcher = globalThis.fetch, timeoutMs = 20_000): Promise<OwnerDashboardActionResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { outcome: "blocked" };
  let operation: OwnerPendingOperation;
  try { operation = beginOwnerPendingOperation({ targetId: "dashboard-action", command: "dashboard_action" }); }
  catch { return { outcome: "blocked" }; }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error("timeout")); controller.abort(); }, timeoutMs);
    });
    const response = await Promise.race([(async () => {
      const result = await fetcher(request.path, { ...request.init, credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if ([401, 403, 429].includes(result.status)) return { ok: false, status: result.status, payload: null };
      const payload: unknown = await result.json();
      return { ok: result.ok, status: result.status, payload };
    })(), deadline]);
    const outcome = response.ok
      ? acknowledgesOwnerDashboardAction(request, response.payload) ? "saved" : "unknown"
      : classifyOwnerCommandFailure(response.status, response.payload).outcome;
    finishOwnerPendingOperation(operation.id, outcome === "rejected" ? "clear" : outcome);
    return { outcome, operation, ...(object(response.payload) ? { payload: response.payload } : {}) };
  } catch {
    try { finishOwnerPendingOperation(operation.id, "unknown"); } catch { /* Original pending marker remains protective. */ }
    return { outcome: "unknown", operation };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
