import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forwardCompletedTradesToNative,
  isRecentCompletedTradeNotification,
  postToNativeApp,
} from "@/lib/native-app-bridge";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

function notification(overrides: Partial<AlphaExchangeNotification> = {}): AlphaExchangeNotification {
  return {
    id: "notif-1",
    userId: "user-1",
    category: "trade",
    title: "Trade completed",
    message: "Complete.",
    isRead: false,
    relatedRequestId: "request-1",
    createdAt: "2026-09-07T23:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  delete window.ReactNativeWebView;
  vi.restoreAllMocks();
});

describe("website-to-native completion signals", () => {
  it("does nothing in an ordinary browser", () => {
    expect(postToNativeApp({
      type: "alpha.web.session",
      version: 1,
      authenticated: false,
      locale: "en",
    })).toBe(false);
  });

  it("forwards a recent completion only to the matching signed-in user", () => {
    const postMessage = vi.fn();
    window.ReactNativeWebView = { postMessage };
    const now = new Date("2026-09-07T23:10:00.000Z").getTime();
    expect(forwardCompletedTradesToNative([
      notification(),
      notification({ id: "other", userId: "user-2" }),
    ], "user-1", "en", now)).toBe(1);
    expect(JSON.parse(postMessage.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      type: "alpha.web.trade-completed",
      userId: "user-1",
      notificationId: "notif-1",
      tradeReference: "request-1",
    });
  });

  it("does not turn an old or merely similarly-worded notice into a review prompt", () => {
    const now = new Date("2026-09-07T23:10:00.000Z").getTime();
    expect(isRecentCompletedTradeNotification(notification({
      createdAt: "2026-09-01T23:00:00.000Z",
    }), now)).toBe(false);
    expect(isRecentCompletedTradeNotification(notification({
      title: "Large-value trade completed",
    }), now)).toBe(false);
  });
});
