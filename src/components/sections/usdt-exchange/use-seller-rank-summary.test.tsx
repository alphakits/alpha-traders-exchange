import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { useSellerRankSummary } from "./use-seller-rank-summary";

const requests: PurchaseRequest[] = [];
const responseFor = (sellerId: string, total = 38_000) => new Response(JSON.stringify({
  profile: { id: sellerId }, stats: { kind: "seller", sellerLevel: "silver", nextLevel: "gold", lifetimeCompletedVolumeUsdt: total, amountToNextLevelUsdt: 50_000 - total, progressToNextLevelPercent: 65.71 },
}), { status: 200 });

afterEach(cleanup);
describe("private seller rank summary", () => {
  it("does not request seller totals without an approved seller identity", () => {
    const fetchProfile = vi.fn();
    const { result } = renderHook(() => useSellerRankSummary({ requests, fetchProfile }));
    expect(result.current).toEqual({ summary: null, error: false });
    expect(fetchProfile).not.toHaveBeenCalled();
  });
  it("loads lifetime totals even with no listings or visible trade history, then refreshes when trades change", async () => {
    const fetchProfile = vi.fn().mockResolvedValueOnce(responseFor("seller-a")).mockResolvedValueOnce(responseFor("seller-a", 40_000));
    const { result, rerender } = renderHook(({ trades }) => useSellerRankSummary({ sellerId: "seller-a", requests: trades, fetchProfile }), { initialProps: { trades: requests } });
    await waitFor(() => expect(result.current.summary?.lifetimeCompletedVolumeUsdt).toBe(38_000));
    expect(fetchProfile.mock.calls[0][1]).toBe("/api/auth/profile");
    expect(fetchProfile.mock.calls[0][2].cache).toBe("no-store");
    rerender({ trades: [...requests] });
    await waitFor(() => expect(result.current.summary?.amountToNextLevelUsdt).toBe(10_000));
  });
  it("rejects another account's response", async () => {
    const fetchProfile = vi.fn().mockResolvedValue(responseFor("seller-other"));
    const { result } = renderHook(() => useSellerRankSummary({ sellerId: "seller-a", requests, fetchProfile }));
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.summary).toBeNull();
  });
  it("discards a late response after switching accounts and hides totals on sign-out", async () => {
    let resolveOld!: (response: Response) => void;
    const fetchProfile = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(responseFor("seller-b", 45_000));
    const { result, rerender } = renderHook(({ sellerId }: { sellerId?: string }) => useSellerRankSummary({ sellerId, requests, fetchProfile }), { initialProps: { sellerId: "seller-a" } as { sellerId?: string } });
    rerender({ sellerId: "seller-b" });
    await waitFor(() => expect(result.current.summary?.lifetimeCompletedVolumeUsdt).toBe(45_000));
    await act(async () => { resolveOld(responseFor("seller-a")); });
    expect(result.current.summary?.lifetimeCompletedVolumeUsdt).toBe(45_000);
    rerender({ sellerId: undefined });
    expect(result.current.summary).toBeNull();
  });
  it("retains the same user's last totals and reports a failed refresh", async () => {
    const fetchProfile = vi.fn().mockResolvedValueOnce(responseFor("seller-a")).mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook(({ trades }) => useSellerRankSummary({ sellerId: "seller-a", requests: trades, fetchProfile }), { initialProps: { trades: requests } });
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    rerender({ trades: [...requests] });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.summary?.lifetimeCompletedVolumeUsdt).toBe(38_000);
  });
});
