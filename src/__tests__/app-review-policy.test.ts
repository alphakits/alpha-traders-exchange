// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  REVIEW_COOLDOWN_MS,
  appReviewStateKey,
  completedTradeAppReviewDecision,
  parseAppReviewState,
  serializedAppReviewState,
} from "../../apps/mobile/src/notifications/app-review-policy";

describe("completed-trade app review policy", () => {
  it("keeps buyer and seller prompt history isolated by account", () => {
    expect(appReviewStateKey("buyer-user")).not.toBe(appReviewStateKey("seller-user"));
    expect(appReviewStateKey(" buyer-user ")).toBe(appReviewStateKey("buyer-user"));
  });

  it("makes the first completed trade eligible and deduplicates its reference", () => {
    const now = Date.UTC(2026, 8, 7);
    const first = completedTradeAppReviewDecision({
      state: { observedTradeReferences: [] },
      tradeReference: "trade-1",
      now,
    });
    expect(first).toMatchObject({
      shouldRequest: true,
      shouldPersist: true,
      reason: "eligible",
    });
    expect(first.nextState.observedTradeReferences).toEqual(["trade-1"]);

    expect(completedTradeAppReviewDecision({
      state: first.nextState,
      tradeReference: "trade-1",
      now: now + 1_000,
    })).toMatchObject({
      shouldRequest: false,
      shouldPersist: false,
      reason: "duplicate",
    });
  });

  it("observes later trades during cooldown and becomes eligible afterward", () => {
    const now = Date.UTC(2026, 8, 7);
    const state = {
      lastRequestedAt: new Date(now).toISOString(),
      observedTradeReferences: ["trade-1"],
    };
    const duringCooldown = completedTradeAppReviewDecision({
      state,
      tradeReference: "trade-2",
      now: now + REVIEW_COOLDOWN_MS - 1,
    });
    expect(duringCooldown).toMatchObject({
      shouldRequest: false,
      shouldPersist: true,
      reason: "cooldown",
    });
    expect(duringCooldown.nextState.observedTradeReferences).toEqual(["trade-1", "trade-2"]);

    expect(completedTradeAppReviewDecision({
      state: duringCooldown.nextState,
      tradeReference: "trade-3",
      now: now + REVIEW_COOLDOWN_MS,
    })).toMatchObject({
      shouldRequest: true,
      reason: "eligible",
    });
  });

  it("loads malformed storage safely and bounds persisted history", () => {
    expect(parseAppReviewState("not-json")).toEqual({ observedTradeReferences: [] });
    const raw = serializedAppReviewState({
      observedTradeReferences: Array.from({ length: 100 }, (_, index) => `trade-${index}`),
    });
    const parsed = parseAppReviewState(raw);
    expect(parsed.observedTradeReferences).toHaveLength(80);
    expect(parsed.observedTradeReferences[0]).toBe("trade-20");
  });
});
