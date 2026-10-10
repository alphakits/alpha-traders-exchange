import { isFxReferenceUsable } from "@/lib/fx-reference-policy";
import type { MarketSnapshot } from "@/types/market";

/** A usable FX market closure is distinct from a missing or failed price feed. */
export function marketFeedStatus(
  snapshot: MarketSnapshot | null,
  error: string | null,
  now = Date.now(),
): "live" | "closed" | "degraded" {
  if (!snapshot || error || snapshot.stale || snapshot.unavailablePairs.length > 0
    || !isFxReferenceUsable(snapshot, now)
    || ![snapshot.pairs.btcUsdt, snapshot.pairs.ethUsdt].every((pair) => Number.isFinite(pair.price) && pair.price > 0)) {
    return "degraded";
  }
  if (snapshot.pairs.usdtIls.quoteStatus === "closed") return "closed";
  return snapshot.status === "live" && snapshot.pairs.usdtIls.quoteStatus === "live" ? "live" : "degraded";
}
