import { classifyOwnerCommandFailure, requestOwnerCommandOnce } from "./owner-account-command";
/** Client orchestration only. All writes still use the existing authorized prestige endpoint. */
export const OWNER_RANKS = ["bronze", "silver", "gold", "diamond", "elite"] as const;
export type OwnerRank = typeof OWNER_RANKS[number];
export type OwnerRankBatchAction = "promote" | "demote" | "set" | "reset";
export type OwnerRankTarget = {
  id: string; fullName: string; role: string; roles?: readonly string[];
  sellerPrestigeRank?: string; sellerRankOverride?: unknown;
};
export type OwnerRankItem = {
  id: string; fullName: string; before: OwnerRank; after: OwnerRank;
  outcome: "verified" | "saved_unverified" | "unknown" | "rejected" | "unchanged" | "protected" | "not_attempted";
  status?: number;
  automatic?: boolean;
};
export type OwnerRankBatchResult = {
  items: OwnerRankItem[];
  verified: number; savedUnverified: number; unknown: number; rejected: number;
  unchanged: number; protected: number; notAttempted: number;
  /** True only when every attempted change has fresh readback, or no change was needed. */
  complete: boolean;
};
export type OwnerRankBatchOptions = {
  fetcher?: typeof fetch;
  refresh: () => Promise<readonly OwnerRankTarget[] | null>;
  timeoutMs?: number;
  isActive?: () => boolean;
  clearOverride?: boolean;
};
const activeTargets = new Set<string>();
const rankValue = (value: unknown): value is OwnerRank => typeof value === "string" && (OWNER_RANKS as readonly string[]).includes(value);
const protectedTarget = (target: OwnerRankTarget) => target.role === "owner" || target.roles?.includes("owner") === true;
function summarize(items: OwnerRankItem[]): OwnerRankBatchResult {
  const count = (outcome: OwnerRankItem["outcome"]) => items.filter(item => item.outcome === outcome).length;
  const verified = count("verified"), savedUnverified = count("saved_unverified"), unknown = count("unknown"), rejected = count("rejected");
  const unchanged = count("unchanged"), protectedCount = count("protected"), notAttempted = count("not_attempted");
  return { items, verified, savedUnverified, unknown, rejected, unchanged, protected: protectedCount, notAttempted,
    complete: items.length > 0 && savedUnverified === 0 && unknown === 0 && rejected === 0 && notAttempted === 0 && protectedCount === 0 };
}
export function planOwnerRankBatch(targets: readonly OwnerRankTarget[], action: OwnerRankBatchAction, targetRank?: OwnerRank): OwnerRankItem[] {
  if (!["promote", "demote", "set", "reset"].includes(action) || (action === "set" && !rankValue(targetRank))) throw new Error("Invalid rank action.");
  const seen = new Set<string>();
  return targets.map(target => {
    if (!target.id.trim() || seen.has(target.id)) throw new Error("Missing or duplicate rank target.");
    seen.add(target.id);
    const before = target.sellerPrestigeRank ?? "bronze";
    if (!rankValue(before)) throw new Error("Unknown current rank; refresh before changing it.");
    const index = OWNER_RANKS.indexOf(before);
    const after = action === "promote" ? OWNER_RANKS[Math.min(index + 1, OWNER_RANKS.length - 1)]
      : action === "demote" ? OWNER_RANKS[Math.max(index - 1, 0)]
        : action === "reset" ? "bronze" : targetRank!;
    return { id: target.id, fullName: target.fullName, before, after,
      outcome: protectedTarget(target) ? "protected" : before === after && (action === "promote" || action === "demote") ? "unchanged" : "not_attempted" };
  });
}
/** Sequential single attempts; uncertain writes are never replayed, even after a readback failure. */
export async function executeOwnerRankBatch(
  targets: readonly OwnerRankTarget[], action: OwnerRankBatchAction, reason: string,
  targetRank: OwnerRank | undefined, options: OwnerRankBatchOptions,
): Promise<OwnerRankBatchResult> {
  if (!reason.trim()) throw new Error("A reason is required.");
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid request timeout.");
  const items = planOwnerRankBatch(targets, action, targetRank);
  if (options.clearOverride) for (const item of items) item.automatic = true;
  const requested = items.filter(item => item.outcome === "not_attempted");
  // Reserve the whole batch synchronously before any await. A competing batch is not started partially.
  if (requested.some(item => activeTargets.has(item.id))) return summarize(items);
  for (const item of requested) activeTargets.add(item.id);
  const fetcher = options.fetcher ?? globalThis.fetch;
  try {
    let stopped = false;
    for (const item of requested) {
      if (stopped || options.isActive?.() === false) break;
      try {
        const response = await requestOwnerCommandOnce(
          `/api/alpha-exchange/admin/sellers/${encodeURIComponent(item.id)}/prestige`, "PATCH",
          { rank: item.after, reason: reason.trim(), ...(options.clearOverride ? { clearOverride: true } : {}) }, fetcher, timeoutMs,
        );
        item.status = response.status;
        if (!response.ok) {
          item.outcome = classifyOwnerCommandFailure(response.status, response.payload).outcome;
          if (item.outcome === "unknown" || [401, 403, 429].includes(response.status)) stopped = true;
          continue;
        }
        const payload = response.payload;
        const seller = payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as { seller?: OwnerRankTarget }).seller : null;
        if (!seller || seller.id !== item.id || (options.clearOverride ? Boolean(seller.sellerRankOverride) : seller.sellerPrestigeRank !== item.after) || protectedTarget(seller)) {
          item.outcome = "unknown"; stopped = true; continue;
        }
        item.outcome = "saved_unverified";
      } catch {
        item.outcome = "unknown";
        stopped = true;
      }
    }
    // One shared read instead of one complete admin snapshot for every seller.
    if (options.isActive?.() !== false && requested.some(item => item.outcome === "saved_unverified" || item.outcome === "unknown")) {
      let fresh: readonly OwnerRankTarget[] | null = null;
      try { fresh = await options.refresh(); } catch { /* A read failure does not undo an acknowledged write. */ }
      if (Array.isArray(fresh)) {
        for (const item of requested) {
          const matches = fresh.filter(target => target?.id === item.id);
          if (item.outcome === "saved_unverified" && matches.length === 1
            && (options.clearOverride ? !matches[0].sellerRankOverride : matches[0].sellerPrestigeRank === item.after) && !protectedTarget(matches[0])) item.outcome = "verified";
          // Matching rank alone cannot prove an ambiguous set/reset or another admin's concurrent change was ours.
          // Unknown remains unknown until the existing audit/receipt evidence resolves it.
        }
      }
    }
    return summarize(items);
  } finally { for (const item of requested) activeTargets.delete(item.id); }
}
