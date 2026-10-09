// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFxReference, parseWiseReference, wiseWeekendWindow, fetchFxReference } from "@/lib/fx-reference-provider";
import { FX_MAX_QUOTE_AGE_MS, isFxPairUsable } from "@/lib/fx-reference-policy";

const now = Date.parse("2026-10-09T07:05:00Z");
const symbol = "WISE:USDILS";
const quote = () => ({ base: "USD", quote: "ILS", symbol, price: 3.05437, quotedAt: new Date(now - 10_000).toISOString(), marketState: "open" });
const wiseQuote = (time = now) => ({
  sourceCurrency: "USD", targetCurrency: "ILS", rate: 3.05395, status: "PENDING",
  rateTimestamp: new Date(time - 34_000).toISOString(), createdTime: new Date(time).toISOString(),
  expirationTime: new Date(time + 30 * 60_000).toISOString(), rateExpirationTime: new Date(time + 30 * 60_000).toISOString(),
});

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

  it("uses Wise without credentials and never substitutes the daily or hardcoded rate", async () => {
    vi.stubEnv("ALPHA_FX_REFERENCE_URL", "");
    vi.stubEnv("ALPHA_FX_REFERENCE_SYMBOL", "");
    vi.stubEnv("ALPHA_FX_REFERENCE_TOKEN", "must-not-go-to-wise");
    vi.stubEnv("ALPHA_EXCHANGE_USD_ILS_RATE", "3.05");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => wiseQuote() })); vi.stubGlobal("fetch", fetchMock);
    expect(await fetchFxReference()).toMatchObject({ source: symbol, price: 3.05395, quotedAt: wiseQuote().rateTimestamp });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://api.wise.com/2026Q4/quotes", expect.objectContaining({
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sourceCurrency: "USD", targetCurrency: "ILS", sourceAmount: 1000 }),
    }));
  });

  it("uses the rate timestamp rather than creating a new timestamp for an old rate", () => {
    expect(parseWiseReference(wiseQuote(), now)).toMatchObject({ price: 3.05395, quotedAt: wiseQuote().rateTimestamp });
    expect(parseWiseReference({ ...wiseQuote(), rateTimestamp: new Date(now - FX_MAX_QUOTE_AGE_MS - 1).toISOString() }, now)).toBeNull();
    expect(parseWiseReference({ ...wiseQuote(), rateTimestamp: undefined }, now)).toBeNull();
  });

  it.each([
    { sourceCurrency: "USDT" }, { targetCurrency: "USD" }, { status: "EXPIRED" }, { rate: "3.05" }, { rate: 0 },
    { createdTime: new Date(now + 10_000).toISOString() }, { createdTime: new Date(now - FX_MAX_QUOTE_AGE_MS).toISOString() },
    { rateTimestamp: new Date(now + 10_000).toISOString() }, { expirationTime: new Date(now).toISOString() },
    { rateExpirationTime: new Date(now).toISOString() }, { rateExpirationTime: undefined },
  ])("rejects invalid or expired Wise quotes: %j", (patch) => {
    expect(parseWiseReference({ ...wiseQuote(), ...patch }, now)).toBeNull();
  });

  it("respects an earlier provider expiry", () => {
    const expirationTime = new Date(now + 10_000).toISOString();
    expect(parseWiseReference({ ...wiseQuote(), expirationTime }, now)?.validUntil).toBe(expirationTime);
  });

  it("keeps a verified weekend closing rate only with a recent provider response", () => {
    const saturday = Date.parse("2026-10-10T08:00:00Z");
    const rateTimestamp = "2026-10-09T20:59:45Z";
    const payload = { ...wiseQuote(saturday), rateTimestamp };
    const pair = parseWiseReference(payload, saturday)!;
    expect(pair).toMatchObject({ quoteStatus: "closed", quotedAt: new Date(rateTimestamp).toISOString() });
    expect(pair.validUntil).toBe(new Date(saturday + FX_MAX_QUOTE_AGE_MS).toISOString());
    expect(parseWiseReference({ ...payload, rateTimestamp: "2026-10-09T08:00:00Z" }, saturday)).toBeNull();
    expect(parseWiseReference(payload, saturday + FX_MAX_QUOTE_AGE_MS)).toBeNull();
    const reopened = Date.parse("2026-10-11T20:00:00Z");
    expect(parseWiseReference({ ...wiseQuote(reopened), rateTimestamp }, reopened)).toBeNull();
  });

  it.each([
    ["2026-10-09T20:59:59Z", null],
    ["2026-10-09T21:00:00Z", "2026-10-11T20:00:00.000Z"],
    ["2026-10-11T19:59:59Z", "2026-10-11T20:00:00.000Z"],
    ["2026-10-11T20:00:00Z", null],
    ["2026-12-04T22:00:00Z", "2026-12-06T20:00:00.000Z"],
    ["2026-07-03T21:00:00Z", "2026-07-05T21:00:00.000Z"],
  ])("honors New York/Auckland daylight saving at %s", (time, expected) => {
    const window = wiseWeekendWindow(Date.parse(time));
    expect(window ? new Date(window.opensAt).toISOString() : null).toBe(expected);
  });

  it("fails closed on a Wise outage without a daily-price fallback", async () => {
    vi.stubEnv("ALPHA_FX_REFERENCE_URL", ""); vi.stubEnv("ALPHA_FX_REFERENCE_SYMBOL", "");
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429 })); vi.stubGlobal("fetch", fetchMock);
    expect(await fetchFxReference()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds the default Wise request even when its response body stalls", async () => {
    vi.stubEnv("ALPHA_FX_REFERENCE_URL", ""); vi.stubEnv("ALPHA_FX_REFERENCE_SYMBOL", "");
    const fetchMock = vi.fn(async () => ({ ok: true, json: () => new Promise(() => undefined) }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchFxReference();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await pending).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
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
