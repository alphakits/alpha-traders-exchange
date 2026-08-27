import { describe, expect, it } from "vitest";
import { getLocalizedTradeReminderDisplay } from "@/lib/trade-reminder-localization";
import type { AlphaExchangeTradeReminder } from "@/types/alpha-exchange";

function reminder(kind: AlphaExchangeTradeReminder["kind"]): AlphaExchangeTradeReminder {
  return {
    requestId: "purchase-1",
    tradeId: "trade-1",
    displayNumber: 42,
    title: "Raw English title",
    message: "Raw English message",
    actionLabel: "Raw English action",
    actionHref: "/trade-room/purchase-1",
    priority: "high",
    kind,
    createdAt: "2026-08-27T10:00:00.000Z",
  };
}

describe("trade reminder localization", () => {
  it.each([
    "feedback_required",
    "buyer_action_required",
    "seller_action_required",
  ] as const)("never exposes server English for Arabic %s reminders", (kind) => {
    const display = getLocalizedTradeReminderDisplay(reminder(kind), "ar");
    expect(`${display.title} ${display.messageBeforeReference} ${display.messageAfterReference} ${display.actionLabel}`).toMatch(/[\u0600-\u06ff]/);
    expect(JSON.stringify(display)).not.toContain("Raw English");
    expect(display.reference).toBe("#42");
  });

  it("keeps the exact trade id isolated when no display number exists", () => {
    const input = { ...reminder("buyer_action_required"), displayNumber: undefined, tradeId: "trade-AbC-123" };
    expect(getLocalizedTradeReminderDisplay(input, "ar").reference).toBe("trade-AbC-123");
  });
});
