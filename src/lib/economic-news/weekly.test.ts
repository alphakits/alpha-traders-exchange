// @vitest-environment node
import { describe, expect, it } from "vitest";
import snapshot from "./weekly-calendar.json";
import { newsEventId, shouldAlertForRelease, WEEKLY_NEWS_STALE_AFTER_MS } from "./model";
import { weeklyCalendarSchema } from "./weekly-schema";
import { readWeeklyNewsFeed, weeklyNewsFeed } from "./weekly";

const calendar = weeklyCalendarSchema.parse(snapshot);
const checked = Date.parse(calendar.verifiedAt);
const clone = () => structuredClone(snapshot);

describe("free weekly official calendar", () => {
  it("validates the deployed snapshot and keeps results factual with no live source freshness or forecasts", () => {
    const feed = readWeeklyNewsFeed(checked);
    expect(feed).toMatchObject({ mode: "weekly", status: "ready", provider: null });
    expect(feed.events.length).toBeGreaterThan(0);
    for (const event of feed.events) {
      expect(newsEventId(event.id)).toBe(event.id);
      expect(event.forecast).toBeNull();
      expect(event.providerUpdatedAt).toBeNull();
      expect(shouldAlertForRelease(undefined, event, checked, true)).toBe(false);
      if (event.actual !== null) expect(Date.parse(event.scheduledAt)).toBeLessThanOrEqual(checked);
    }
  });
  it("stays current for a weekly interval, warns after eight days, and expires with its coverage", () => {
    expect(readWeeklyNewsFeed(checked + 86_400_000).status).toBe("ready");
    expect(readWeeklyNewsFeed(checked + WEEKLY_NEWS_STALE_AFTER_MS + 1).status).toBe("stale");
    expect(readWeeklyNewsFeed(Date.parse(calendar.coverageEnd))).toMatchObject({ status: "unavailable", events: [] });
    expect(readWeeklyNewsFeed(checked - 5 * 60_000 - 1)).toMatchObject({ status: "unavailable", events: [] });
  });
  it("never exposes an actual before publication, even within the clock-skew allowance", () => {
    const event = { ...calendar.events[0], actual: "0", publishedAt: calendar.events[0].scheduledAt };
    const nearRelease = { ...calendar, verifiedAt: event.scheduledAt, events: [event] };
    expect(weeklyNewsFeed(nearRelease, Date.parse(event.scheduledAt) - 1).events[0].actual).toBeNull();
    expect(weeklyNewsFeed(nearRelease, Date.parse(event.scheduledAt)).events[0].actual).toBe("0");
  });
  it("accepts a verified midweek result without changing the Sunday schedule verification", () => {
    const event = { ...calendar.events[0], scheduledAt: "2026-10-06T12:30:00Z", publishedAt: "2026-10-06T12:30:00Z", actual: "0%" };
    const data = { ...calendar, verifiedAt: "2026-10-04T16:56:40Z", resultsVerifiedAt: "2026-10-08T17:00:00Z", events: [event] };
    expect(weeklyCalendarSchema.safeParse(data).success).toBe(true);
    const feed = weeklyNewsFeed(data, Date.parse("2026-10-08T18:00:00Z"));
    expect(feed.events[0].actual).toBe("0%");
    expect(feed.updatedAt).toBe(data.verifiedAt);
    expect(feed.resultsVerifiedAt).toBe(data.resultsVerifiedAt);
    expect(weeklyCalendarSchema.safeParse({ ...data, resultsVerifiedAt: data.verifiedAt }).success).toBe(false);
  });
  it("publishes sourced bilingual speech outcomes only after publication without inventing a number", () => {
    const event = { ...calendar.events[0], kind: "speech" as const, actual: null, outcome: { en: "Verified statement.", ar: "بيان مؤكد." } };
    const data = { ...calendar, events: [event] };
    expect(weeklyCalendarSchema.safeParse(data).success).toBe(true);
    expect(weeklyNewsFeed(data, checked).events[0]).toMatchObject({ actual: null, outcome: event.outcome });
    const future = { ...event, scheduledAt: "2026-10-08T18:00:00Z", publishedAt: "2026-10-08T18:01:00Z" };
    const ahead = { ...data, verifiedAt: future.scheduledAt, resultsVerifiedAt: future.publishedAt, events: [future] };
    const before = weeklyNewsFeed(ahead, Date.parse(future.scheduledAt));
    expect(before.events[0].outcome).toBeUndefined();
    expect(before.resultsVerifiedAt).toBeUndefined();
    expect(weeklyNewsFeed(ahead, Date.parse(future.publishedAt)).events[0].outcome).toEqual(event.outcome);
    expect(weeklyCalendarSchema.safeParse({ ...data, events: [{ ...event, publishedAt: null }] }).success).toBe(false);
    expect(weeklyCalendarSchema.safeParse({ ...data, events: [{ ...event, outcome: { en: "Only English" } }] }).success).toBe(false);
    expect(weeklyCalendarSchema.safeParse({ ...data, events: [{ ...event, kind: "release" }] }).success).toBe(false);
  });
  it("retains the start of the previous full week on Sunday and preserves old event links", () => {
    const previousMonday = { ...calendar.events[0], scheduledAt: "2026-09-28T12:30:00Z", publishedAt: "2026-09-28T12:30:00Z", actual: "0%" };
    const data = { ...calendar, events: [previousMonday] };
    const sunday = Date.parse("2026-10-11T20:59:59Z");
    expect(weeklyNewsFeed(data, sunday).events[0]).toMatchObject({ id: previousMonday.id, actual: "0%" });
    expect(weeklyNewsFeed(data, sunday + 7 * 86_400_000).events).toHaveLength(0);
    expect(weeklyNewsFeed(data, sunday + 7 * 86_400_000, previousMonday.id).events).toHaveLength(1);
  });
  it.each(["duplicate", "source", "malformed URL", "agency", "future actual", "offset", "forecast", "coverage", "week length", "week start"])("rejects invalid %s data before deployment", (problem) => {
    const data = clone();
    if (problem === "duplicate") data.events.push({ ...data.events[0] });
    if (problem === "source") data.events[0].sourceUrl = "https://www.bls.gov.evil.example/release";
    if (problem === "malformed URL") data.events[0].sourceUrl = "invalid";
    if (problem === "agency") data.events[0].agency = "fed";
    if (problem === "future actual") data.events[0].publishedAt = data.coverageEnd;
    if (problem === "offset") data.events[0].scheduledAt = "2026-10-01T08:30:00-04:00";
    if (problem === "forecast") Object.assign(data.events[0], { forecast: "1%" });
    if (problem === "coverage") data.coverageEnd = data.coverageStart;
    if (problem === "week length") data.weekEnd = data.weekStart;
    if (problem === "week start") data.weekStart = new Date(Date.parse(`${data.weekStart}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(weeklyCalendarSchema.safeParse(data).success).toBe(false);
  });
  it("uses UTC instants across different U.S. and Israeli daylight saving transitions", () => {
    // Fixed regression instants, independent of the rolling production snapshot.
    const october = "2026-10-02T12:30:00Z";
    const november = "2026-11-06T13:30:00Z";
    const israel = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit" });
    const newYork = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" });
    expect(newYork.format(new Date(october))).toBe("08:30");
    expect(newYork.format(new Date(november))).toBe("08:30");
    expect(israel.format(new Date(october))).toBe("15:30");
    expect(israel.format(new Date(november))).toBe("15:30");
  });
});
