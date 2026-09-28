import "server-only";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { readOwnerPresenceAnalytics } from "@/lib/user-presence-store";
import { readOwnerTrafficAnalytics } from "@/lib/traffic-analytics-store";
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
  const [presence, traffic] = await Promise.all([
    capture(async () => {
      const value = await readOwnerPresenceAnalytics();
      // Only aggregate counts cross this endpoint; no session/user identifiers.
      return { onlineNow: value.onlineNow, activeToday: value.activeToday,
        activeLast7Days: value.activeLast7Days, activeLast30Days: value.activeLast30Days };
    }),
    capture(readOwnerTrafficAnalytics),
  ]);
  return { timeZone: LIVE_ANALYTICS_TIME_ZONE, presence, traffic };
}
