import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTradeRoomHref,
  prefetchTradeRoom,
  readTradeRoomCache,
  writeTradeRoomCache,
} from "@/lib/trade-room-client";

describe("Trade Room client prefetch reliability", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps route identifiers encoded and caches only a fresh payload", () => {
    expect(buildTradeRoomHref("trade/with spaces")).toBe("/trade-room/trade%2Fwith%20spaces");

    writeTradeRoomCache("trade-1", "buyer-1", { status: "accepted" });
    expect(readTradeRoomCache("trade-1", "buyer-1")).toEqual({ status: "accepted" });

    vi.advanceTimersByTime(90_001);
    expect(readTradeRoomCache("trade-1", "buyer-1")).toBeNull();
    expect(window.sessionStorage.getItem("alpha.trade-room.cache.v2.buyer-1.trade-1")).toBeNull();
  });

  it("never shares a cached Trade Room snapshot with a different signed-in account", () => {
    writeTradeRoomCache("trade-shared", "buyer-1", { privateView: "buyer-one" });

    expect(readTradeRoomCache("trade-shared", "buyer-1")).toEqual({ privateView: "buyer-one" });
    expect(readTradeRoomCache("trade-shared", "buyer-2")).toBeNull();
  });

  it("never persists decrypted Cardless ATM credentials or server-only bank snapshots", () => {
    writeTradeRoomCache("trade-secret", "buyer-1", {
      request: {
        id: "trade-secret",
        sellerBankAccountSnapshot: { accountNumber: "12345678" },
        messages: [{ id: "credential-1", credentialKind: "cardless_code", message: "Cardless withdrawal code: 123456", payloadHash: "secret-hash" }],
      },
      messages: [
        { id: "normal-1", message: "Hello", payloadHash: "internal-hash" },
        { id: "credential-1", credentialKind: "cardless_code", message: "Cardless withdrawal code: 123456", payloadHash: "secret-hash" },
      ],
    });

    const raw = window.sessionStorage.getItem("alpha.trade-room.cache.v2.buyer-1.trade-secret");
    expect(raw).not.toContain("123456");
    expect(raw).not.toContain("12345678");
    expect(raw).not.toContain("secret-hash");
    expect(raw).not.toContain("internal-hash");
    expect(readTradeRoomCache("trade-secret", "buyer-1")).toMatchObject({
      request: { id: "trade-secret", messages: [] },
      messages: [{ id: "normal-1", message: "Hello" }],
    });
  });

  it("coalesces hover, focus, and click prefetches into one route and data request", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchResponse);
    vi.stubGlobal("fetch", fetchMock);
    const router = { prefetch: vi.fn(() => Promise.resolve()) };

    const hoverPrefetch = prefetchTradeRoom(router, "trade-2", "buyer-1");
    const focusPrefetch = prefetchTradeRoom(router, "trade-2", "buyer-1");
    const clickPrefetch = prefetchTradeRoom(router, "trade-2", "buyer-1");
    await Promise.resolve();

    expect(focusPrefetch).toBe(hoverPrefetch);
    expect(clickPrefetch).toBe(hoverPrefetch);
    expect(router.prefetch).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.(new Response(JSON.stringify({ request: { id: "trade-2" } }), { status: 200 }));
    await hoverPrefetch;

    expect(readTradeRoomCache("trade-2", "buyer-1")).toEqual({ request: { id: "trade-2" } });
  });

  it("reuses a fresh cached snapshot without making another data request", async () => {
    writeTradeRoomCache("trade-3", "buyer-1", { request: { id: "trade-3" } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const router = { prefetch: vi.fn() };

    await prefetchTradeRoom(router, "trade-3", "buyer-1");

    expect(router.prefetch).toHaveBeenCalledWith("/trade-room/trade-3");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("absorbs route and network prefetch failures so navigation can continue", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const router = { prefetch: vi.fn(() => Promise.reject(new Error("route prefetch failed"))) };

    await expect(prefetchTradeRoom(router, "trade-4", "buyer-1")).resolves.toBeUndefined();
    expect(readTradeRoomCache("trade-4", "buyer-1")).toBeNull();
  });

  it("prefetches only the route when no authenticated account scope is available", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const router = { prefetch: vi.fn() };

    await prefetchTradeRoom(router, "trade-anonymous");

    expect(router.prefetch).toHaveBeenCalledWith("/trade-room/trade-anonymous");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases a stalled prefetch so the next navigation can retry", async () => {
    let resolveBody: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => new Promise((resolve) => { resolveBody = resolve; }),
    }).mockResolvedValueOnce(new Response(JSON.stringify({ request: { id: "trade-stalled", status: "completed" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const router = { prefetch: vi.fn() };
    const stalled = prefetchTradeRoom(router, "trade-stalled", "buyer-1");
    await vi.advanceTimersByTimeAsync(8_001);
    await expect(stalled).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    await prefetchTradeRoom(router, "trade-stalled", "buyer-1");
    resolveBody?.({ request: { id: "trade-stalled", status: "accepted" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readTradeRoomCache("trade-stalled", "buyer-1")).toEqual({ request: { id: "trade-stalled", status: "completed" } });
  });
});
