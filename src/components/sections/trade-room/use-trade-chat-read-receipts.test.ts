import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeTradeChatReadReceipts } from "./use-trade-chat-read-receipts";

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON: () => ({}) });
let stop: (() => void) | undefined;
let container: HTMLDivElement;
let first: HTMLDivElement;
let second: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  container = document.createElement("div");
  container.getBoundingClientRect = () => rect(100, 400);
  first = document.createElement("div"); first.dataset.tradeMessageId = "message-1";
  first.getBoundingClientRect = () => rect(120, 200);
  second = document.createElement("div"); second.dataset.tradeMessageId = "message-2";
  second.getBoundingClientRect = () => rect(450, 530);
  container.append(first, second); document.body.append(container);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: "message-1", readByUserIds: ["buyer", "seller"], seenAt: "2026-09-24T12:00:00Z" }] }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { stop?.(); stop = undefined; container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("visible chat read receipts", () => {
  it("batches only visible messages and never acknowledges an offscreen or unknown message", async () => {
    const onReceipts = vi.fn();
    stop = observeTradeChatReadReceipts(container, "trade-1", ["message-1", "message-2"], onReceipts);
    await vi.advanceTimersByTimeAsync(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ messageIds: ["message-1"] });
    expect(onReceipts).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5500);
    expect(fetchMock).toHaveBeenCalledOnce();
    second.getBoundingClientRect = () => rect(210, 300);
    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(200);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ messageIds: ["message-2"] });
  });
  it("does not mark messages Seen in a hidden tab or backgrounded app", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    stop = observeTradeChatReadReceipts(container, "trade-1", ["message-1"], vi.fn());
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent("alpha-native-app-state", { detail: { active: false } }));
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent("alpha-native-app-state", { detail: { active: true } }));
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("retries failed receipts without inventing a Seen state and stops on unmount", async () => {
    const onReceipts = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    stop = observeTradeChatReadReceipts(container, "trade-1", ["message-1"], onReceipts);
    await vi.advanceTimersByTimeAsync(200);
    expect(onReceipts).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5500);
    expect(onReceipts).toHaveBeenCalledOnce();
    stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
