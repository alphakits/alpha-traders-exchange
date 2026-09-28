/* Focused offline checks, not a full browser, authorization or Postgres test.
 * Run: node scripts/check-owner-analytics-reporting.mjs
 * Uses the repository's existing TypeScript dependency; no network or secrets.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as crypto from "node:crypto";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (name) => fs.readFileSync(`${root}src/lib/${name}.ts`, "utf8");
function load(name, dependencies = {}, extra = {}) {
  const input = source(name);
  const output = ts.transpileModule(input, {
    fileName: `${name}.ts`, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  assert.equal(output.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const sandboxModule = { exports: {} };
  vm.runInNewContext(output.outputText, {
    module: sandboxModule, exports: sandboxModule.exports, Intl, Date,
    require(path) {
      if (Object.hasOwn(dependencies, path)) return dependencies[path];
      if (path === "server-only") return {};
      if (path === "crypto") return crypto;
      throw Error(`Unexpected dependency: ${path}`);
    }, ...extra,
  });
  return sandboxModule.exports;
}
const reporting = load("owner-analytics-reporting");
function presence(db, extra = {}) {
  return load("user-presence-store", {
    "@/lib/postgres-runtime": { getRuntimePostgresPool: () => db },
    "@/lib/owner-analytics-reporting": reporting,
    "@/lib/public-account-identity": { isPublicOwnerIdentity: () => false },
    "@alpha-traders/contracts": { PRESENCE_LEASE_MS: 90_000, PRESENCE_IDLE_MS: 300_000 },
  }, extra);
}
function traffic(db) {
  return load("traffic-analytics-store", {
    "@/lib/postgres-runtime": { getRuntimePostgresPool: () => db },
    "@/lib/owner-analytics-reporting": reporting,
  });
}

test("reporting uses a named zone, not a fixed UTC offset", () => {
  assert.equal(reporting.OWNER_ANALYTICS_TIME_ZONE, "Asia/Jerusalem");
});
for (const [timestamp, expected] of [
  ["2026-09-24T20:59:59.999Z", "2026-09-24"],
  ["2026-09-24T21:00:00.000Z", "2026-09-25"],
  ["2026-09-25T00:00:00.000Z", "2026-09-25"],
  ["2026-01-15T21:59:59.999Z", "2026-01-15"],
  ["2026-01-15T22:00:00.000Z", "2026-01-16"],
  ["2026-12-31T22:00:00.000Z", "2027-01-01"],
]) {
  test(`Israel day at ${timestamp}`, () => assert.equal(reporting.ownerAnalyticsDateKey(new Date(timestamp)), expected));
}
test("invalid timestamps are rejected", () => assert.throws(() => reporting.ownerAnalyticsDateKey(new Date("invalid")), /Invalid analytics date/));

test("all traffic summary/top-page/source queries use the same Israel cutoff", async () => {
  const calls = [];
  const store = traffic({ async query(sql) { calls.push(sql); return { rows: [] }; } });
  const result = await store.readOwnerTrafficAnalytics();
  const reads = calls.filter((sql) => sql.startsWith("select"));
  assert.equal(reads.length, 3);
  for (const sql of reads) assert.match(sql, /date_trunc\('day',now\(\),'Asia\/Jerusalem'\)/);
  assert.equal(result.pageViewsToday, 0);
  assert.equal(result.visitorsToday, 0);
});

test("presence counts and user lists share the Israel boundary and valid-session predicates", async () => {
  let query, parameters;
  const store = presence({ async query(sql, values) {
    if (!sql.startsWith("select")) return { rows: [] };
    query = sql; parameters = values;
    return { rows: [{ online_now: "1", active_today: "2", active_7d: "3", active_30d: "4", online_user_ids: ["synthetic-online"], active_today_user_ids: ["synthetic-online", "synthetic-today"] }] };
  } });
  const result = await store.readOwnerPresenceAnalytics();
  assert.equal(result.onlineNow, 1); assert.equal(result.activeToday, 2);
  assert.equal(result.activeLast7Days, 3); assert.equal(result.activeLast30Days, 4);
  assert.equal(result.onlineUserIds.length, 1); assert.equal(result.activeTodayUserIds.length, 2);
  assert.equal((query.match(/date_trunc\('day', now\(\), 'Asia\/Jerusalem'\)/g) ?? []).length, 2);
  assert.equal((query.match(/s\.token_hash = p\.session_key and s\.user_id = p\.user_id and s\.expires_at > now\(\)/g) ?? []).length, 2);
  assert.equal((query.match(/coalesce\(u\.payload->>'disabled', 'false'\) <> 'true'/g) ?? []).length, 2);
  assert.deepEqual(Array.from(parameters), [90_000, 300_000]);
});

test("development presence uses Israel midnight even before UTC midnight", async () => {
  let now = Date.parse("2026-09-24T20:59:00Z");
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const store = presence(null, { Date: Clock });
  const update = { clientId: "synthetic-client", sequence: 1, active: true, activity: true };
  await store.recordUserPresence("synthetic-yesterday", "synthetic-session-a", update);
  now = Date.parse("2026-09-24T21:05:00Z");
  await store.recordUserPresence("synthetic-today", "synthetic-session-b", update);
  const result = await store.readOwnerPresenceAnalytics();
  assert.equal(result.activeToday, 1);
  assert.equal(result.activeTodayUserIds[0], "synthetic-today");
  assert.equal(result.activeLast7Days, 2);
});

test("development presence does not count one user twice across tabs", async () => {
  const store = presence(null);
  for (const clientId of ["synthetic-a", "synthetic-b"]) {
    await store.recordUserPresence("synthetic-user", "synthetic-session", { clientId, sequence: 1, active: true, activity: true });
  }
  assert.equal((await store.readOwnerPresenceAnalytics()).activeToday, 1);
});

test("traffic database errors are not converted into successful zero counts", async () => {
  const store = traffic({ async query(sql) {
    if (sql.startsWith("select")) throw Error("synthetic read failure");
    return { rows: [] };
  } });
  await assert.rejects(store.readOwnerTrafficAnalytics(), /synthetic read failure/);
});

test("presence database errors are not converted into successful zero counts", async () => {
  const store = presence({ async query(sql) {
    if (sql.startsWith("select")) throw Error("synthetic read failure");
    return { rows: [] };
  } });
  await assert.rejects(store.readOwnerPresenceAnalytics(), /synthetic read failure/);
});

// Protect existing schema, persistence, public presence and permission functions
// byte-for-byte, excluding the newly added reporting-helper import.
for (const [name, boundary, expected] of [
  ["traffic-analytics-store", "export type OwnerTrafficAnalytics", "1eb63d3fd728949c28e9a2f525f43ee96bf4a6022da5ee2d824e34ecddb34026"],
  ["user-presence-store", "export type OwnerPresenceAnalytics", "97d2d9f3bd6996dec6ee9f48c1eabefe09c5cb6a929e1b499a3da097928f94c2"],
]) {
  test(`${name}: schema and non-reporting implementation remain unchanged`, () => {
    const prefix = source(name).split(boundary)[0].replace(/^import .* from "@\/lib\/owner-analytics-reporting";\n/m, "");
    assert.equal(crypto.createHash("sha256").update(prefix).digest("hex"), expected);
  });
}
