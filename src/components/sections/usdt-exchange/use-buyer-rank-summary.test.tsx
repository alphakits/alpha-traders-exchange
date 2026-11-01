import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { useBuyerRankSummary } from "./use-buyer-rank-summary";

const requests: PurchaseRequest[] = [];
const responseFor = (buyerId: string, total = 15_000) => Response.json({
  profile: { id: buyerId },
  stats: { kind: "buyer", lifetimeCompletedVolumeUsdt: total, activeTrades: 0, completedTrades: 1, reviewsGiven: 1 },
});

afterEach(cleanup);

describe("private buyer rank summary", () => {
  it("does not request private totals without an active buyer identity", () => {
    const fetchProfile = vi.fn();
    const { result } = renderHook(() => useBuyerRankSummary({ requests, fetchProfile }));
    expect(result.current).toEqual({ summary: null, error: false });
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("refreshes the full purchase total and Silver rank after completed trades change", async () => {
    const fetchProfile = vi.fn().mockResolvedValueOnce(responseFor("buyer-a", 14_672.94)).mockResolvedValueOnce(responseFor("buyer-a"));
    const { result, rerender } = renderHook(({ trades }) => useBuyerRankSummary({ buyerId: "buyer-a", requests: trades, fetchProfile }), { initialProps: { trades: requests } });
    await waitFor(() => expect(result.current.summary?.key).toBe("bronze"));
    expect(fetchProfile.mock.calls[0][1]).toBe("/api/auth/profile");
    expect(fetchProfile.mock.calls[0][2]).toMatchObject({ cache: "no-store", signal: expect.any(AbortSignal) });
    rerender({ trades: [...requests] });
    await waitFor(() => expect(result.current.summary?.key).toBe("silver"));
    expect(result.current.summary).toMatchObject({ lifetimeCompletedVolumeUsdt: 15_000, completedTrades: 1, remainingVolumeUsdt: 35_000 });
  });

  it("rejects another account's private totals", async () => {
    const fetchProfile = vi.fn().mockResolvedValue(responseFor("buyer-other"));
    const { result } = renderHook(() => useBuyerRankSummary({ buyerId: "buyer-a", requests, fetchProfile }));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.summary).toBeNull();
  });

  it("hides the previous buyer's totals immediately on account switch and sign-out", async () => {
    const fetchProfile = vi.fn().mockResolvedValueOnce(responseFor("buyer-a")).mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const { result, rerender } = renderHook(({ buyerId }: { buyerId?: string }) => useBuyerRankSummary({ buyerId, requests, fetchProfile }), { initialProps: { buyerId: "buyer-a" } as { buyerId?: string } });
    await waitFor(() => expect(result.current.summary?.key).toBe("silver"));
    rerender({ buyerId: "buyer-b" });
    expect(result.current.summary).toBeNull();
    rerender({ buyerId: undefined });
    expect(result.current.summary).toBeNull();
    expect(fetchProfile.mock.calls[1][2].signal.aborted).toBe(true);
  });

  it("discards an old account response that resolves after switching buyers", async () => {
    let resolveOld!: (response: Response) => void;
    const fetchProfile = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(responseFor("buyer-b", 50_000));
    const { result, rerender } = renderHook(({ buyerId }) => useBuyerRankSummary({ buyerId, requests, fetchProfile }), { initialProps: { buyerId: "buyer-a" } });
    rerender({ buyerId: "buyer-b" });
    await waitFor(() => expect(result.current.summary?.key).toBe("gold"));
    await act(async () => { resolveOld(responseFor("buyer-a")); });
    expect(result.current.summary?.lifetimeCompletedVolumeUsdt).toBe(50_000);
    expect(result.current.error).toBe(false);
  });

  it("discards a superseded same-account response after a newer trade refresh", async () => {
    let resolveOld!: (response: Response) => void;
    const fetchProfile = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(responseFor("buyer-a"));
    const { result, rerender } = renderHook(({ trades }) => useBuyerRankSummary({ buyerId: "buyer-a", requests: trades, fetchProfile }), { initialProps: { trades: requests } });
    rerender({ trades: [...requests] });
    await waitFor(() => expect(result.current.summary?.key).toBe("silver"));
    await act(async () => { resolveOld(responseFor("buyer-a", 14_672.94)); });
    expect(result.current.summary?.key).toBe("silver");
    expect(result.current.summary?.lifetimeCompletedVolumeUsdt).toBe(15_000);
  });

  it("retains the same account's last successful totals when refreshing fails", async () => {
    const fetchProfile = vi.fn().mockResolvedValueOnce(responseFor("buyer-a")).mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook(({ trades }) => useBuyerRankSummary({ buyerId: "buyer-a", requests: trades, fetchProfile }), { initialProps: { trades: requests } });
    await waitFor(() => expect(result.current.summary?.key).toBe("silver"));
    rerender({ trades: [...requests] });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.summary?.lifetimeCompletedVolumeUsdt).toBe(15_000);
  });

  it.each([
    { kind: "seller", lifetimeCompletedVolumeUsdt: 15_000, activeTrades: 0, completedTrades: 1, reviewsGiven: 1 },
    { kind: "buyer", activeTrades: 0, completedTrades: 1, reviewsGiven: 1 },
    { kind: "buyer", lifetimeCompletedVolumeUsdt: -1, activeTrades: 0, completedTrades: 1, reviewsGiven: 1 },
  ])("reports an invalid profile response instead of inventing zero progress", async stats => {
    const fetchProfile = vi.fn().mockResolvedValue(Response.json({ profile: { id: "buyer-a" }, stats }));
    const { result } = renderHook(() => useBuyerRankSummary({ buyerId: "buyer-a", requests, fetchProfile }));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.summary).toBeNull();
  });
});
