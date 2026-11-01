"use client";

import { useEffect, useState } from "react";
import { deriveBuyerRankSummary, type BuyerRankSummary } from "@/lib/buyer-rank";
import type { BuyerAccountStats } from "@/lib/alpha-exchange-store";
import type { PurchaseRequest } from "@/types/alpha-exchange";

type BuyerRankState = { buyerId: string; summary: BuyerRankSummary | null; error: boolean };

/** Scope private purchase totals to the authenticated account that requested them. */
export function useBuyerRankSummary({ buyerId, requests, fetchProfile }: {
  buyerId?: string;
  requests: readonly PurchaseRequest[];
  fetchProfile: (label: string, input: string, init?: RequestInit) => Promise<Response>;
}) {
  const [state, setState] = useState<BuyerRankState | null>(null);
  useEffect(() => {
    if (!buyerId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetchProfile("Buyer profile summary loading", "/api/auth/profile", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Buyer rank summary unavailable");
        const payload = await response.json() as { profile?: { id?: string }; stats?: BuyerAccountStats };
        if (controller.signal.aborted) return;
        if (payload.profile?.id !== buyerId || payload.stats?.kind !== "buyer") throw new Error("Buyer rank identity mismatch");
        const { activeTrades, completedTrades, reviewsGiven, lifetimeCompletedVolumeUsdt } = payload.stats;
        if ([activeTrades, completedTrades, reviewsGiven, lifetimeCompletedVolumeUsdt].some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
          throw new Error("Invalid buyer rank summary");
        }
        setState({ buyerId, summary: deriveBuyerRankSummary({ activeTrades, completedTrades, reviewsGiven, lifetimeCompletedVolumeUsdt }), error: false });
      } catch {
        if (controller.signal.aborted) return;
        setState(previous => ({ buyerId, summary: previous?.buyerId === buyerId ? previous.summary : null, error: true }));
      }
    })();
    return () => controller.abort();
  }, [buyerId, requests, fetchProfile]);

  // Account changes must hide old totals during render, before effects run.
  return state && state.buyerId === buyerId ? state : { summary: null, error: false };
}
