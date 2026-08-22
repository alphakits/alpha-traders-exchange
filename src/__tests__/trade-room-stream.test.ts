import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => {
  const unsubscribe = vi.fn();
  return {
    getTradeRoomData: vi.fn(),
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
vi.mock("@/lib/alpha-exchange-store", () => ({ getTradeRoomData: mocks.getTradeRoomData }));
vi.mock("@/lib/realtime", () => ({ subscribeRealtimeEvents: mocks.subscribeRealtimeEvents }));

import { GET } from "@/app/api/alpha-exchange/trade-room/[requestId]/stream/route";

describe("trade room SSE reconciliation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ user: { id: "buyer-1", role: "buyer" }, unauthorized: null });
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
    mocks.getTradeRoomData.mockResolvedValue({ request: { id: "trade-1", status: "accepted" }, messages: [] });
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
});
