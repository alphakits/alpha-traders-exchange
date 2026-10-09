// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFxReference, fetchFxReference } from "@/lib/fx-reference-provider";
import { FX_MAX_QUOTE_AGE_MS, isFxPairUsable } from "@/lib/fx-reference-policy";

const now = Date.parse("2026-10-09T07:05:00Z");
const symbol = "SAXO:USDILS";
const quote = () => ({ base: "USD", quote: "ILS", symbol, price: 3.05437, quotedAt: new Date(now - 10_000).toISOString(), marketState: "open" });

describe("USD/ILS source and freshness", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("preserves the exact quote, symbol and SOURCE time, with bounded expiry", () => {
    const pair = parseFxReference(quote(), symbol, now)!;
    expect(pair).toMatchObject({ price: 3.05437, source: symbol, quotedAt: quote().quotedAt, quoteStatus: "live" });
    expect(Date.parse(pair.validUntil!)).toBe(Date.parse(quote().quotedAt) + FX_MAX_QUOTE_AGE_MS);
    expect(isFxPairUsable(pair, now + FX_MAX_QUOTE_AGE_MS)).toBe(false);
  });

  it.each([
    { symbol: "OTHER:USDILS" }, { base: "USDT" }, { quote: "USD" }, { price: "3.05437" },
    { price: NaN }, { price: -3 }, { price: Infinity }, { price: 0 }, { marketState: "unknown" },
    { quotedAt: "" }, { quotedAt: "2026-10-09T00:02:31Z" }, { quotedAt: "2026-10-10T07:05:00Z" },
  ])("rejects wrong sources, malformed values and old/future quotes: %j", (patch) => {
    expect(parseFxReference({ ...quote(), ...patch }, symbol, now)).toBeNull();
  });

  it("accepts an explicitly closed market only until the provider's next open", () => {
    const nextOpenAt = new Date(now + 2 * 86400000).toISOString();
    const pair = parseFxReference({ ...quote(), marketState: "closed", nextOpenAt }, symbol, now)!;
    expect(pair.quoteStatus).toBe("closed");
    expect(isFxPairUsable(pair, Date.parse(nextOpenAt))).toBe(false);
    expect(parseFxReference({ ...quote(), marketState: "closed" }, symbol, now)).toBeNull();
    expect(parseFxReference({ ...quote(), marketState: "closed", nextOpenAt: new Date(now - 1).toISOString() }, symbol, now)).toBeNull();
  });

  it("does not silently use the daily provider or environment hardcoded rate", async () => {
    vi.stubEnv("ALPHA_FX_REFERENCE_URL", "");
    vi.stubEnv("ALPHA_EXCHANGE_USD_ILS_RATE", "3.05");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await fetchFxReference()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a different configured provider even if its quote and timestamp are valid", async () => {
    vi.stubEnv("ALPHA_FX_REFERENCE_URL", "https://fx.example/quote");
    vi.stubEnv("ALPHA_FX_REFERENCE_SYMBOL", "FX_IDC:USDILS");
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect(await fetchFxReference()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(parseFxReference({ ...quote(), symbol: "FX_IDC:USDILS" }, "FX_IDC:USDILS", now)).toBeNull();
  });

  it("applies the same provider and expiry rules to consumers, including the native app", () => {
    const pair = parseFxReference(quote(), symbol, now)!;
    expect(isFxPairUsable({ ...pair, source: "FX_IDC:USDILS" }, now)).toBe(false);
    expect(isFxPairUsable({ ...pair, validUntil: new Date(now + 86400000).toISOString() }, now)).toBe(false);
  });

  it("bounds a stalled body, cancels it and keeps credentials out of results", async () => {
    vi.stubEnv("ALPHA_FX_REFERENCE_URL", "https://fx.example/quote");
    vi.stubEnv("ALPHA_FX_REFERENCE_SYMBOL", symbol);
    vi.stubEnv("ALPHA_FX_REFERENCE_TOKEN", "test-only-token");
    const fetchMock = vi.fn(async () => ({ ok: true, json: () => new Promise(() => undefined) }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchFxReference();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toBeNull();
    expect(fetchMock.mock.calls[0]).toEqual(["https://fx.example/quote", expect.objectContaining({ redirect: "error", cache: "no-store" })]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
