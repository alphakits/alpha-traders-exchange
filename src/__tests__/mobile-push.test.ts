// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildExpoPushMessage,
  isExpoPushToken,
  isMobilePushInstallationId,
  mobilePushDeliveryKey,
  privacySafeMobilePushCopy,
} from "@/lib/mobile-push";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

function notification(overrides: Partial<AlphaExchangeNotification> = {}): AlphaExchangeNotification {
  return {
    id: "notif-123",
    userId: "buyer-1",
    category: "trade",
    title: "New trade room message",
    message: "Call +972 50 123 4567 and send money to private account 9876.",
    isRead: false,
    relatedRequestId: "request-123",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("native lock-screen push payloads", () => {
  it("validates Expo tokens and random installation IDs strictly", () => {
    expect(isExpoPushToken("ExponentPushToken[abcdefghijklmnop]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abcdefghijklmnop]")).toBe(true);
    expect(isExpoPushToken("https://attacker.test/token")).toBe(false);
    expect(isMobilePushInstallationId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isMobilePushInstallationId("short")).toBe(false);
  });

  it("never copies chat, contact, bank, or amount text onto the lock screen", () => {
    const message = buildExpoPushMessage(notification(), {
      expoPushToken: "ExponentPushToken[abcdefghijklmnop]",
      locale: "en",
    });
    const serialized = JSON.stringify(message);
    expect(message.title).toBe("New Trade Room message");
    expect(message.body).toBe("Open Alpha Traders to read it securely.");
    expect(serialized).not.toContain("+972");
    expect(serialized).not.toContain("9876");
    expect(message.data.url).toBe("https://www.alphatraders.co.il/en/trade-room/request-123");
  });

  it("marks the shared buyer/seller completion notification as review eligible", () => {
    const message = buildExpoPushMessage(notification({
      title: "Trade completed",
      relatedRequestId: "request-finished",
    }), {
      expoPushToken: "ExponentPushToken[abcdefghijklmnop]",
      locale: "ar",
    });
    expect(message.data).toMatchObject({
      reviewEligible: true,
      tradeReference: "request-finished",
    });
    expect(privacySafeMobilePushCopy(notification({ title: "Trade completed" }), "ar").title)
      .toBe("اكتملت الصفقة");
  });

  it("deduplicates one persisted revision but alerts again for a later chat revision", () => {
    const first = notification({
      createdAt: "2026-09-07T20:00:00.000Z",
      updatedAt: "2026-09-07T20:00:01.000Z",
    });
    const repeatedPublication = { ...first };
    const nextMessage = { ...first, updatedAt: "2026-09-07T20:00:02.000Z" };

    expect(mobilePushDeliveryKey(repeatedPublication)).toBe(mobilePushDeliveryKey(first));
    expect(mobilePushDeliveryKey(nextMessage)).not.toBe(mobilePushDeliveryKey(first));
  });
});
