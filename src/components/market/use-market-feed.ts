"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { MarketSnapshot } from "@/types/market";

type MarketFeedState = {
  snapshot: MarketSnapshot | null;
  isLoading: boolean;
  error: string | null;
};

const DEFAULT_REFRESH_MS = 45_000;

export function useMarketFeed(options?: { refreshMs?: number }) {
  const refreshMs = options?.refreshMs ?? DEFAULT_REFRESH_MS;
  const [state, setState] = useState<MarketFeedState>({ snapshot: null, isLoading: true, error: null });

  const loadFeed = useCallback(async () => {
    try {
      const response = await fetch("/api/market/center", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load market data");
      const payload = (await response.json()) as { snapshot?: MarketSnapshot };
      if (!payload.snapshot) throw new Error("Invalid market response");
      setState({ snapshot: payload.snapshot, isLoading: false, error: null });
    } catch {
      setState((prev) => ({ snapshot: prev.snapshot, isLoading: false, error: "Market feed unavailable" }));
    }
  }, []);

  useEffect(() => {
    loadFeed();
    const id = window.setInterval(loadFeed, refreshMs);
    return () => window.clearInterval(id);
  }, [loadFeed, refreshMs]);

  const hasLiveFeed = useMemo(() => Boolean(state.snapshot && state.snapshot.status === "live"), [state.snapshot]);
  return { ...state, hasLiveFeed, refresh: loadFeed };
}
