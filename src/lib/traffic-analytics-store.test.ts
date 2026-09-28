// @vitest-environment node
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

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec("create schema alpha_exchange");
  await readOwnerTrafficAnalytics();
}, 30_000);
beforeEach(async () => { await state.db.exec("truncate alpha_exchange.traffic_events"); });
afterAll(async () => { await state.db?.close(); });

type Visit = Partial<Parameters<typeof recordTrafficEvent>[0]>;
async function visit(overrides: Visit = {}) {
  expect(await recordTrafficEvent({ visitorKey: "browser-a", sessionKey: "tab-a", userId: "account-a",
    eventName: "page_view", path: "/en/usdt-exchange", platform: "web", deviceType: "desktop", ...overrides })).toBe(true);
}

describe("unique section visitors using the actual PostgreSQL queries", () => {
  it("goes from 90 to 91 for a new user, stays 91 on return, and counts another section independently", async () => {
    for (let index = 0; index < 90; index++) await visit({ userId: `existing-${index}`, visitorKey: `browser-${index}` });
    expect((await readOwnerTrafficAnalytics()).allTimePages[0].uniqueVisitors).toBe(90);
    await visit({ userId: "new-user", visitorKey: "new-browser" });
    expect((await readOwnerTrafficAnalytics()).allTimePages[0].uniqueVisitors).toBe(91);
    await visit({ userId: "new-user", visitorKey: "new-browser", path: "/en/prop-firms" });
    await visit({ userId: "new-user", visitorKey: "new-browser", sessionKey: "another-tab" });
    const result = await readOwnerTrafficAnalytics();
    expect(result.allTimePages).toEqual([
      { path: "/usdt-exchange", uniqueVisitors: 91, views: 92 },
      { path: "/prop-firms", uniqueVisitors: 1, views: 1 },
    ]);
    expect(result.topPages).toEqual(result.allTimePages);
    expect(result.visitorsToday).toBe(91);
    expect(result.pageViewsToday).toBe(93);
  });

  it("deduplicates a signed-in account across web, iOS, Android, reloads and tabs", async () => {
    await visit();
    await visit({ visitorKey: "ios-browser", sessionKey: "ios-tab", platform: "ios", deviceType: "mobile" });
    await visit({ visitorKey: "android-browser", sessionKey: "android-tab", platform: "android", deviceType: "mobile" });
    await visit({ sessionKey: "reopened-tab" });
    const result = await readOwnerTrafficAnalytics();
    expect(result.visitorsToday).toBe(1);
    expect(result.topPages[0]).toEqual({ path: "/usdt-exchange", uniqueVisitors: 1, views: 4 });
    expect(result.sessionsToday).toBe(4);
    expect([result.webToday, result.iosToday, result.androidToday]).toEqual([2, 1, 1]);
  });

  it("counts returning guests once using their saved browser identity", async () => {
    await visit({ userId: null });
    await visit({ userId: null, sessionKey: "new-tab" });
    await visit({ userId: null, visitorKey: "different-guest", sessionKey: "different-tab" });
    const result = await readOwnerTrafficAnalytics();
    expect(result.visitorsToday).toBe(2);
    expect(result.topPages[0].uniqueVisitors).toBe(2);
    expect(result.pageViewsToday).toBe(3);
  });

  it("links guest visits before and after sign-in to the same unambiguous account", async () => {
    await visit({ userId: null, path: "/ar/prop-firms" });
    await visit({ path: "/en/prop-firms" });
    await visit({ userId: null, sessionKey: "signed-out-tab", path: "/en/prop-firms" });
    await visit({ visitorKey: "other-device", sessionKey: "other-tab", path: "/en/prop-firms" });
    const result = await readOwnerTrafficAnalytics();
    expect(result.visitorsToday).toBe(1);
    expect(result.allTimePages).toEqual([{ path: "/prop-firms", uniqueVisitors: 1, views: 4 }]);
  });

  it("never merges two signed-in accounts that share a browser", async () => {
    await visit();
    await visit({ userId: "account-b" });
    expect((await readOwnerTrafficAnalytics()).topPages[0].uniqueVisitors).toBe(2);
    await visit({ userId: null });
    // An ambiguous signed-out visit remains a guest, not an invented account attribution.
    expect((await readOwnerTrafficAnalytics()).topPages[0].uniqueVisitors).toBe(3);
  });

  it("keeps account IDs and anonymous browser IDs in separate namespaces", async () => {
    await visit({ userId: "same-value" });
    await visit({ userId: null, visitorKey: "same-value" });
    expect((await readOwnerTrafficAnalytics()).visitorsToday).toBe(2);
  });

  it("groups languages, subpages, trailing slashes, query strings and anchors by section", async () => {
    for (const path of ["/en/prop-firms", "/ar/prop-firms/", "/prop-firms", "/en/prop-firms/fundednext", "/ar/prop-firms?source=home#compare"]) await visit({ path });
    await visit({ path: "/en" });
    await visit({ path: "/ar/" });
    const result = await readOwnerTrafficAnalytics();
    expect(result.allTimePages).toEqual([
      { path: "/", uniqueVisitors: 1, views: 2 },
      { path: "/prop-firms", uniqueVisitors: 1, views: 5 },
    ]);
  });

  it("retains all-time identity across midnight while daily metrics use Israel's reporting day", async () => {
    await visit();
    await visit({ userId: "old-account", visitorKey: "old-browser" });
    await state.db.exec("update alpha_exchange.traffic_events set occurred_at = date_trunc('day',now(),'Asia/Jerusalem') - interval '1 millisecond'");
    await visit({ userId: null }); // Browser already linked to account-a yesterday.
    await visit({ userId: "new-account", visitorKey: "new-browser" });
    const result = await readOwnerTrafficAnalytics();
    expect(result.visitorsToday).toBe(2);
    expect(result.pageViewsToday).toBe(2);
    expect(result.topPages[0]).toEqual({ path: "/usdt-exchange", uniqueVisitors: 2, views: 2 });
    expect(result.allTimePages[0]).toEqual({ path: "/usdt-exchange", uniqueVisitors: 3, views: 4 });
  });

  it("sorts sections by people instead of letting repeat clicks dominate the ranking", async () => {
    for (let index = 0; index < 8; index++) await visit({ path: "/en/prop-firms" });
    await visit();
    await visit({ userId: "another-person", visitorKey: "another-browser" });
    const result = await readOwnerTrafficAnalytics();
    expect(result.topPages.map((row) => row.path)).toEqual(["/usdt-exchange", "/prop-firms"]);
    expect(result.allTimePages[0].uniqueVisitors).toBe(2);
  });

  it("does not return visitor, session or account identifiers in the report", async () => {
    await visit();
    const report = JSON.stringify(await readOwnerTrafficAnalytics());
    for (const secret of ["account-a", "browser-a", "tab-a", "person_key", "visitor_key", "user_id"]) expect(report).not.toContain(secret);
  });
});
