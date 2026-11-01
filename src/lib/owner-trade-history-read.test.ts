import { afterEach, describe, expect, it, vi } from "vitest";
import { readOwnerTradeHistory } from "./owner-trade-history-read";

afterEach(() => vi.useRealTimers());

describe("bounded owner history reads", () => {
  it.each(["fetch", "body"])("times out a stalled %s even when it ignores abort", async stage => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => {});
    const fetcher = vi.fn().mockImplementation(() => stage === "fetch" ? pending : Promise.resolve({ ok: true, status: 200, json: () => pending }));
    const read = readOwnerTradeHistory("trade / one", new AbortController().signal, fetcher, 100);
    const rejected = expect(read).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe("/api/alpha-exchange/trade-room/trade%20%2F%20one?view=history");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns denied access without reading a stalled error body", async () => {
    const json = vi.fn(() => new Promise(() => {}));
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, json });
    await expect(readOwnerTradeHistory("trade", new AbortController().signal, fetcher)).resolves.toEqual({ ok: false, status: 403, payload: null });
    expect(json).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", credentials: "same-origin" });
  });

  it("cancels an in-flight read without waiting for the transport", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
    const read = readOwnerTradeHistory("trade", controller.signal, fetcher);
    const rejected = expect(read).rejects.toThrow("cancelled");
    controller.abort();
    await rejected;
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("does not start a request for an already-cancelled page", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    await expect(readOwnerTradeHistory("trade", controller.signal, fetcher)).rejects.toThrow("cancelled");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
