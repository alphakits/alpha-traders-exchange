// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  deleteNotification: vi.fn(),
  markNotificationReadState: vi.fn(),
  sanitizeNotificationForClient: vi.fn((notification: unknown) => notification),
  updateNotificationState: vi.fn(),
  requireApiUser: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  deleteNotification: mocks.deleteNotification,
  markNotificationReadState: mocks.markNotificationReadState,
  sanitizeNotificationForClient: mocks.sanitizeNotificationForClient,
  updateNotificationState: mocks.updateNotificationState,
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
}));

import { PATCH } from "@/app/api/alpha-exchange/notifications/[notificationId]/route";

describe("notification state route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "owner-1" },
      unauthorized: null,
    });
    mocks.updateNotificationState.mockResolvedValue({
      id: "notification-1",
      userId: "owner-1",
      state: "archived",
      isRead: true,
    });
  });

  it("archives Later against the authenticated account", async () => {
    const response = await PATCH(new NextRequest(
      "https://www.alphatraders.co.il/api/alpha-exchange/notifications/notification-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dismiss", userId: "forged-user" }),
      },
    ), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.updateNotificationState).toHaveBeenCalledWith({
      userId: "owner-1",
      notificationId: "notification-1",
      state: "archived",
    });
    expect(mocks.markNotificationReadState).not.toHaveBeenCalled();
  });

  it("rejects an empty mutation instead of silently making an alert unread", async () => {
    const response = await PATCH(new NextRequest(
      "https://www.alphatraders.co.il/api/alpha-exchange/notifications/notification-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    ), {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateNotificationState).not.toHaveBeenCalled();
    expect(mocks.markNotificationReadState).not.toHaveBeenCalled();
  });
});
