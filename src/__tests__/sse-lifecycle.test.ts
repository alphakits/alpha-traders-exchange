import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  notifications: vi.fn(),
  notificationRevision: vi.fn(),
  room: vi.fn(),
  roomRevision: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.authorize,
  requireApiSellerWorkspaceActor: mocks.authorize,
  requireEmailVerificationForTrading: () => null,
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getNotificationsForUser: mocks.notifications,
  getNotificationRevisionForUser: mocks.notificationRevision,
  getTradeRoomData: mocks.room,
  getTradeRoomRevision: mocks.roomRevision,
}));
vi.mock("@/lib/realtime", () => ({ subscribeRealtimeEvents: mocks.subscribe }));

import { GET as notifications } from "@/app/api/alpha-exchange/notifications/stream/route";
import { GET as tradeRoom } from "@/app/api/alpha-exchange/trade-room/[requestId]/stream/route";
import { GET as realtime } from "@/app/api/alpha-exchange/realtime/route";

describe.each([
  ["notifications", (signal: AbortSignal) => notifications(new NextRequest("http://localhost/api/alpha-exchange/notifications/stream", { signal }))],
  ["trade room", (signal: AbortSignal) => tradeRoom(new NextRequest("http://localhost/api/alpha-exchange/trade-room/test-trade/stream", { signal }), { params: Promise.resolve({ requestId: "test-trade" }) })],
  ["seller realtime", (signal: AbortSignal) => realtime(new NextRequest("http://localhost/api/alpha-exchange/realtime", { signal }))],
] as const)("%s connection lifecycle", (_name, open) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({ user: { id: "seller-test", role: "approved_seller" }, unauthorized: null });
    mocks.notifications.mockResolvedValue({ notifications: [], unreadCount: 0, revision: "empty" });
    mocks.notificationRevision.mockResolvedValue("empty");
    const request = { id: "test-trade", status: "accepted", updatedAt: "2026-09-23T00:00:00Z" };
    mocks.room.mockResolvedValue({ request, messages: [] });
    mocks.roomRevision.mockResolvedValue(request);
    mocks.subscribe.mockReturnValue(mocks.unsubscribe);
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("announces reconnection and ends before Vercel's five-minute execution limit", async () => {
    const response = await open(new AbortController().signal);
    expect(response.status).toBe(200);
    await vi.advanceTimersByTimeAsync(240_000);
    // Assert cleanup before reading to EOF, so an unbounded stream fails here
    // instead of hanging the test runner.
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const body = await response.text();
    expect(body).toContain("event: reconnect\ndata: {}\n\n");
    expect(body).toContain("retry: 1000");
    const reads = mocks.roomRevision.mock.calls.length + mocks.notificationRevision.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.roomRevision.mock.calls.length + mocks.notificationRevision.mock.calls.length).toBe(reads);
  });

  it("releases timers and subscriptions immediately when the response consumer cancels", async () => {
    const response = await open(new AbortController().signal);
    await response.body!.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the rotation timer when the request aborts", async () => {
    const controller = new AbortController();
    await open(controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
