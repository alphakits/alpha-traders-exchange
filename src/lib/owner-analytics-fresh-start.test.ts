// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const state = vi.hoisted(() => ({ db: null as unknown as PGlite }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => ({
  query: async (sql: string, params?: unknown[]) => {
    const result = params ? await state.db.query(sql, params) : (await state.db.exec(sql)).at(-1)!;
    return { ...result, rowCount: result.affectedRows };
  },
}) }));
import { readOwnerTrafficAnalytics, recordTrafficEvent } from "./traffic-analytics-store";
import { readOwnerPresenceAnalytics, recordUserPresence, readUserPresence } from "./user-presence-store";
import { readOwnerAnalyticsStart } from "./owner-analytics-period-store";
import { readOwnerLiveAnalytics } from "./owner-live-analytics-store";
import { parseLiveAnalytics } from "./owner-live-analytics";

const migration = readFileSync("supabase/migrations/20260928203450_owner_analytics_fresh_start.sql", "utf8");
const activation = readFileSync("scripts/sql/start-owner-analytics-period.sql", "utf8");

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`create schema alpha_exchange;
    create role anon; create role authenticated;
    create table alpha_exchange.users(id text primary key, payload jsonb not null default '{}');
    create table alpha_exchange.sessions(token_hash text primary key, user_id text, expires_at timestamptz);
    create table alpha_exchange.trades(id text primary key, amount integer);
    insert into alpha_exchange.users values ('account-a','{}'), ('account-b','{}');
    insert into alpha_exchange.sessions values ('session-a','account-a',now() + interval '1 day'), ('session-b','account-b',now() + interval '1 day');
    insert into alpha_exchange.trades values ('untouched-trade',100);`);
  await state.db.exec(migration);
  await readOwnerTrafficAnalytics();
  await readOwnerPresenceAnalytics();
}, 30_000);
beforeEach(async () => { await state.db.exec("truncate alpha_exchange.traffic_events, alpha_exchange.user_presence, alpha_exchange.owner_analytics_periods"); });
afterAll(async () => { await state.db?.close(); });

async function visit(userId: string | null = "account-a", path = "/en/usdt-exchange", referrerHost: string | null = null) {
  await recordTrafficEvent({ visitorKey: userId ? `browser-${userId}` : "guest-browser", sessionKey: "tab-a", userId,
    eventName: "page_view", path, platform: "web", deviceType: "desktop", referrerHost });
}
async function activity(sequence = 1) {
  await recordUserPresence("account-a", "session-a", { clientId: "tab-a", sequence, active: true, activity: true });
}

describe("explicit analytics fresh start", () => {
  it("never shows pre-reset history if activation is missing and never activates on a read", async () => {
    await visit();
    await activity();
    const result = await readOwnerLiveAnalytics();
    expect(result.reportingStartedAt).toBeNull();
    expect(result.traffic.status).toBe("unavailable");
    expect(result.presence.status).toBe("unavailable");
    expect(parseLiveAnalytics(result)?.traffic.status).toBe("unavailable");
    expect((await state.db.query("select * from alpha_exchange.owner_analytics_periods")).rows).toHaveLength(0);
  });

  it("deletes the old traffic rows and makes every live metric zero without altering operational data", async () => {
    await visit("account-a", "/en/usdt-exchange", "old.example");
    await visit("account-a", "/ar/usdt-exchange", "old.example");
    await visit("account-b", "/en/prop-firms");
    await activity();
    const publicPresence = await readUserPresence(["account-a"]);
    await state.db.exec(activation);
    expect((await state.db.query("select * from alpha_exchange.traffic_events")).rows).toHaveLength(0);
    const result = await readOwnerLiveAnalytics();
    expect(result.reportingStartedAt).toBe(await readOwnerAnalyticsStart());
    expect(result.presence).toMatchObject({ status: "ready", data: { onlineNow: 0, activeToday: 0, activeLast7Days: 0, activeLast30Days: 0 } });
    expect(result.traffic).toMatchObject({ status: "ready", data: {
      visitorsToday: 0, sessionsToday: 0, pageViewsToday: 0, webToday: 0, iosToday: 0,
      androidToday: 0, mobileToday: 0, desktopToday: 0, topPages: [], allTimePages: [], sources: [],
    } });
    expect(await readUserPresence(["account-a"])).toEqual(publicPresence);
    expect((await state.db.query("select * from alpha_exchange.users")).rows).toHaveLength(2);
    expect((await state.db.query("select * from alpha_exchange.sessions")).rows).toHaveLength(2);
    expect((await state.db.query("select * from alpha_exchange.trades")).rows).toEqual([{ id: "untouched-trade", amount: 100 }]);
  });

  it("starts at one, keeps one after repeated visits, and counts a second account as two", async () => {
    await visit(); await activity();
    await state.db.exec(activation);
    await visit(); await activity(2);
    let result = await readOwnerLiveAnalytics();
    expect(result.traffic.data?.allTimePages[0].uniqueVisitors).toBe(1);
    expect(result.presence.data?.activeLast30Days).toBe(1);
    await visit("account-a", "/ar/usdt-exchange");
    result = await readOwnerLiveAnalytics();
    expect(result.traffic.data?.allTimePages[0]).toEqual({ path: "/usdt-exchange", uniqueVisitors: 1, views: 2 });
    await visit("account-b");
    expect((await readOwnerLiveAnalytics()).traffic.data?.allTimePages[0].uniqueVisitors).toBe(2);
  });

  it("does not reset a second time on activation retries or redeploying the schema", async () => {
    await state.db.exec(activation);
    const startedAt = await readOwnerAnalyticsStart();
    await visit(); await activity();
    await state.db.exec(migration);
    await state.db.exec(activation);
    expect(await readOwnerAnalyticsStart()).toBe(startedAt);
    expect((await readOwnerLiveAnalytics()).traffic.data?.visitorsToday).toBe(1);
    expect((await state.db.query("select * from alpha_exchange.traffic_events")).rows).toHaveLength(1);
  });

  it("excludes late-arriving old records and old referrers from every reporting query", async () => {
    await state.db.exec(activation);
    const startedAt = await readOwnerAnalyticsStart();
    await visit("account-b", "/en/prop-firms", "old.example");
    await state.db.query("update alpha_exchange.traffic_events set occurred_at = $1::timestamptz - interval '1 microsecond'", [startedAt]);
    await visit();
    const result = await readOwnerLiveAnalytics();
    expect(result.traffic.data?.visitorsToday).toBe(1);
    expect(result.traffic.data?.pageViewsToday).toBe(1);
    expect(result.traffic.data?.allTimePages).toEqual([{ path: "/usdt-exchange", uniqueVisitors: 1, views: 1 }]);
    expect(result.traffic.data?.sources).toEqual([{ source: "Direct", sessions: 1 }]);
  });

  it("does not expose reporting-period storage to public clients", async () => {
    const result = await state.db.query<{ rls: boolean; anon_select: boolean; member_select: boolean }>(`select
      relrowsecurity as rls,
      has_table_privilege('anon','alpha_exchange.owner_analytics_periods','SELECT') as anon_select,
      has_table_privilege('authenticated','alpha_exchange.owner_analytics_periods','SELECT') as member_select
      from pg_class where oid = 'alpha_exchange.owner_analytics_periods'::regclass`);
    expect(result.rows).toEqual([{ rls: true, anon_select: false, member_select: false }]);
  });
});
