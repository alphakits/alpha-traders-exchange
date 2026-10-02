// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewsEvent } from "./model";
import weeklySnapshot from "./weekly-calendar.json";

const state = vi.hoisted(() => ({ db: null as unknown as PGlite, calls: 0 }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => {
  state.calls++;
  const query = async (sql: string, params?: unknown[]) => params ? state.db.query(sql, params) : (await state.db.exec(sql)).at(-1)!;
  return { query, connect: async () => ({ query, release() {} }) };
} }));
import { persistNewsSnapshot, readNewsFeed } from "./repository";
import { drainNewsDeliveries } from "./worker";

const now = new Date();
const event: NewsEvent = { id: "te-123", providerId: "123", title: "CPI", titleAr: "التضخم", scheduledAt: new Date(now.getTime() - 60_000).toISOString(),
  currency: "USD", impact: "high", actual: null, forecast: "0.2%", previous: "0.3%", revised: null, reference: null, source: "BLS", sourceUrl: null,
  providerUpdatedAt: now.toISOString(), syncedAt: now.toISOString(), timing: "exact", kind: "release" };
const fxEvent = { ...event, id: "fxs-4fe1bd69-acce-4b24-9d54-f45c81708d29", providerId: "4fe1bd69-acce-4b24-9d54-f45c81708d29" };
function configure(provider = "trading-economics") {
  vi.stubEnv("ECONOMIC_NEWS_PROVIDER", provider); vi.stubEnv("ECONOMIC_NEWS_DATA_LICENSE_CONFIRMED", "true");
  vi.stubEnv("ECONOMIC_NEWS_WHITE_LABEL_CONFIRMED", "true"); vi.stubEnv("TRADING_ECONOMICS_API_KEY", "example");
  vi.stubEnv("FXSTREET_CLIENT_ID", "example"); vi.stubEnv("FXSTREET_CLIENT_SECRET", "example");
}
beforeAll(async () => {
  state.db = await PGlite.create();
  await state.db.exec(`create schema alpha_exchange;
    create role news_anon; grant usage on schema alpha_exchange to news_anon;
    create table alpha_exchange.users(id text primary key, payload jsonb);
    insert into alpha_exchange.users values ('member', '{"emailVerified":true,"notificationPreferences":{"inApp":true,"email":true}}');`);
  configure(); await persistNewsSnapshot([], now);
}, 30_000);
beforeEach(async () => {
  configure();
  await state.db.exec(`truncate alpha_exchange.economic_news_events, alpha_exchange.economic_news_provider_sync,
    alpha_exchange.economic_news_sync, alpha_exchange.economic_news_subscriptions, alpha_exchange.economic_news_deliveries;
    insert into alpha_exchange.economic_news_subscriptions(user_id,in_app,email,in_app_since,email_since)
      values ('member',true,true,now()-interval '1 day',now()-interval '1 day');`);
  state.calls = 0;
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await state.db?.close(); });

describe("news storage and provider isolation (real PostgreSQL)", () => {
  it("serves the free weekly calendar without storage work when a paid feed is not configured", async () => {
    vi.stubEnv("ECONOMIC_NEWS_DATA_LICENSE_CONFIRMED", "false");
    const weekly = await readNewsFeed(Date.parse(weeklySnapshot.verifiedAt));
    expect(weekly).toMatchObject({ mode: "weekly", status: "ready", provider: null });
    expect(weekly.events.length).toBeGreaterThan(0);
    expect(weekly.events.every((event) => event.id.startsWith("official-") && event.forecast === null)).toBe(true);
    expect(state.calls).toBe(0);
  });
  it("queues one release per channel, preserves revisions and never replays an older sync", async () => {
    expect(await persistNewsSnapshot([event], now)).toMatchObject({ releases: 0 });
    const released = { ...event, actual: "0%", providerUpdatedAt: new Date(now.getTime() + 1000).toISOString() };
    expect(await persistNewsSnapshot([released], new Date(now.getTime() + 2000))).toMatchObject({ releases: 1 });
    const revision = { ...released, actual: "0.1%", providerUpdatedAt: new Date(now.getTime() + 3000).toISOString() };
    expect(await persistNewsSnapshot([revision], new Date(now.getTime() + 4000))).toMatchObject({ releases: 0 });
    expect(await persistNewsSnapshot([event], now)).toMatchObject({ synced: false });
    const deliveries = await state.db.query("select id from alpha_exchange.economic_news_deliveries");
    expect(deliveries.rows).toHaveLength(2);
    const feed = await readNewsFeed(now.getTime() + 5000);
    expect(feed).toMatchObject({ status: "ready", provider: null });
    expect(feed.events[0]).toMatchObject({ actual: "0.1%", corrected: true });
  });
  it("starts a separate provider baseline and never mixes cached events or queued alerts", async () => {
    await persistNewsSnapshot([event], now);
    await persistNewsSnapshot([{ ...event, actual: "0%" }], new Date(now.getTime() + 1000));
    configure("fxstreet");
    expect(await readNewsFeed(now.getTime())).toMatchObject({ status: "unavailable", events: [] });
    expect(await persistNewsSnapshot([{ ...fxEvent, actual: "0%" }], new Date(now.getTime() + 2000))).toMatchObject({ releases: 0 });
    const feed = await readNewsFeed(now.getTime() + 3000, event.id);
    expect(feed.status).toBe("ready"); expect(feed.events.map((e) => e.id)).toEqual([fxEvent.id]);
    expect(await drainNewsDeliveries(Date.now() + 10_000)).toEqual({ sent: 0, failed: 0 });
    await expect(persistNewsSnapshot([event], new Date(now.getTime() + 4000))).rejects.toThrow("provider mismatch");
  });
  it("stores results with unknown source freshness but does not alert on them", async () => {
    configure("fxstreet");
    await persistNewsSnapshot([{ ...fxEvent, providerUpdatedAt: null }], now);
    expect(await persistNewsSnapshot([{ ...fxEvent, actual: "0%", providerUpdatedAt: null }], new Date(now.getTime() + 1000))).toMatchObject({ releases: 0 });
    expect((await readNewsFeed(now.getTime() + 2000)).events[0].actual).toBe("0%");
  });
  it("prevents direct client reads even if table grants are accidentally present", async () => {
    await persistNewsSnapshot([event], now);
    await state.db.exec(`grant select on all tables in schema alpha_exchange to news_anon; set role news_anon;`);
    try {
      for (const table of ["economic_news_events", "economic_news_provider_sync", "economic_news_subscriptions", "economic_news_deliveries"])
        expect((await state.db.query(`select * from alpha_exchange.${table}`)).rows).toHaveLength(0);
    } finally { await state.db.exec("reset role"); }
  });
});
