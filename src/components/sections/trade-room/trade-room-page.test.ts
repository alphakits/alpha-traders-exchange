import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TradeChatMessage, TradeTimelineEntry } from "@/types/alpha-exchange";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import {
  isTradeRoomChatNearBottom,
  groupTradeTimelineEntries,
  getTradeRoomReconnectDelayMs,
  mergeTradeRoomSnapshotPreservingOptimisticMessages,
  mergeTradeRoomMessages,
  revealTradeRoomDeepLinkTarget,
  shouldRestartTradeRoomStreamAfterPageShow,
  shouldAutoScrollTradeRoomChat,
  shouldShowTradeRoomNewMessageIndicator,
  shouldIgnoreRegressiveSnapshot,
  tradeRoomSnapshotSignature,
} from "./trade-room-page";

type TradeRoomSnapshot = Parameters<typeof shouldIgnoreRegressiveSnapshot>[0];

function message(id: string, createdAt: string, overrides: Partial<TradeChatMessage> = {}): TradeChatMessage {
  return {
    id,
    purchaseRequestId: "trade-1",
    kind: "user",
    senderUserId: "buyer-1",
    senderRole: "buyer",
    message: id,
    createdAt,
    sentAt: createdAt,
    readByUserIds: ["buyer-1"],
    ...overrides,
  };
}

function room(input: { updatedAt?: string; messages?: TradeChatMessage[]; status?: string } = {}): TradeRoomSnapshot {
  return {
    request: {
      id: "trade-1",
      status: input.status ?? "accepted",
      updatedAt: input.updatedAt ?? "2026-08-22T12:00:00.000Z",
      timeline: [],
    },
    listing: null,
    counterpart: { buyerName: "Buyer", sellerName: "Seller" },
    messages: input.messages ?? [],
    poke: { available: true, canPoke: true, cooldownUntil: null, cooldownRemainingSeconds: 0, counterpartRole: "seller" },
    deadlineAt: null,
    timeRemainingSeconds: null,
    releaseDeadlineActive: false,
    releaseDeadlineOverdue: false,
    isOverdue: false,
    hasOpenDispute: false,
    canOpenDispute: true,
    sellerCommissionDueAmount: 0,
    sellerCommissionDueCount: 0,
  } as unknown as TradeRoomSnapshot;
}

describe("Trade Room client stability helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps button-triggered file inputs out of the keyboard tab order", () => {
    const source = readFileSync(join(process.cwd(), "src/components/sections/trade-room/trade-room-page.tsx"), "utf8");

    for (const accessibleName of ["Choose payment receipt", "Choose USDT release proof", "Choose chat image"]) {
      const labelIndex = source.indexOf(accessibleName);
      const inputIndex = source.lastIndexOf("<Input", labelIndex);
      const inputEnd = source.indexOf("/>", inputIndex);
      const inputMarkup = source.slice(inputIndex, inputEnd);
      expect(labelIndex, accessibleName).toBeGreaterThan(-1);
      expect(inputIndex, accessibleName).toBeGreaterThan(-1);
      expect(inputMarkup, accessibleName).toContain('type="file"');
      expect(inputMarkup, accessibleName).toContain("tabIndex={-1}");
    }
  });

  it("rejects an older normal snapshot instead of only protecting terminal status regressions", () => {
    const current = room({
      updatedAt: "2026-08-22T12:01:00.000Z",
      messages: [message("message-current", "2026-08-22T12:01:00.000Z")],
    });
    const incoming = room({ updatedAt: "2026-08-22T12:00:00.000Z" });

    expect(shouldIgnoreRegressiveSnapshot(current, incoming, false)).toBe(true);
  });

  it("includes every message delivery/read state in the snapshot signature", () => {
    const base = room({
      messages: [
        message("first", "2026-08-22T12:00:00.000Z"),
        message("middle", "2026-08-22T12:01:00.000Z"),
        message("last", "2026-08-22T12:02:00.000Z"),
      ],
    });
    const deliveredMiddle = room({
      messages: [
        message("first", "2026-08-22T12:00:00.000Z"),
        message("middle", "2026-08-22T12:01:00.000Z", { deliveredAt: "2026-08-22T12:01:01.000Z" }),
        message("last", "2026-08-22T12:02:00.000Z"),
      ],
    });

    expect(tradeRoomSnapshotSignature(deliveredMiddle)).not.toBe(tradeRoomSnapshotSignature(base));
  });

  it("shows newest timeline activity first and groups adjacent duplicate updates", () => {
    const entries: TradeTimelineEntry[] = [
      { id: "one", type: "payment_sent", actorUserId: "buyer-1", actorRole: "buyer", message: "Buyer marked payment sent", createdAt: "2026-08-22T12:00:00.000Z" },
      { id: "two", type: "payment_sent", actorUserId: "buyer-1", actorRole: "buyer", message: "Buyer marked payment sent", createdAt: "2026-08-22T12:01:00.000Z" },
      { id: "three", type: "seller_confirmed_funds", actorUserId: "seller-1", actorRole: "approved_seller", message: "Seller confirmed funds received", createdAt: "2026-08-22T12:02:00.000Z" },
    ];

    const grouped = groupTradeTimelineEntries(entries, false);

    expect(grouped.map(({ event, count }) => [event.id, count])).toEqual([
      ["three", 1],
      ["two", 2],
    ]);
  });

  it("replaces the optimistic message with the confirmed message once and keeps chronological chat order", () => {
    const first = message("first", "2026-08-22T12:00:00.000Z");
    const optimistic = message("optimistic", "2026-08-22T12:01:00.000Z");
    const confirmed = message("confirmed", "2026-08-22T12:01:01.000Z");

    const merged = mergeTradeRoomMessages([optimistic, first], confirmed, optimistic.id);

    expect(merged.map((entry) => entry.id)).toEqual(["first", "confirmed"]);
    expect(mergeTradeRoomMessages(merged, confirmed).map((entry) => entry.id)).toEqual(["first", "confirmed"]);
  });

  it("keeps only an optimistic chat bubble while applying an authoritative counterparty status and Poke snapshot", () => {
    const optimistic = message("optimistic-msg-1", "2026-08-22T12:00:01.000Z", { message: "Sending now" });
    const current = room({
      status: "accepted",
      updatedAt: "2026-08-22T12:00:00.000Z",
      messages: [message("earlier", "2026-08-22T12:00:00.000Z"), optimistic],
    });
    const incoming = room({
      status: "payment_sent",
      updatedAt: "2026-08-22T12:00:02.000Z",
      messages: [message("counterparty-update", "2026-08-22T12:00:02.000Z", { senderUserId: "seller-1" })],
    });
    incoming.poke = { available: false, canPoke: false, cooldownUntil: "2026-08-22T12:05:02.000Z", cooldownRemainingSeconds: 300, counterpartRole: "seller" };

    const reconciled = mergeTradeRoomSnapshotPreservingOptimisticMessages(current, incoming);

    expect(reconciled.request.status).toBe("payment_sent");
    expect(reconciled.poke).toEqual(incoming.poke);
    expect(reconciled.messages.map((entry) => entry.id)).toEqual(["optimistic-msg-1", "counterparty-update"]);

    const confirmed = message("server-message-1", "2026-08-22T12:00:03.000Z", { message: "Sending now" });
    const confirmedMessages = mergeTradeRoomMessages(reconciled.messages, confirmed, optimistic.id);
    expect(confirmedMessages.map((entry) => entry.id)).toEqual(["counterparty-update", "server-message-1"]);
  });

  it("returns the incoming snapshot unchanged when no optimistic chat message exists", () => {
    const current = room({ messages: [message("earlier", "2026-08-22T12:00:00.000Z")] });
    const incoming = room({ status: "payment_sent", messages: [message("server", "2026-08-22T12:00:01.000Z")] });

    expect(mergeTradeRoomSnapshotPreservingOptimisticMessages(current, incoming)).toBe(incoming);
  });

  it("restarts a Trade Room stream only when a BFCache page is restored", () => {
    expect(shouldRestartTradeRoomStreamAfterPageShow({ persisted: true })).toBe(true);
    expect(shouldRestartTradeRoomStreamAfterPageShow({ persisted: false })).toBe(false);
  });

  it("keeps reconnecting with bounded backoff during long mobile network interruptions", () => {
    expect(getTradeRoomReconnectDelayMs(1)).toBe(1_000);
    expect(getTradeRoomReconnectDelayMs(2)).toBe(2_000);
    expect(getTradeRoomReconnectDelayMs(3)).toBe(4_000);
    expect(getTradeRoomReconnectDelayMs(4)).toBe(8_000);
    expect(getTradeRoomReconnectDelayMs(5)).toBe(15_000);
    expect(getTradeRoomReconnectDelayMs(50)).toBe(15_000);
  });

  it("preserves a reader's older chat position while still revealing their own send", () => {
    expect(isTradeRoomChatNearBottom(1_000, 500, 420)).toBe(true);
    expect(isTradeRoomChatNearBottom(1_000, 200, 420)).toBe(false);
    expect(shouldAutoScrollTradeRoomChat(false, false)).toBe(false);
    expect(shouldAutoScrollTradeRoomChat(true, false)).toBe(true);
    expect(shouldAutoScrollTradeRoomChat(false, true)).toBe(true);
    expect(shouldShowTradeRoomNewMessageIndicator({
      initialized: true,
      wasNearBottom: false,
      hasNewCounterpartyMessage: true,
    })).toBe(true);
    expect(shouldShowTradeRoomNewMessageIndicator({
      initialized: true,
      wasNearBottom: true,
      hasNewCounterpartyMessage: true,
    })).toBe(false);
    expect(shouldShowTradeRoomNewMessageIndicator({
      initialized: false,
      wasNearBottom: false,
      hasNewCounterpartyMessage: true,
    })).toBe(false);
  });

  it("uses one measured page scroll and focus for a deep-link target", () => {
    const header = document.createElement("header");
    const target = document.createElement("section");
    document.body.append(header, target);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 150 });
    Object.defineProperty(header, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ height: 80 }) as DOMRect,
    });
    Object.defineProperty(target, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 250 }) as DOMRect,
    });
    const scrollTo = vi.fn();
    const focus = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    Object.defineProperty(target, "focus", { configurable: true, value: focus });

    revealTradeRoomDeepLinkTarget(target);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 304, behavior: "auto" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
