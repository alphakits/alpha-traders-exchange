"use client";

import { isFxReferenceUsable } from "@/lib/fx-reference-policy";
import { useCallback, useSyncExternalStore } from "react";
import { createMarketFeedStore, DEFAULT_MARKET_REFRESH_MS } from "@/lib/market-feed-client";

// Public prices only: account, listing and trade responses never enter this store.
// Effects subscribe in the browser; server rendering always reads the empty state.
const feed = createMarketFeedStore();

export function useMarketFeed(options?: { refreshMs?: number }) {
  const refreshMs = options?.refreshMs ?? DEFAULT_MARKET_REFRESH_MS;
  const subscribe = useCallback((listener: () => void) => feed.subscribe(listener, refreshMs), [refreshMs]);
  const state = useSyncExternalStore(subscribe, feed.getSnapshot, feed.getServerSnapshot);
  const hasLiveFeed = Boolean(state.snapshot?.status === "live" && isFxReferenceUsable(state.snapshot) && !state.snapshot.stale && !state.error);
  return { ...state, hasLiveFeed, refresh: feed.refresh };
}
