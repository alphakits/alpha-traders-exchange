"use client";

import { useEffect, useState } from "react";
import type { SellerRankSummary } from "@/components/ui/seller-rank-card";
import type { SellerAccountStats } from "@/lib/alpha-exchange-store";
import type { PurchaseRequest } from "@/types/alpha-exchange";

type SellerRankState = { sellerId: string; summary: SellerRankSummary | null; error: boolean };

/** Only the authenticated account endpoint can supply private lifetime totals. */
export function useSellerRankSummary({ sellerId, requests, fetchProfile }: {
  sellerId?: string;
  requests: readonly PurchaseRequest[];
  fetchProfile: (label: string, input: string, init?: RequestInit) => Promise<Response>;
}) {
  const [state, setState] = useState<SellerRankState | null>(null);
  useEffect(() => {
    if (!sellerId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchProfile("Seller rank progress loading", "/api/auth/profile", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Seller rank summary unavailable");
        const payload = await response.json() as { profile?: { id?: string }; stats?: SellerAccountStats };
        if (controller.signal.aborted) return;
        if (payload.profile?.id !== sellerId || payload.stats?.kind !== "seller") throw new Error("Seller rank identity mismatch");
        const { sellerLevel, nextLevel, progressToNextLevelPercent, amountToNextLevelUsdt, lifetimeCompletedVolumeUsdt } = payload.stats;
        setState({ sellerId, summary: { sellerLevel, nextLevel, progressToNextLevelPercent, amountToNextLevelUsdt, lifetimeCompletedVolumeUsdt }, error: false });
      } catch {
        if (controller.signal.aborted) return;
        setState(previous => ({ sellerId, summary: previous?.sellerId === sellerId ? previous.summary : null, error: true }));
      }
    })();
    return () => controller.abort();
  }, [sellerId, requests, fetchProfile]);

  // Hide the previous account's totals immediately, before the next effect runs.
  return state && state.sellerId === sellerId ? state : { summary: null, error: false };
}
