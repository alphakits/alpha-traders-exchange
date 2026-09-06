// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AlphaExchangeNotification, AlphaExchangeUser } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  getNotificationsForUser: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationReadState: vi.fn(),
  requireMobileApiUser: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getNotificationsForUser: mocks.getNotificationsForUser,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
  markNotificationReadState: mocks.markNotificationReadState,
}));

vi.mock("@/lib/mobile-api-auth", () => ({
  requireMobileApiUser: mocks.requireMobileApiUser,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));

vi.mock("@/lib/structured-logging", () => ({
  logEvent: mocks.logEvent,
}));

import {
  GET as listNotifications,
  PATCH as markAllNotifications,
} from "@/app/api/mobile/v1/notifications/route";
import { PATCH as updateNotification } from "@/app/api/mobile/v1/notifications/[notificationId]/route";

const user = {
  id: "buyer-user-private-id",
  fullName: "Mobile Buyer",
  email: "buyer@example.test",
  role: "buyer",
  roles: ["buyer"],
  sellerStatus: "buyer",
  emailVerified: true,
  disabled: false,
} as AlphaExchangeUser;

const tradeNotification: AlphaExchangeNotification = {
  id: "notification-1",
  userId: user.id,
  category: "trade",
  title: "Payment required",
  message: "Continue inside the Trade Room.",
  titleAr: "الدفع مطلوب",
  messageAr: "تابع داخل غرفة الصفقة.",
  isRead: false,
  state: "unread",
  priority: "high",
  relatedRequestId: "request-123",
  relatedRequestDisplayNumber: 88,
  relatedHref: "/en/trade-room/request-123?private=1",
  actionHref: "https://attacker.example/phishing",
  tradeSnapshot: {
    requestId: "request-123",
    requestDisplayNumber: 88,
    sellerId: "seller-user-private-id",
    buyerId: user.id,
    counterpartyName: "Verified Seller",
    usdtAmount: "1500",
    fiatAmount: "4999.50",
    currency: "ILS",
    currentStage: "accepted",
    requiredAction: "Upload payment proof",
  },
  createdAt: "2026-09-06T10:00:00.000Z",
  updatedAt: "2026-09-06T10:01:00.000Z",
};

const accountNotification: AlphaExchangeNotification = {
  id: "notification-2",
  userId: user.id,
  category: "account",
  title: "Account updated",
  message: "Your account is ready.",
  isRead: true,
  state: "read",
  priority: "normal",
  createdAt: "2026-09-05T10:00:00.000Z",
};

function headers(locale = "en") {
  return {
    authorization: `Bearer atr_at_v1.${"a".repeat(44)}`,
    "content-type": "application/json",
    "accept-language": locale,
    "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
    "x-app-version": "1.0.0",
    "x-platform": "ios",
    "x-request-id": "notification-request-1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user,
    accessToken: "access-token",
    unauthorized: null,
  });
  mocks.checkSharedRateLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mocks.getNotificationsForUser.mockResolvedValue({
    notifications: [tradeNotification, accountNotification],
    total: 2,
    unreadCount: 1,
    activity: [],
  });
  mocks.markNotificationReadState.mockResolvedValue({
    ...tradeNotification,
    isRead: true,
    state: "read",
  });
  mocks.markAllNotificationsRead.mockResolvedValue(undefined);
});

describe("mobile notification routes", () => {
  it("returns localized action-ready notifications through a strict privacy allowlist", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/notifications", {
      headers: headers("ar"),
    });

    const response = await listNotifications(request);
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      total: 2,
      unreadCount: 1,
      requestId: "notification-request-1",
      notifications: [
        {
          id: "notification-1",
          title: "الدفع مطلوب",
          message: "تابع داخل غرفة الصفقة.",
          actionRequired: true,
          destination: { screen: "trade", requestId: "request-123" },
          relatedDisplayNumber: 88,
        },
        {
          id: "notification-2",
          actionRequired: false,
          destination: { screen: "profile" },
        },
      ],
    });
    expect(mocks.getNotificationsForUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: user.id,
      includeActivity: false,
    }));
    for (const forbidden of [
      user.id,
      "seller-user-private-id",
      "https://attacker.example/phishing",
      "/en/trade-room/request-123?private=1",
      "4999.50",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("marks every notification read only for the authenticated account", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/notifications", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ action: "mark_all_read", userId: "forged-user" }),
    });

    const response = await markAllNotifications(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ updated: true });
    expect(mocks.markAllNotificationsRead).toHaveBeenCalledWith(user.id);
    expect(mocks.markAllNotificationsRead).not.toHaveBeenCalledWith("forged-user");
  });

  it("updates one owned notification and keeps the native response projected", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/notifications/notification-1", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ isRead: true, userId: "forged-user" }),
    });

    const response = await updateNotification(request, {
      params: Promise.resolve({ notificationId: "notification-1" }),
    });
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.notification).toMatchObject({
      id: "notification-1",
      isRead: true,
      destination: { screen: "trade", requestId: "request-123" },
    });
    expect(mocks.markNotificationReadState).toHaveBeenCalledWith({
      userId: user.id,
      notificationId: "notification-1",
      isRead: true,
    });
    expect(JSON.stringify(payload)).not.toContain(user.id);
  });

  it("conceals notification ownership failures behind a stable not-found response", async () => {
    mocks.markNotificationReadState.mockRejectedValueOnce(new Error("Notification not found."));
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/notifications/not-owned", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ isRead: true }),
    });

    const response = await updateNotification(request, {
      params: Promise.resolve({ notificationId: "not-owned" }),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("rejects malformed notification identifiers before any account data access", async () => {
    const request = new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/notifications/bad%2Fid", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ isRead: true }),
    });

    const response = await updateNotification(request, {
      params: Promise.resolve({ notificationId: "bad/id" }),
    });
    expect(response.status).toBe(400);
    expect(mocks.requireMobileApiUser).not.toHaveBeenCalled();
  });
});
