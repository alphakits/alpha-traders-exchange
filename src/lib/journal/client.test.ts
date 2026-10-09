// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyTrade } from "./model";
import { journalApi } from "./client";

const stalledFetch = vi.fn((_path: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  const abort = () => reject(new DOMException("Aborted", "AbortError"));
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener("abort", abort, { once: true });
}));
beforeEach(() => { vi.useFakeTimers(); stalledFetch.mockClear(); vi.stubGlobal("fetch", stalledFetch); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("journal network recovery", () => {
  it("ends a stalled read and releases its timeout", async () => {
    const assertion = expect(journalApi.load()).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(20_000); await assertion;
    expect(stalledFetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps caller cancellation distinct from a timeout", async () => {
    const controller = new AbortController();
    const assertion = expect(journalApi.load(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await assertion; expect(vi.getTimerCount()).toBe(0);
  });
  it("never automatically retries an ambiguous write", async () => {
    const assertion = expect(journalApi.saveTrade({ ...emptyTrade("2026-10-08"), symbol: "NQ" })).rejects.toMatchObject({ status: 408, message: expect.stringContaining("may have been saved") });
    await vi.advanceTimersByTimeAsync(20_000); await assertion;
    expect(stalledFetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("gives chart uploads a longer bounded window without duplicate retries", async () => {
    const assertion = expect(journalApi.uploadChart("trade", new Blob(["chart"], { type: "image/png" }))).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(stalledFetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(40_000); await assertion;
    expect(stalledFetch).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
