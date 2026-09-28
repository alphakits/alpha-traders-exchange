import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseRequest, TradeChatMessage, TradeTimelineEntry } from "@/types/alpha-exchange";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  Link: () => null,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import {
  canRevealTradeRoomBankDetails,
  getPrimaryAction,
  getTradeProgressIndex,
  getTradeRoomSessionKey,
  isTradeRoomChatNearBottom,
  groupTradeTimelineEntries,
  getTradeRoomReconnectDelayMs,
  mergeTradeRoomSnapshotPreservingOptimisticMessages,
  mergeTradeRoomMessages,
  resolveTradeRoomChatAttempt,
  resolveTradeRoomGuidanceTarget,
  revealTradeRoomDeepLinkTarget,
  shouldRestartTradeRoomStreamAfterPageShow,
  shouldAutoScrollTradeRoomChat,
  shouldShowTradeRoomNewMessageIndicator,
  shouldIgnoreRegressiveSnapshot,
  tradeRoomSnapshotSignature,
  tradeRoomChatAttemptSignature,
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

  it("isolates local UI state by both account and trade", () => {
    expect(getTradeRoomSessionKey("buyer-1", "trade-a")).not.toBe(getTradeRoomSessionKey("buyer-1", "trade-b"));
    expect(getTradeRoomSessionKey("buyer-1", "trade-a")).not.toBe(getTradeRoomSessionKey("buyer-2", "trade-a"));
  });

  it("reuses one chat request id after an uncertain retry and rotates it when content changes", () => {
    const signature = tradeRoomChatAttemptSignature("Hello", null);
    const first = resolveTradeRoomChatAttempt(null, signature, () => "message-id-1");
    const retry = resolveTradeRoomChatAttempt(first, signature, () => "message-id-2");
    const edited = resolveTradeRoomChatAttempt(first, tradeRoomChatAttemptSignature("Hello again", null), () => "message-id-3");

    expect(retry.clientMessageId).toBe("message-id-1");
    expect(edited.clientMessageId).toBe("message-id-3");
  });

  it("shows sensitive bank details only for a linked bank-transfer trade after acceptance", () => {
    const acceptedBankTransfer = {
      ...room({ status: "accepted" }).request,
      paymentMethod: "Bank Transfer",
      sellerBankAccountId: "bank-1",
    } as PurchaseRequest;

    expect(canRevealTradeRoomBankDetails(acceptedBankTransfer, false)).toBe(true);
    expect(canRevealTradeRoomBankDetails({ ...acceptedBankTransfer, status: "pending" }, false)).toBe(false);
    expect(canRevealTradeRoomBankDetails({ ...acceptedBankTransfer, paymentMethod: "Cardless ATM Withdrawal" }, false)).toBe(false);
    expect(canRevealTradeRoomBankDetails({ ...acceptedBankTransfer, sellerBankAccountId: undefined }, false)).toBe(false);
    expect(canRevealTradeRoomBankDetails(acceptedBankTransfer, true)).toBe(false);
  });

  it("guides Face-to-Face through cash receipt and explicit seller delivery completion", () => {
    const acceptedFaceToFace = {
      ...room({ status: "accepted" }).request,
      paymentMethod: "Face-to-Face (Meet in Person)",
      buyerId: "buyer-1",
      sellerId: "seller-1",
    } as PurchaseRequest;

    const buyerAction = getPrimaryAction(acceptedFaceToFace, "buyer-1", false, true);
    expect(buyerAction).toMatchObject({
      label: "I Handed Over the Cash",
      nextStatus: "payment_sent",
    });
    expect(buyerAction).not.toHaveProperty("requiresEvidenceSide");
    expect(getPrimaryAction(acceptedFaceToFace, "seller-1", true, true)).toMatchObject({ label: "استلمت النقد", nextStatus: "funds_received" });
    expect(getPrimaryAction({ ...acceptedFaceToFace, status: "payment_sent" }, "seller-1", true, true)).toMatchObject({
      label: "استلمت النقد",
      nextStatus: "funds_received",
    });
    expect(getPrimaryAction({ ...acceptedFaceToFace, status: "funds_received" }, "seller-1", false, true)).toMatchObject({
      label: "Mark Trade as Completed",
      nextStatus: "completed",
      command: "complete_trade",
    });
    expect(getPrimaryAction({ ...acceptedFaceToFace, status: "funds_received" }, "buyer-1", false, true)).toBeNull();
    expect(getPrimaryAction({ ...acceptedFaceToFace, status: "usdt_sent" }, "seller-1", false, true)).toMatchObject({
      label: "Mark Trade as Completed",
      nextStatus: "completed",
      command: "complete_trade",
    });
    expect(getPrimaryAction({ ...acceptedFaceToFace, status: "usdt_sent" }, "buyer-1", false, true)).toMatchObject({ nextStatus: "completed", label: "Confirm USDT Received" });
    expect(getPrimaryAction({ ...acceptedFaceToFace, status: "pending" }, "buyer-1", false, true)).toBeNull();
    expect(getPrimaryAction({ ...acceptedFaceToFace, paymentMethod: "Bank Transfer" }, "buyer-1", false, true)).toMatchObject({
      mode: "upload",
      uploadSide: "buyer",
    });
    expect(getPrimaryAction(acceptedFaceToFace, "admin-not-in-trade", false, true)).toBeNull();
  });

  it("keeps the no-photo Cardless ATM sequence explicit in both languages", () => {
    const cardless = {
      ...room({ status: "accepted" }).request,
      paymentMethod: "Cardless ATM Withdrawal",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      buyerEvidence: undefined,
      sellerEvidence: undefined,
    } as PurchaseRequest;

    expect(getPrimaryAction(cardless, "buyer-1", false, false)).toMatchObject({
      label: "Send & Confirm Withdrawal Details",
      mode: "status",
      nextStatus: "payment_sent",
    });
    expect(getPrimaryAction({ ...cardless, status: "payment_sent" }, "seller-1", true, false)).toMatchObject({
      label: "استلمت النقد من الصراف",
      nextStatus: "funds_received",
    });
    expect(getPrimaryAction({ ...cardless, status: "funds_received" }, "seller-1", false, false)).toMatchObject({
      label: "Confirm USDT Sent",
      nextStatus: "usdt_sent",
    });
    expect(getPrimaryAction({ ...cardless, status: "usdt_release_pending" }, "seller-1", true, false)).toMatchObject({
      label: "تأكيد إرسال USDT",
      nextStatus: "usdt_sent",
    });
    expect(getPrimaryAction({ ...cardless, status: "usdt_sent" }, "buyer-1", false, false)).toMatchObject({ nextStatus: "completed", label: "Confirm USDT Received" });
    expect(getPrimaryAction({ ...cardless, status: "usdt_sent" }, "seller-1", true, false)).toMatchObject({
      label: "تحديد الصفقة كمكتملة",
      nextStatus: "completed",
      command: "complete_trade",
    });
  });

  it("requires confirmation and has a single primary action across responsive surfaces", () => {
    const source = readFileSync(join(process.cwd(), "src/components/sections/trade-room/trade-room-page.tsx"), "utf8");

    expect(source).toContain("!window.confirm(primaryAction.confirmationMessage)");
    expect(source.match(/onClick=\{\(\) => void handlePrimaryAction\(\)\}/g)).toHaveLength(1);
    expect(source).toContain('action: action.command');
    expect(source).toContain('isCashTrade ? (');
    expect(source).toContain('The buyer wallet stays hidden from the seller until the seller confirms actual cash receipt.');
    expect(source).toContain('h-auto min-h-12 w-full whitespace-normal');
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

  it("advances past stale receipt links when USDT arrives and past stale action links at completion", () => {
    expect(resolveTradeRoomGuidanceTarget({ priorState: "r:payment_sent", currentState: "r:usdt_sent", status: "usdt_sent", action: "upload-payment-receipt", hash: "#evidence" })).toBe("action-required");
    expect(resolveTradeRoomGuidanceTarget({ priorState: "r:usdt_sent", currentState: "r:review_open", status: "review_open", action: "complete-cash-trade", hash: "#action-required" })).toBe("action-required");
    expect(resolveTradeRoomGuidanceTarget({ priorState: "r:payment_sent", currentState: "r:payment_sent", status: "payment_sent", action: null, hash: "#chat" })).toBe("chat");
  });

  it("mirrors server text limits and handles clipboard failures inside the Trade Room", () => {
    const source = readFileSync(join(process.cwd(), "src/components/sections/trade-room/trade-room-page.tsx"), "utf8");

    expect(source).toContain('maxLength={1200}');
    expect(source).toContain('maxLength={1000}');
    expect(source.match(/maxLength=\{500\}/g)).toHaveLength(3);
    expect(source).toContain("await navigator.clipboard.writeText(chatDraft)");
    expect(source).toContain('setChatErrorMessage(isAr ? "تعذر نسخ الرسالة." : "Could not copy the message.")');
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

  it("replaces an older cached identity when canonical public IDs arrive without a trade change", () => {
    const cached = room();
    const refreshed = { ...cached, counterpart: { ...cached.counterpart, buyerPublicId: "#S-100001", sellerPublicId: "#S-200002" } };
    expect(shouldIgnoreRegressiveSnapshot(cached, refreshed, false)).toBe(false);
    expect(tradeRoomSnapshotSignature(refreshed)).not.toBe(tradeRoomSnapshotSignature(cached));
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

  it("replaces an optimistic bubble when the committed message arrives before the send response", () => {
    const optimistic = message("optimistic-msg-attempt-1", "2026-08-22T12:00:00.000Z", {
      clientMessageId: "attempt-1", message: "Hello",
    });
    const confirmed = message("server-message-1", "2026-08-22T12:00:01.000Z", {
      clientMessageId: "attempt-1", message: "Hello",
    });
    const reconciled = mergeTradeRoomSnapshotPreservingOptimisticMessages(
      room({ messages: [optimistic] }), room({ messages: [confirmed] }),
    );
    expect(reconciled.messages).toEqual([confirmed]);
  });

  it.each([
    { clientMessageId: "another-attempt" },
    { senderUserId: "seller-1" },
    { purchaseRequestId: "another-trade" },
  ])("does not merge distinct messages with identical text: %j", (difference) => {
    const optimistic = message("optimistic-msg-attempt-1", "2026-08-22T12:00:00.000Z", {
      clientMessageId: "attempt-1", message: "Hello",
    });
    const other = { ...optimistic, id: "server-message", ...difference };
    const reconciled = mergeTradeRoomSnapshotPreservingOptimisticMessages(
      room({ messages: [optimistic] }), room({ messages: [other] }),
    );
    expect(reconciled.messages).toHaveLength(2);
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

  it.each(["upload-payment-receipt", "upload-seller-evidence"])("opens the current step for legacy %s notification links", (action) => {
    expect(resolveTradeRoomGuidanceTarget({ priorState: null, currentState: "r:accepted", status: "accepted", action, hash: "#evidence" })).toBe("action-required");
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

  it.each([
    ["pending", 0], ["accepted", 1], ["payment_sent", 2], ["funds_received", 3],
    ["usdt_release_pending", 3], ["usdt_sent", 4], ["review_open", 5], ["completed", 5], ["locked", 5],
  ] as const)("only counts confirmed milestones for %s", (status, index) => {
    expect(getTradeProgressIndex(status)).toBe(index);
  });

  it("does not move an already visible result", () => {
    const target = document.createElement("div");
    document.body.append(target);
    target.getBoundingClientRect = () => ({ top: 120, height: 80 }) as DOMRect;
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    revealTradeRoomDeepLinkTarget(target);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("uses one measured page scroll and focus for a deep-link target", () => {
    const header = document.createElement("header");
    const target = document.createElement("section");
    document.body.append(header, target);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 150 });
    Object.defineProperty(header, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 80, height: 80 }) as DOMRect,
    });
    Object.defineProperty(target, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 850, height: 400 }) as DOMRect,
    });
    const scrollTo = vi.fn();
    const focus = vi.fn();
    Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });
    Object.defineProperty(target, "focus", { configurable: true, value: focus });

    revealTradeRoomDeepLinkTarget(target);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 904, behavior: "auto" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
