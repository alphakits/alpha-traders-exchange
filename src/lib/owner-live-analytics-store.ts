import "server-only";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { readOwnerPresenceAnalytics } from "@/lib/user-presence-store";
import { readOwnerTrafficAnalytics } from "@/lib/traffic-analytics-store";
import { readOwnerAnalyticsStart } from "@/lib/owner-analytics-period-store";
import { LIVE_ANALYTICS_TIME_ZONE, type AnalyticsSource, type LiveAnalyticsSnapshot } from "@/lib/owner-live-analytics";

async function capture<T>(read: () => Promise<T>): Promise<AnalyticsSource<T>> {
  try {
    // Reject development/no-database fallbacks; live reporting requires storage.
    if (!getRuntimePostgresPool()) throw new Error("Analytics storage unavailable");
    // Anchor before querying so a read spanning midnight is hidden as stale.
    const asOf = new Date().toISOString();
    const data = await read();
    return { status: "ready", asOf, data };
  } catch {
    // Optional reporting failure must not expose SQL, credentials or user IDs.
    return { status: "unavailable", asOf: null, data: null };
  }
}

export async function readOwnerLiveAnalytics(): Promise<LiveAnalyticsSnapshot> {
  let reportingStartedAt: string;
  try {
    reportingStartedAt = await readOwnerAnalyticsStart();
  } catch {
    // Never fall back to old history when the new period is not activated.
    return { timeZone: LIVE_ANALYTICS_TIME_ZONE, reportingStartedAt: null,
      presence: { status: "unavailable", asOf: null, data: null },
      traffic: { status: "unavailable", asOf: null, data: null } };
  }
  const [presence, traffic] = await Promise.all([
    capture(async () => {
      const value = await readOwnerPresenceAnalytics(reportingStartedAt);
      // Only aggregate counts cross this endpoint; no session/user identifiers.
      return { onlineNow: value.onlineNow, activeToday: value.activeToday,
        activeLast7Days: value.activeLast7Days, activeLast30Days: value.activeLast30Days };
    }),
    capture(() => readOwnerTrafficAnalytics(reportingStartedAt)),
  ]);
  // Send a standard browser-safe timestamp; SQL filters above retain full precision.
  return { timeZone: LIVE_ANALYTICS_TIME_ZONE,
    reportingStartedAt: new Date(reportingStartedAt).toISOString(), presence, traffic };
}
