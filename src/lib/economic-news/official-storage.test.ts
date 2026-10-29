// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import snapshot from "./weekly-calendar.json";
import { weeklyCalendarSchema } from "./weekly-schema";
import type { OfficialResult } from "./official-sources";

const state = vi.hoisted(() => ({ db: null as unknown as PGlite, available: true }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => {
  if (!state.available) return null;
  const query = async (sql: string, params?: unknown[]) => params ? state.db.query(sql, params) : (await state.db.exec(sql)).at(-1)!;
  return { query, connect: async () => ({ query, release() {} }) };
} }));
import { acquireOfficialNewsLease, mergeOfficialResults, OFFICIAL_NEWS_SCHEMA, readOfficialResults, saveOfficialResults, validatedOfficialResult } from "./official-storage";
import { readOfficialWeeklyNewsFeed } from "./weekly";

const calendar = weeklyCalendarSchema.parse(snapshot);
const now = Date.parse("2026-10-29T12:31:00Z");
const claims = calendar.events.find(e => e.id === "official-dol-initial-claims-20261029")!;
const result: OfficialResult = { event: { ...claims, actual: "190K", previous: "194K", revised: "195K", publishedAt: claims.scheduledAt, sourceUrl: "https://www.dol.gov/ui/data.pdf" }, checkedAt: "2026-10-29T12:30:30Z", sourceHash: "a".repeat(64) };
let lease: { pool: Pool; token: string };
beforeAll(async () => {
  state.db = await PGlite.create();
  await state.db.exec(`create schema alpha_exchange; create role news_runtime_anon; create role anon; create role authenticated;
    grant usage on schema alpha_exchange to news_runtime_anon, anon, authenticated;
    alter default privileges in schema alpha_exchange grant all on tables to anon, authenticated;`);
  await acquireOfficialNewsLease(now);
}, 30_000);
beforeEach(async () => {
  state.available = true;
  await state.db.exec("truncate alpha_exchange.economic_news_official_results, alpha_exchange.economic_news_official_sync");
  lease = (await acquireOfficialNewsLease(now))!;
});
afterAll(async () => { await state.db.close(); });

describe("server-only runtime News results on real PostgreSQL semantics", () => {
  it("publishes a result immediately through the existing feed without rebuilding the snapshot", async () => {
    expect(await saveOfficialResults(lease, calendar, [result], now, {})).toBe(1);
    const feed = await readOfficialWeeklyNewsFeed(now);
    expect(feed.events.find(e => e.id === claims.id)?.actual).toBe("190K");
    expect(feed).toMatchObject({ officialUpdates: "active", officialStorageAvailable: true, officialCheckedAt: new Date(now).toISOString() });
    expect(feed.events.find(e => e.id === "official-dol-initial-claims-20261105")?.previous).toBe("190K");
    expect(calendar.events.find(e => e.id === claims.id)?.actual).toBeNull();
  });
  it("leases one collector, is idempotent, and rejects obsolete workers", async () => {
    expect(await acquireOfficialNewsLease(now + 1000)).toBeNull();
    expect(await saveOfficialResults(lease, calendar, [result], now, {})).toBe(1);
    expect(await saveOfficialResults(lease, calendar, [result], now + 1000, {})).toBe(0);
    const newer = (await acquireOfficialNewsLease(now + 60_000))!;
    expect(newer.token).not.toBe(lease.token);
    expect(await saveOfficialResults(lease, calendar, [{ ...result, event: { ...result.event, actual: "999K" }, checkedAt: "2026-10-29T12:32:00Z" }], now + 70_000, {})).toBe(0);
    expect((await readOfficialResults(calendar, now + 70_000)).calendar.events.find(e => e.id === claims.id)?.actual).toBe("190K");
  });
  it("keeps an audit of corrections and refuses stale replays or null results", async () => {
    await saveOfficialResults(lease, calendar, [result], now, {});
    const revised = { ...result, event: { ...result.event, actual: "191K" }, checkedAt: "2026-10-29T12:31:01Z" };
    expect(await saveOfficialResults(lease, calendar, [revised], now + 2000, {})).toBe(1);
    expect(await saveOfficialResults(lease, calendar, [result], now + 3000, {})).toBe(0);
    expect(await saveOfficialResults(lease, calendar, [{ ...revised, event: { ...revised.event, actual: null, publishedAt: null } }], now + 4000, {})).toBe(0);
    const row = (await state.db.query<{ revisions: { event: { actual: string } }[] }>("select revisions from alpha_exchange.economic_news_official_results")).rows[0];
    expect(row.revisions.map(r => r.event.actual)).toEqual(["190K"]);
  });
  it("retains published results when a source fails, and reports the delayed source", async () => {
    await saveOfficialResults(lease, calendar, [result], now, {});
    await saveOfficialResults(lease, calendar, [], now + 1000, { failed: [claims.id] });
    const feed = await readOfficialWeeklyNewsFeed(now + 1000);
    expect(feed.officialUpdates).toBe("delayed");
    expect(feed.events.find(e => e.id === claims.id)?.actual).toBe("190K");
  });
  it("blocks direct client access even with accidental SELECT grants", async () => {
    await saveOfficialResults(lease, calendar, [result], now, {});
    await state.db.exec("grant select on all tables in schema alpha_exchange to news_runtime_anon; set role news_runtime_anon;");
    try {
      expect((await state.db.query("select * from alpha_exchange.economic_news_official_results")).rows).toEqual([]);
      expect((await state.db.query("select * from alpha_exchange.economic_news_official_sync")).rows).toEqual([]);
    } finally { await state.db.exec("reset role"); }
  });
  it("revokes inherited client table privileges, including TRUNCATE which RLS does not cover", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["economic_news_official_results", "economic_news_official_sync"]) {
        const access = await state.db.query<{ allowed: boolean }>(
          "select has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as allowed",
          [role, `alpha_exchange.${table}`]);
        expect(access.rows[0].allowed).toBe(false);
      }
    }
  });
  it("tracks exactly the runtime schema in an idempotent migration", async () => {
    const migration = readFileSync("supabase/migrations/20261028202622_official_news_runtime_results.sql", "utf8").replace(/^--.*\n/, "").trim();
    expect(migration).toBe(OFFICIAL_NEWS_SCHEMA.trim());
    await state.db.exec(migration); await state.db.exec(migration);
    expect((await state.db.query("select tablename from pg_tables where schemaname='alpha_exchange'")).rows).toHaveLength(2);
  });
  it("falls back honestly when storage is unavailable", async () => {
    state.available = false;
    expect(await readOfficialResults(calendar, now)).toMatchObject({ calendar, available: false });
    expect(await readOfficialWeeklyNewsFeed(now)).toMatchObject({ officialUpdates: "delayed", officialStorageAvailable: false });
  });
  it("preserves all events, schedule metadata, saved results and future coverage", () => {
    const merged = mergeOfficialResults(calendar, [result], now);
    expect(merged.events.map(e => e.id)).toEqual(calendar.events.map(e => e.id));
    for (const key of ["verifiedAt", "weekStart", "weekEnd", "coverageStart", "coverageEnd"] as const) expect(merged[key]).toBe(calendar[key]);
    expect(merged.events.find(e => e.id === "official-fed-fomc-decision-20261028")).toEqual(calendar.events.find(e => e.id === "official-fed-fomc-decision-20261028"));
    expect(weeklyCalendarSchema.safeParse(merged).success).toBe(true);
  });
  it("does not erase a persisted result after Sunday schedule preparation", () => {
    const prepared = { ...calendar, verifiedAt: "2026-10-31T12:00:00Z", resultsVerifiedAt: "2026-10-31T12:00:00Z" };
    expect(mergeOfficialResults(prepared, [result], Date.parse("2026-10-31T13:00:00Z")).events.find(e => e.id === claims.id)?.actual).toBe("190K");
    const manual = { ...prepared, events: prepared.events.map(e => e.id === claims.id ? { ...result.event, actual: "192K" } : e) };
    expect(mergeOfficialResults(manual, [result], Date.parse("2026-10-31T13:00:00Z")).events.find(e => e.id === claims.id)?.actual).toBe("192K");
  });
  it("rejects tampered schedules, sources, timestamps and future publications", () => {
    for (const changed of [
      { ...result, checkedAt: "invalid" }, { ...result, checkedAt: "2027-01-01T00:00:00Z" },
      { ...result, event: { ...result.event, scheduledAt: "2026-10-29T13:00:00Z" } },
      { ...result, event: { ...result.event, sourceUrl: "https://example.com/" } },
      { ...result, event: { ...result.event, publishedAt: "2026-10-29T13:00:00Z" } },
    ]) expect(validatedOfficialResult(calendar, changed, now)).toBe(false);
  });
});
