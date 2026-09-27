import type { DiscordManagementDiagnostics } from "./management";
import { requestOwnerCommandOnce } from "@/lib/owner-account-command";

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const textOrNull = (value: unknown) => value === null || typeof value === "string";
const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nullableCount = (value: unknown) => value === null || count(value);
const counts = (value: unknown, keys: string[]) => record(value) && keys.every(key => count(value[key]));
const rows = (value: unknown, validate: (row: Record<string, unknown>) => boolean) => Array.isArray(value) && value.every(row => record(row) && validate(row));
const member = (value: unknown, values: string[]) => typeof value === "string" && values.includes(value);
const requestStates = ["pending", "processing", "completed", "dead"];

/** Validate the nested fields used by the operator view before rendering them. */
export function isDiscordManagementDiagnostics(value: unknown): value is DiscordManagementDiagnostics {
  if (!record(value) || !member(value.status, ["healthy", "degraded", "blocked", "offline"])
    || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) return false;
  const { worker, resources, database: db, commands } = value;
  if (!record(worker) || !record(worker.deployment) || !member(worker.status, ["healthy", "degraded"])
    || typeof worker.ready !== "boolean" || typeof worker.connected !== "boolean" || typeof worker.readyState !== "string"
    || !nullableCount(worker.apiLatencyMs) || !nullableCount(worker.connectionUptimeMs)
    || !textOrNull(worker.deployment.revision) || !textOrNull(worker.deployment.environment)
    || !(worker.error === null || (record(worker.error) && typeof worker.error.code === "string" && typeof worker.error.message === "string"))) return false;
  if (!record(resources) || !member(resources.status, ["ready", "degraded"])
    || ![resources.total, resources.ready, resources.missing].every(nullableCount) || !textOrNull(resources.errorCode)) return false;
  if (!record(commands) || !member(commands.status, ["ready", "degraded"])
    || !Array.isArray(commands.names) || !commands.names.every(name => typeof name === "string")
    || !count(commands.expected) || !nullableCount(commands.registered)
    || !textOrNull(commands.lastReconciledAt) || !textOrNull(commands.errorCode)) return false;
  if (!record(db) || !counts(db.identities, ["connected"]) || !counts(db.approvedSellerRoleSync, ["synced", "pending", "failed"])
    || !record(db.listings) || !counts(db.listings, ["activePosts", "cooldownClaims"])
    || !counts(db.listings.lifecycle, ["queued", "publishing", "active", "update_pending", "delete_pending", "sold", "deleted", "failed"])
    || !counts(db.listings.jobs, ["pending", "processing", "completed", "dead", "staleLeases", "failures"])
    || !counts(db.notifications, ["pending", "processing", "completed", "dead", "suppressed"])
    || !counts(db.interactions, ["accepted24h", "rateLimited24h", "replayed24h"])
    || !record(db.operatorRequests) || !counts(db.operatorRequests, ["pending", "processing", "dead", "staleLeases"])) return false;
  const latest = db.operatorRequests.latest;
  return (latest === null || (record(latest) && member(latest.status, requestStates) && textOrNull(latest.resultCode) && typeof latest.updatedAt === "string"))
    && rows(db.marketContent, row => typeof row.key === "string" && typeof row.state === "string" && textOrNull(row.lastSuccessAt) && textOrNull(row.errorCode))
    && rows(db.recentErrors, row => typeof row.source === "string" && typeof row.code === "string" && typeof row.occurredAt === "string")
    && rows(value.topology, row => typeof row.key === "string" && typeof row.type === "string" && typeof row.name === "string")
    && Array.isArray(value.privilegedIntents) && value.privilegedIntents.every(intent => typeof intent === "string");
}

/** Cancellation and deadline cover the transport and body, including transports ignoring abort. */
export async function readDiscordManagementDiagnostics(signal: AbortSignal, fetcher = globalThis.fetch, timeoutMs = 15_000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid diagnostics deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => { reject(new Error("Diagnostics cancelled")); controller.abort(); };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => { reject(new Error("Diagnostics timed out")); controller.abort(); }, timeoutMs);
  });
  const request = (async () => {
    if (signal.aborted) { cancel(); throw new Error("Diagnostics cancelled"); }
    const response = await fetcher("/api/admin/discord/diagnostics", {
      credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal,
    });
    // Authorization loss clears private data without depending on a response body.
    if (!response.ok && response.status !== 503) return { status: response.status, payload: null };
    const payload: unknown = await response.json();
    if (!isDiscordManagementDiagnostics(payload)) throw new Error("Invalid diagnostics response");
    return { status: response.status, payload };
  })();
  try { return await Promise.race([request, deadline]); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
}

const PENDING_KEY = "alpha-discord-reconciliation-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function pendingDiscordReconciliation() {
  const key = sessionStorage.getItem(PENDING_KEY);
  if (key !== null && !UUID.test(key)) throw new Error("Request recovery unavailable");
  return key;
}
type ReconciliationAcknowledgment = {
  disposition: "accepted" | "coalesced" | "replayed";
  status: "pending" | "processing" | "completed" | "dead";
  resultCode: string | null;
};
export async function submitDiscordReconciliation(): Promise<
  | { outcome: "acknowledged"; payload: ReconciliationAcknowledgment }
  | { outcome: "blocked" | "denied" | "unknown" }
> {
  let key: string;
  try {
    key = pendingDiscordReconciliation() ?? crypto.randomUUID();
    sessionStorage.setItem(PENDING_KEY, key);
  } catch { return { outcome: "blocked" }; }
  try {
    const response = await requestOwnerCommandOnce("/api/admin/discord/reconcile", "POST", {
      confirmation: "reconcile_managed_integration", idempotencyKey: key,
    }, globalThis.fetch, 20_000);
    if ([401, 403].includes(response.status)) return { outcome: "denied" };
    const payload = response.payload;
    if (!response.ok || !record(payload) || payload.action !== "reconcile_managed_integration"
      || !member(payload.disposition, ["accepted", "coalesced", "replayed"]) || !member(payload.status, requestStates)
      || typeof payload.acceptedAt !== "string" || !Number.isFinite(Date.parse(payload.acceptedAt)) || !textOrNull(payload.resultCode)) return { outcome: "unknown" };
    // Only a valid server acknowledgment permits a new request key. A cleanup
    // failure retains a harmless replay key and cannot erase confirmed acceptance.
    try { if (pendingDiscordReconciliation() === key) sessionStorage.removeItem(PENDING_KEY); } catch { /* Reuse the same key on explicit retry. */ }
    return { outcome: "acknowledged", payload: payload as ReconciliationAcknowledgment };
  } catch { return { outcome: "unknown" }; }
}
