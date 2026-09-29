/** UI/API contract only. No authentication, database writes or trade actions. */
import { OWNER_ANALYTICS_TIME_ZONE, ownerAnalyticsDateKey } from "@/lib/owner-analytics-reporting";
export const LIVE_ANALYTICS_TIME_ZONE = OWNER_ANALYTICS_TIME_ZONE;
export const LIVE_ANALYTICS_POLL_MS = 30_000;
export const LIVE_ANALYTICS_STALE_MS = 90_000;
export const LIVE_ANALYTICS_TIMEOUT_MS = 15_000;

export type PresenceCounts = {
  onlineNow: number;
  activeToday: number;
  activeLast7Days: number;
  activeLast30Days: number;
};
export type TrafficOverview = {
  visitors: number;
  accounts: number;
  guests: number;
  returningVisitors: number;
  sessions: number;
  pageViews: number;
  web: number;
  ios: number;
  android: number;
  mobile: number;
  desktop: number;
};
export type TrafficCounts = {
  visitorsToday: number;
  sessionsToday: number;
  pageViewsToday: number;
  webToday: number;
  iosToday: number;
  androidToday: number;
  mobileToday: number;
  desktopToday: number;
  periods: { all: TrafficOverview; today: TrafficOverview };
  topPages: Array<{ path: string; uniqueVisitors: number; views: number }>;
  allTimePages: Array<{ path: string; uniqueVisitors: number; views: number }>;
  sources: Array<{ source: string; sessions: number; uniqueVisitors: number }>;
  allTimeSources: Array<{ source: string; sessions: number; uniqueVisitors: number }>;
};
export type AnalyticsSource<T> =
  | { status: "ready"; asOf: string; data: T }
  | { status: "unavailable"; asOf: null; data: null };
export type LiveAnalyticsSnapshot = {
  timeZone: typeof LIVE_ANALYTICS_TIME_ZONE;
  reportingStartedAt: string | null;
  presence: AnalyticsSource<PresenceCounts>;
  traffic: AnalyticsSource<TrafficCounts>;
};
export type LiveAnalyticsState = {
  snapshot: LiveAnalyticsSnapshot | null;
  refreshing: boolean;
  failed: boolean;
  forbidden: boolean;
};
export const initialLiveAnalyticsState = (): LiveAnalyticsState => ({
  snapshot: null, refreshing: false, failed: false, forbidden: false,
});

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const presenceKeys = ["onlineNow", "activeToday", "activeLast7Days", "activeLast30Days"] as const;
const trafficKeys = ["visitorsToday", "sessionsToday", "pageViewsToday", "webToday", "iosToday", "androidToday", "mobileToday", "desktopToday"] as const;
function validPresence(value: unknown): value is PresenceCounts {
  return object(value) && presenceKeys.every((key) => count(value[key]));
}
function validTraffic(value: unknown): value is TrafficCounts {
  const validPage = (row: unknown) => object(row) && typeof row.path === "string"
    && row.path.length <= 240 && count(row.uniqueVisitors) && count(row.views)
    && (row.uniqueVisitors as number) <= (row.views as number);
  const overviewKeys = ["visitors", "accounts", "guests", "returningVisitors", "sessions", "pageViews", "web", "ios", "android", "mobile", "desktop"];
  const validOverview = (row: unknown) => object(row) && overviewKeys.every(key => count(row[key]))
    && Number(row.accounts) + Number(row.guests) === row.visitors
    && ["returningVisitors", "web", "ios", "android", "mobile", "desktop"].every(key => Number(row[key]) <= Number(row.visitors));
  const validSources = (rows: unknown) => Array.isArray(rows) && rows.length <= 8
    && rows.every(row => object(row) && typeof row.source === "string" && row.source.length <= 180
      && count(row.sessions) && count(row.uniqueVisitors));
  return object(value) && trafficKeys.every((key) => count(value[key]))
    && object(value.periods) && validOverview(value.periods.all) && validOverview(value.periods.today)
    && Array.isArray(value.topPages) && value.topPages.length <= 8
    && value.topPages.every(validPage)
    && Array.isArray(value.allTimePages) && value.allTimePages.length <= 100
    && value.allTimePages.every(validPage)
    && validSources(value.sources) && validSources(value.allTimeSources);
}
function source<T>(value: unknown, valid: (input: unknown) => input is T, now: number): AnalyticsSource<T> {
  if (object(value) && value.status === "ready" && typeof value.asOf === "string"
    && Number.isFinite(Date.parse(value.asOf)) && Date.parse(value.asOf) <= now + 60_000 && valid(value.data)) {
    return { status: "ready", asOf: value.asOf, data: value.data };
  }
  return { status: "unavailable", asOf: null, data: null };
}
/** Unknown/missing fields never become successful zero values. */
export function parseLiveAnalytics(value: unknown, now = Date.now()): LiveAnalyticsSnapshot | null {
  if (!object(value) || value.timeZone !== LIVE_ANALYTICS_TIME_ZONE
    || !object(value.presence) || !object(value.traffic)) return null;
  if (value.reportingStartedAt !== null && (typeof value.reportingStartedAt !== "string"
    || !Number.isFinite(Date.parse(value.reportingStartedAt)) || Date.parse(value.reportingStartedAt) > now + 60_000)) return null;
  if (value.reportingStartedAt === null && (value.presence.status !== "unavailable" || value.traffic.status !== "unavailable")) return null;
  return {
    timeZone: LIVE_ANALYTICS_TIME_ZONE,
    reportingStartedAt: value.reportingStartedAt,
    presence: source(value.presence, validPresence, now),
    traffic: source(value.traffic, validTraffic, now),
  };
}
const day = (value: number) => ownerAnalyticsDateKey(new Date(value));
export type SourceDisplay<T> = { status: "loading" | "ready" | "stale" | "unavailable"; data: T | null; asOf: string | null };
/** Expired snapshots and yesterday's counts are not presented as 'Today'. */
export function sourceDisplay<T>(value: AnalyticsSource<T> | undefined, failed: boolean, now: number): SourceDisplay<T> {
  if (!value) return { status: failed ? "unavailable" : "loading", data: null, asOf: null };
  if (value.status !== "ready") return { status: "unavailable", data: null, asOf: null };
  const age = now - Date.parse(value.asOf);
  if (failed || !Number.isFinite(age) || age < -60_000 || age >= LIVE_ANALYTICS_STALE_MS || day(now) !== day(Date.parse(value.asOf))) {
    return { status: "stale", data: null, asOf: value.asOf };
  }
  return { status: "ready", data: value.data, asOf: value.asOf };
}
export function displayAnalyticsCount(value: unknown): string {
  return count(value) ? (value as number).toLocaleString("en-US") : "—";
}
