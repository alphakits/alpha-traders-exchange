import { describe, expect, it } from "vitest";
import { getTradeHeaderReminderKind, isTradeHeaderActivityResolved, type TradeHeaderActivity } from "./trade-header-activity";

const base: TradeHeaderActivity = { id: "r", tradeId: "tr", buyerId: "buyer", sellerId: "seller", paymentMethod: "Bank Transfer", status: "pending", updatedAt: "2026-09-22T00:00:00Z", buyerReviewed: false };

describe.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("%s header reminders", (paymentMethod) => {
  it.each([
    ["pending", null, "seller_action_required"],
    ["accepted", "buyer_action_required", null],
    ["payment_sent", null, "seller_action_required"],
    ["funds_received", null, "seller_action_required"],
    ["usdt_release_pending", null, "seller_action_required"],
    ["review_open", "feedback_required", null],
  ] as const)("only asks the participant with an action at %s", (status, buyer, seller) => {
    const trade = { ...base, paymentMethod, status };
    expect(getTradeHeaderReminderKind(trade, "buyer")).toBe(buyer);
    expect(getTradeHeaderReminderKind(trade, "seller")).toBe(status === "accepted" && paymentMethod.startsWith("Face-to-Face") ? "seller_action_required" : seller);
    expect(getTradeHeaderReminderKind(trade, "outsider")).toBeNull();
  });

  it("offers buyer receipt confirmation and cash seller completion after USDT is sent", () => {
    const trade = { ...base, paymentMethod, status: "usdt_sent" as const };
    expect(getTradeHeaderReminderKind(trade, "buyer")).toBe("buyer_action_required");
    expect(getTradeHeaderReminderKind(trade, "seller")).toBe(paymentMethod === "Bank Transfer" ? null : "seller_action_required");
  });

  it("clears finished work while preserving an outstanding buyer review", () => {
    const trade = { ...base, paymentMethod, status: "review_open" as const };
    expect(isTradeHeaderActivityResolved(trade, "buyer")).toBe(false);
    expect(isTradeHeaderActivityResolved(trade, "seller")).toBe(true);
    expect(isTradeHeaderActivityResolved({ ...trade, buyerReviewed: true }, "buyer")).toBe(true);
  });
});
