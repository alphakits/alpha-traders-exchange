import "server-only";
import snapshot from "./weekly-calendar.json";
import { NEWS_CALENDAR_WINDOW_MS, WEEKLY_NEWS_STALE_AFTER_MS, type NewsFeed } from "./model";
import { weeklyCalendarSchema, type WeeklyCalendar } from "./weekly-schema";

const parsed = weeklyCalendarSchema.safeParse(snapshot);
const sourceNames = { bls: "U.S. Bureau of Labor Statistics", bea: "U.S. Bureau of Economic Analysis",
  dol: "U.S. Department of Labor", fed: "Federal Reserve", census: "U.S. Census Bureau" };

export function weeklyNewsFeed(calendar: WeeklyCalendar, now: number, eventId?: string): NewsFeed {
  const base = { mode: "weekly" as const, updatedAt: calendar.verifiedAt, provider: null,
    resultsVerifiedAt: calendar.resultsVerifiedAt && Date.parse(calendar.resultsVerifiedAt) <= now ? calendar.resultsVerifiedAt : undefined,
    coverageEnd: calendar.coverageEnd, weekStart: calendar.weekStart, weekEnd: calendar.weekEnd };
  // Expired coverage and snapshots from the future never masquerade as current.
  if (Date.parse(calendar.verifiedAt) > now + 5 * 60_000 || now >= Date.parse(calendar.coverageEnd)) {
    return { ...base, status: "unavailable", events: [] };
  }
  return {
    ...base,
    status: now - Date.parse(calendar.verifiedAt) > WEEKLY_NEWS_STALE_AFTER_MS ? "stale" : "ready",
    // The bounded snapshot includes the previous full calendar week. A rolling
    // seven-day cutoff would erase its early events as the current week passes.
    events: calendar.events.filter((event) => Date.parse(event.scheduledAt) >= now - NEWS_CALENDAR_WINDOW_MS || event.id === eventId)
      .map((event) => ({
        id: event.id, providerId: event.id, title: event.title, titleAr: event.titleAr,
        scheduledAt: event.scheduledAt, currency: "USD" as const, impact: "high" as const,
        actual: event.publishedAt && Date.parse(event.publishedAt) <= now && Date.parse(event.scheduledAt) <= now ? event.actual : null,
        outcome: event.publishedAt && Date.parse(event.publishedAt) <= now && Date.parse(event.scheduledAt) <= now ? event.outcome : undefined,
        publishedAt: event.publishedAt && Date.parse(event.publishedAt) <= now ? event.publishedAt : null,
        forecast: null, previous: event.previous, revised: event.revised, reference: event.reference,
        source: sourceNames[event.agency], sourceUrl: event.sourceUrl,
        providerUpdatedAt: null, syncedAt: calendar.verifiedAt, timing: event.timing, kind: event.kind,
      })).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)),
  };
}

export function readWeeklyNewsFeed(now = Date.now(), eventId?: string): NewsFeed {
  return parsed.success ? weeklyNewsFeed(parsed.data, now, eventId)
    : { mode: "weekly", status: "unavailable", updatedAt: null, provider: null, events: [] };
}
