// @vitest-environment node
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PostgresProductionHealthHistory } from "./production-health-history";
import type { ProductionHealthObservation } from "./production-health-worker";

let db: PGlite;
const epoch = Date.parse("2026-10-19T00:00:00Z");
const report = (offset = 0): ProductionHealthObservation => ({
  startedUtc: new Date(epoch + offset).toISOString(), finishedUtc: new Date(epoch + offset + 1000).toISOString(),
  complete: true, status: "healthy", activeIncidents: {}, coverageGaps: [],
});
const store = () => new PostgresProductionHealthHistory(db as unknown as Pick<Pool, "query">);
beforeEach(async () => {
  db = new PGlite();
  await db.exec("CREATE SCHEMA alpha_exchange; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA alpha_exchange TO anon, authenticated;");
  await db.exec(readFileSync("supabase/migrations/20261019041423_public_production_health_history.sql", "utf8"));
});
afterEach(async () => { await db.close(); });

it("restores sanitized observations across store instances without replacing newer evidence", async () => {
  await store().save({ ...report(), token: "must-never-persist" } as ProductionHealthObservation);
  await store().save(report(300_000));
  await store().save({ ...report(), status: "component_degraded",
    activeIncidents: { outage: { kind: "component", component: "/api/health", code: "http_error" } } });
  expect(await store().load()).toEqual([report(), report(300_000)]);
  const saved = await db.query("SELECT observation FROM alpha_exchange.public_production_health_history");
  expect(JSON.stringify(saved.rows)).not.toContain("must-never-persist");
});

it("bounds returned history and expires only old monitoring rows", async () => {
  await store().save(report(-86_400_001));
  for (let i = 0; i < 26; i++) await store().save(report(i * 300_000));
  const history = await store().load();
  expect(history).toHaveLength(24);
  expect(history[0]).toEqual(report(600_000));
  expect(history.at(-1)).toEqual(report(25 * 300_000));
  expect((await db.query<{ count: number }>("SELECT count(*)::int as count FROM alpha_exchange.public_production_health_history")).rows[0].count).toBe(26);
});

it.each(["anon", "authenticated"])("denies direct browser access for %s", async role => {
  await store().save(report());
  await db.exec(`SET ROLE ${role}`);
  await expect(db.query("SELECT * FROM alpha_exchange.public_production_health_history")).rejects.toThrow(/permission denied/);
  await db.exec("RESET ROLE");
});

it("rejects malformed persisted summaries", async () => {
  await db.query("INSERT INTO alpha_exchange.public_production_health_history VALUES ($1, $2)", [report().startedUtc, JSON.stringify({ ...report(), complete: false })]);
  await expect(store().load()).rejects.toThrow("Contradictory");
});
