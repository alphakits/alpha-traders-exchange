import { describe, expect, it } from "vitest";
import { newsDayKey, newsEventStatus, newsResultSummary, shouldAlertForRelease } from "./model";
import { newsProviderConfigured, normalizeEconomicNews } from "./provider";

const now = new Date("2026-09-23T12:31:00Z");
const row = { CalendarId: "123", Date: "2026-09-23T12:30:00", Country: "United States", Currency: "USD", Importance: 3,
  Event: "Inflation Rate YoY", Actual: "3.1%", Forecast: "3.0%", Previous: "2.9%", Revised: "", Source: "BLS",
  SourceURL: "https://www.bls.gov/", LastUpdate: "2026-09-23T12:30:03.123", DateSpan: 0 };
const event = () => normalizeEconomicNews([row], now)[0];

describe("USD economic news data", () => {
  it("requires an explicitly licensed provider and a key, without a demo fallback", () => {
    expect(newsProviderConfigured({})).toBe(false);
    expect(newsProviderConfigured({ ECONOMIC_NEWS_PROVIDER: "trading-economics", TRADING_ECONOMICS_API_KEY: "test" })).toBe(false);
    expect(newsProviderConfigured({ ECONOMIC_NEWS_PROVIDER: "trading-economics", TRADING_ECONOMICS_API_KEY: "test", ECONOMIC_NEWS_DATA_LICENSE_CONFIRMED: "true" })).toBe(true);
  });
  it("includes only high-impact USD events and treats a US provider record's blank currency as USD", () => {
    const events = normalizeEconomicNews([row, { ...row, CalendarId: "2", Importance: 2 },
      { ...row, CalendarId: "3", Country: "Canada", Currency: "CAD" }, { ...row, CalendarId: "4", Currency: "EUR" },
      { ...row, CalendarId: "5", Currency: "" }], now);
    expect(events.map((e) => e.id)).toEqual(["te-123", "te-5"]);
    expect(events[0].scheduledAt).toBe("2026-09-23T12:30:00.000Z");
  });
  it("preserves US dollar-symbol results without accepting Canadian or lower-impact events", () => {
    const dollarRow = { ...row, CalendarId: "319436", Event: "Balance of Trade", Currency: "$", Actual: "$-70.5B" };
    const events = normalizeEconomicNews([
      dollarRow,
      { ...dollarRow, CalendarId: "6", Country: "Canada" },
      { ...dollarRow, CalendarId: "7", Importance: 2 },
    ], now);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "te-319436", currency: "USD", actual: "$-70.5B" });
  });
  it("preserves zero results and does not confuse a forecast with an actual", () => {
    expect(normalizeEconomicNews([{ ...row, Actual: 0 }], now)[0].actual).toBe("0");
    expect(normalizeEconomicNews([{ ...row, Actual: "" }], now)[0].actual).toBeNull();
    expect(newsEventStatus({ ...event(), actual: null }, now.getTime())).toBe("awaiting");
    expect(newsEventStatus({ ...event(), scheduledAt: "2026-09-24T12:30:00Z" }, now.getTime())).toBe("scheduled");
  });
  it("rejects malformed dates, dangerous source URLs, and invalid identifiers", () => {
    expect(() => normalizeEconomicNews([{ ...row, Date: "not a date" }], now)).toThrow();
    expect(() => normalizeEconomicNews([{ ...row, CalendarId: "<script>" }], now)).toThrow();
    expect(normalizeEconomicNews([{ ...row, SourceURL: "javascript:alert(1)" }], now)[0].sourceUrl).toBeNull();
  });
  it("selects the most recently revised version of a duplicated provider event", () => {
    const events = normalizeEconomicNews([{ ...row, Actual: "3.2%", LastUpdate: "2026-09-23T12:30:04Z" }, row], now);
    expect(events).toHaveLength(1);
    expect(events[0].actual).toBe("3.2%");
  });
  it("uses Israel's DST rules and the device timezone when grouping dates", () => {
    expect(newsDayKey("2026-07-01T21:30:00Z", "Asia/Jerusalem")).toBe("2026-07-02");
    expect(newsDayKey("2026-01-01T21:30:00Z", "Asia/Jerusalem")).toBe("2026-01-01");
    expect(newsDayKey("2026-07-01T21:30:00Z", "America/New_York")).toBe("2026-07-01");
  });
  it("keeps speeches without numeric results separate from awaited numerical releases", () => {
    const speech = normalizeEconomicNews([{ ...row, Event: "FOMC Press Conference", Actual: "" }], now)[0];
    expect(newsEventStatus(speech, now.getTime())).toBe("no_numeric_result");
    expect(newsResultSummary(speech, "ar")).toBe("");
  });
  it("summarizes comparisons without guessing market direction or comparing incompatible units", () => {
    expect(newsResultSummary(event(), "en")).toContain("Above forecast");
    expect(newsResultSummary({ ...event(), forecast: "3.1%" }, "ar")).toContain("مطابق للتوقعات");
    expect(newsResultSummary({ ...event(), actual: "100K", forecast: "1M" }, "en")).not.toMatch(/Above forecast|Below forecast|In line with forecast/);
  });
  it("alerts only on a fresh release transition after initialization, never on schedules or revisions", () => {
    const next = event();
    expect(shouldAlertForRelease({ ...next, actual: null }, next, now.getTime(), true)).toBe(true);
    expect(shouldAlertForRelease(undefined, next, now.getTime(), false)).toBe(false);
    expect(shouldAlertForRelease(next, { ...next, actual: "3.2%" }, now.getTime(), true)).toBe(false);
    expect(shouldAlertForRelease(undefined, next, now.getTime() + 3_600_000, true)).toBe(false);
    expect(shouldAlertForRelease(undefined, next, now.getTime() - 120_000, true)).toBe(false);
    expect(shouldAlertForRelease(undefined, { ...next, timing: "tentative" }, now.getTime(), true)).toBe(false);
    const delayedNow = now.getTime() + 3_600_000;
    expect(shouldAlertForRelease({ ...next, actual: null }, { ...next, providerUpdatedAt: new Date(delayedNow).toISOString() }, delayedNow, true)).toBe(true);
  });
});
