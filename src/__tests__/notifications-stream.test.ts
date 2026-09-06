import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const unsubscribe = vi.fn();
  return {
    getNotificationsForUser: vi.fn(),
    requireApiUser: vi.fn(),
    subscribeRealtimeEvents: vi.fn(() => unsubscribe),
    unsubscribe,
  };
});

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getNotificationsForUser: mocks.getNotificationsForUser,
}));

vi.mock("@/lib/realtime", () => ({
  subscribeRealtimeEvents: mocks.subscribeRealtimeEvents,
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/alpha-exchange/notifications/stream/route";

const emptySnapshot = { notifications: [], unreadCount: 0 };

describe("notification SSE reconciliation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ user: { id: "buyer-1", role: "buyer" }, unauthorized: null });
    mocks.getNotificationsForUser.mockResolvedValue(emptySnapshot);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces slow canonical reads to one queued reconciliation per active connection", async () => {
    let resolveFirstRead: ((value: typeof emptySnapshot) => void) | undefined;
    const firstRead = new Promise<typeof emptySnapshot>((resolve) => {
      resolveFirstRead = resolve;
    });
    mocks.getNotificationsForUser
      .mockReset()
      .mockReturnValueOnce(firstRead)
      .mockResolvedValue(emptySnapshot);
    const controller = new AbortController();

    await GET(new NextRequest("http://localhost/api/alpha-exchange/notifications/stream", { signal: controller.signal }));
    expect(mocks.getNotificationsForUser).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.getNotificationsForUser).toHaveBeenCalledTimes(1);

    resolveFirstRead?.(emptySnapshot);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.getNotificationsForUser).toHaveBeenCalledTimes(2);

    controller.abort();
  });

  it("stops its per-connection reconciliation and realtime listener after disconnect", async () => {
    const controller = new AbortController();

    await GET(new NextRequest("http://localhost/api/alpha-exchange/notifications/stream", { signal: controller.signal }));
    await Promise.resolve();
    expect(mocks.getNotificationsForUser).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(mocks.getNotificationsForUser).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("emits a changed list even when unread count and the first notification are unchanged", async () => {
    const first = {
      notifications: [
        { id: "notification-one", state: "read", createdAt: "2026-09-05T10:00:00.000Z", updatedAt: "2026-09-05T10:00:00.000Z" },
        { id: "notification-two", state: "read", createdAt: "2026-09-05T09:00:00.000Z", updatedAt: "2026-09-05T09:00:00.000Z" },
      ],
      unreadCount: 0,
    };
    const afterDelete = {
      notifications: [first.notifications[0]],
      unreadCount: 0,
    };
    mocks.getNotificationsForUser
      .mockReset()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(afterDelete);
    const controller = new AbortController();

    const response = await GET(new NextRequest("http://localhost/api/alpha-exchange/notifications/stream", { signal: controller.signal }));
    const reader = response.body!.getReader();
    const initialChunk = await reader.read();
    expect(new TextDecoder().decode(initialChunk.value)).toContain("notification-two");

    await vi.advanceTimersByTimeAsync(5_000);
    const updatedChunk = await reader.read();
    const updatedText = new TextDecoder().decode(updatedChunk.value);
    expect(updatedText).toContain("notification-one");
    expect(updatedText).not.toContain("notification-two");

    controller.abort();
    await reader.cancel();
  });
});
