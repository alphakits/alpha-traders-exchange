// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketSnapshot } from "@/types/market";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn() }));
vi.mock("@/lib/market-service", () => ({ getMarketSnapshot: mocks.snapshot }));
import { GET } from "./route";

const liveSnapshot: MarketSnapshot = {
  status: "live",
  stale: false,
  updatedAt: "2026-10-27T01:47:55.697Z",
  unavailablePairs: [],
  pairs: {
    btcUsdt: { key: "btcUsdt", label: "BTC / USDT", price: 80242, changePercent: null, source: "binance" },
    ethUsdt: { key: "ethUsdt", label: "ETH / USDT", price: 2328.21, changePercent: null, source: "binance" },
    usdtIls: {
      key: "usdtIls", label: "USD / ILS", price: 3.0734, changePercent: null,
      source: "WISE:USDILS", quotedAt: "2026-10-27T01:47:01.000Z",
      validUntil: "2026-10-27T01:49:01.000Z", quoteStatus: "live",
    },
  },
};

describe("market center timing diagnostics", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("separates snapshot lookup from response construction without changing the public response", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(103)
      .mockReturnValueOnce(128)
      .mockReturnValueOnce(132);
    mocks.snapshot.mockResolvedValue(liveSnapshot);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ snapshot: liveSnapshot });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("server-timing")).toBe("market;dur=32.0, snapshot;dur=25.0");
    expect(response.headers.get("x-market-route-ms")).toBe("32.0");
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith();
  });

  it("preserves degraded and expired FX status instead of making a stale quote look live", async () => {
    const degraded: MarketSnapshot = {
      ...liveSnapshot,
      status: "degraded",
      stale: true,
      unavailablePairs: ["usdtIls"],
      pairs: {
        ...liveSnapshot.pairs,
        usdtIls: { ...liveSnapshot.pairs.usdtIls, quoteStatus: "stale" },
      },
    };
    mocks.snapshot.mockResolvedValue(degraded);

    const response = await GET();

    expect(await response.json()).toEqual({ snapshot: degraded });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("server-timing")).toMatch(/^market;dur=\d+\.\d, snapshot;dur=\d+\.\d$/);
  });

  it("propagates snapshot failures without fabricating a successful response", async () => {
    const failure = new Error("synthetic snapshot failure");
    mocks.snapshot.mockRejectedValue(failure);

    await expect(GET()).rejects.toBe(failure);
    expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith();
  });
});
