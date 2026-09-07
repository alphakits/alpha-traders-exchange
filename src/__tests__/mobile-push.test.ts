// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    message: "SENSITIVE_CONTACT_MARKER SENSITIVE_PAYMENT_MARKER",
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
    expect(serialized).not.toContain("SENSITIVE_CONTACT_MARKER");
    expect(serialized).not.toContain("SENSITIVE_PAYMENT_MARKER");
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

  it("sets the lock-screen badge to the user's bounded unread total", () => {
    const subscription = {
      expoPushToken: "ExponentPushToken[abcdefghijklmnop]",
      locale: "en" as const,
    };
    expect(buildExpoPushMessage(notification(), subscription, 37).badge).toBe(37);
    expect(buildExpoPushMessage(notification(), subscription, 12_000).badge).toBe(9_999);
    expect(buildExpoPushMessage(notification(), subscription, Number.NaN).badge).toBe(1);
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

  it("reclaims a stale interrupted delivery without reusing its old ticket", () => {
    const pushSource = readFileSync(join(process.cwd(), "src/lib/mobile-push.ts"), "utf8");
    expect(pushSource).toContain("status in ('failed', 'processing')");
    expect(pushSource).toContain("ticket_id = null");
    expect(pushSource).toContain("receipt_checked_at = null");
    expect(pushSource).toContain("updated_at < now() - interval '30 seconds'");
  });
});
