import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => {
  const unsubscribe = vi.fn();
  return {
    getTradeRoomData: vi.fn(),
    getTradeRoomRevision: vi.fn(),
    requireApiUser: vi.fn(),
    requireEmailVerificationForTrading: vi.fn(),
    subscribeRealtimeEvents: vi.fn(() => unsubscribe),
    unsubscribe,
  };
});

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomData: mocks.getTradeRoomData,
  getTradeRoomRevision: mocks.getTradeRoomRevision,
}));
vi.mock("@/lib/realtime", () => ({ subscribeRealtimeEvents: mocks.subscribeRealtimeEvents }));

import { GET } from "@/app/api/alpha-exchange/trade-room/[requestId]/stream/route";

describe("trade room SSE reconciliation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ user: { id: "buyer-1", role: "buyer" }, unauthorized: null });
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
    mocks.getTradeRoomData.mockResolvedValue({
      request: { id: "trade-1", status: "accepted", updatedAt: "2026-09-14T18:00:00.000Z" },
      messages: [],
    });
    mocks.getTradeRoomRevision.mockResolvedValue({
      id: "trade-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "accepted",
      updatedAt: "2026-09-14T18:00:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the stream protected and does not start polling for an anonymous request", async () => {
    mocks.requireApiUser.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });

    const response = await GET(new NextRequest("http://localhost/api/alpha-exchange/trade-room/trade-1/stream"), {
      params: Promise.resolve({ requestId: "trade-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.getTradeRoomData).not.toHaveBeenCalled();
    expect(mocks.subscribeRealtimeEvents).not.toHaveBeenCalled();
  });

  it("rejects an outsider before returning a stream or starting reconciliation", async () => {
    mocks.getTradeRoomData.mockRejectedValueOnce(new Error("You are not allowed to access trade evidence."));

    const response = await GET(new NextRequest("http://localhost/api/alpha-exchange/trade-room/trade-1/stream"), {
      params: Promise.resolve({ requestId: "trade-1" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "You are not allowed to access this Trade Room.",
      code: "TRADE_FORBIDDEN",
    });
    expect(mocks.getTradeRoomData).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeRealtimeEvents).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it("returns a real 404 before opening a stream for a missing trade", async () => {
    mocks.getTradeRoomData.mockRejectedValueOnce(new Error("Trade not found."));

    const response = await GET(new NextRequest("http://localhost/api/alpha-exchange/trade-room/missing/stream"), {
      params: Promise.resolve({ requestId: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.subscribeRealtimeEvents).not.toHaveBeenCalled();
  });

  it("cleans up the per-connection reconciliation timer and listener on disconnect", async () => {
    const controller = new AbortController();
    await GET(new NextRequest("http://localhost/api/alpha-exchange/trade-room/trade-1/stream", { signal: controller.signal }), {
      params: Promise.resolve({ requestId: "trade-1" }),
    });
    await Promise.resolve();
    expect(mocks.getTradeRoomData).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(mocks.getTradeRoomData).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("checks one lightweight revision each second and reloads only after this trade changes", async () => {
    const controller = new AbortController();
    await GET(new NextRequest("http://localhost/api/alpha-exchange/trade-room/trade-1/stream", { signal: controller.signal }), {
      params: Promise.resolve({ requestId: "trade-1" }),
    });
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.getTradeRoomRevision).toHaveBeenCalledTimes(1);
    expect(mocks.getTradeRoomData).toHaveBeenCalledTimes(1);

    mocks.getTradeRoomRevision.mockResolvedValue({
      id: "trade-1",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "payment_sent",
      updatedAt: "2026-09-14T18:00:01.000Z",
    });
    mocks.getTradeRoomData.mockResolvedValue({
      request: { id: "trade-1", status: "payment_sent", updatedAt: "2026-09-14T18:00:01.000Z" },
      messages: [],
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.getTradeRoomRevision).toHaveBeenCalledTimes(2);
    expect(mocks.getTradeRoomData).toHaveBeenCalledTimes(2);
    expect(mocks.getTradeRoomData).toHaveBeenLastCalledWith(expect.objectContaining({
      markMessagesRead: false,
      strongConsistency: true,
    }));
    controller.abort();
  });
});
