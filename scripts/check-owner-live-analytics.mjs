/* Focused offline checks of actual modules with HTTP/DB/React fixtures.
 * Not a replacement for full-repository tests or real browser/device acceptance.
 * Run: node scripts/check-owner-live-analytics.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => fs.readFileSync(root + path, "utf8");
function load(path, dependencies = {}, extra = {}) {
  const output = ts.transpileModule(read(path), { fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  assert.equal(output.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, path);
  const module = { exports: {} };
  vm.runInNewContext(output.outputText, { module, exports: module.exports, Date, Intl, AbortController,
    Response, URLSearchParams, setTimeout, clearTimeout,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name === "server-only") return {};
      throw new Error(`Unexpected dependency ${name} in ${path}`);
    }, ...extra });
  return module.exports;
}
const reporting = load("src/lib/owner-analytics-reporting.ts");
const model = load("src/lib/owner-live-analytics.ts", { "@/lib/owner-analytics-reporting": reporting });
const now = Date.parse("2026-09-25T04:40:00Z");
const unavailable = () => ({ status: "unavailable", asOf: null, data: null });
const traffic = () => ({ visitorsToday: 2, sessionsToday: 3, pageViewsToday: 5_000,
  webToday: 1, iosToday: 1, androidToday: 1, mobileToday: 2, desktopToday: 1,
  topPages: [{ path: "/en/start", views: 5_000 }], sources: [{ source: "Direct", sessions: 3 }] });
const presence = () => ({ onlineNow: 0, activeToday: 5, activeLast7Days: 10, activeLast30Days: 10 });
const ready = (data, time = now) => ({ status: "ready", asOf: new Date(time).toISOString(), data });
const snapshot = () => ({ timeZone: "Asia/Jerusalem", presence: ready(presence()), traffic: ready(traffic()) });
const clean = (value) => JSON.parse(JSON.stringify(value));

test("complete snapshot retains real counts including a genuine zero", () => {
  const result = model.parseLiveAnalytics(snapshot(), now);
  assert.equal(result.presence.data.onlineNow, 0);
  assert.equal(result.traffic.data.pageViewsToday, 5_000);
});
for (const value of [null, [], {}, { ...snapshot(), timeZone: "UTC" }, { ...snapshot(), presence: null }]) {
  test(`invalid envelope rejected: ${JSON.stringify(value)?.slice(0, 45)}`, () => assert.equal(model.parseLiveAnalytics(value, now), null));
}
for (const value of [undefined, null, -1, 1.5, "9", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid metric becomes unavailable, never zero: ${String(value)}`, () => {
    const body = snapshot(); body.traffic.data.visitorsToday = value;
    const result = model.parseLiveAnalytics(body, now);
    assert.equal(result.traffic.status, "unavailable");
    assert.equal(result.presence.status, "ready");
    assert.equal(model.displayAnalyticsCount(value), "—");
  });
}
test("invalid list rows and oversized lists are not trusted", () => {
  for (const rows of [[{ path: "/en", views: -1 }], Array.from({ length: 9 }, () => ({ path: "/en", views: 1 }))]) {
    const body = snapshot(); body.traffic.data.topPages = rows;
    assert.equal(model.parseLiveAnalytics(body, now).traffic.status, "unavailable");
  }
});
test("missing metric source stays unavailable", () => {
  const body = snapshot(); body.traffic = unavailable();
  assert.equal(model.sourceDisplay(model.parseLiveAnalytics(body, now).traffic, false, now).data, null);
});
test("timestamps too far in the future are rejected", () => {
  const body = snapshot(); body.presence.asOf = new Date(now + 60_001).toISOString();
  assert.equal(model.parseLiveAnalytics(body, now).presence.status, "unavailable");
});
test("fresh read is not stale merely because no new visit occurred", () => {
  const result = model.sourceDisplay(ready(presence()), false, now + 30_000);
  assert.equal(result.status, "ready"); assert.equal(result.data.onlineNow, 0);
});
test("freshness expires at 90 seconds", () => {
  assert.equal(model.sourceDisplay(ready(presence()), false, now + 89_999).status, "ready");
  assert.equal(model.sourceDisplay(ready(presence()), false, now + 90_000).status, "stale");
  assert.equal(model.sourceDisplay(ready(presence()), false, now + 90_000).data, null);
});
test("failed reads hide old counts rather than relabeling them live", () => {
  const result = model.sourceDisplay(ready(traffic()), true, now);
  assert.equal(result.status, "stale"); assert.equal(result.data, null); assert.ok(result.asOf);
});
for (const midnight of ["2026-09-24T21:00:00Z", "2026-01-15T22:00:00Z"]) {
  test(`Israel midnight invalidates yesterday's Today counts: ${midnight}`, () => {
    const tick = Date.parse(midnight);
    assert.equal(model.sourceDisplay(ready(traffic(), tick - 1_000), false, tick).status, "stale");
  });
}
test("loading, unavailable and true zero are different", () => {
  assert.equal(model.sourceDisplay(undefined, false, now).status, "loading");
  assert.equal(model.sourceDisplay(undefined, true, now).status, "unavailable");
  assert.equal(model.displayAnalyticsCount(0), "0");
  assert.equal(model.displayAnalyticsCount(5_000), "5,000");
});

function store({ hasDb = true, presenceRead = async () => ({ ...presence(), onlineUserIds: ["private-id"] }), trafficRead = async () => traffic() } = {}) {
  return load("src/lib/owner-live-analytics-store.ts", {
    "@/lib/postgres-runtime": { getRuntimePostgresPool: () => hasDb ? {} : null },
    "@/lib/user-presence-store": { readOwnerPresenceAnalytics: presenceRead },
    "@/lib/traffic-analytics-store": { readOwnerTrafficAnalytics: trafficRead },
    "@/lib/owner-live-analytics": model,
  });
}
test("server exposes aggregate presence only, not user identifiers", async () => {
  const result = await store().readOwnerLiveAnalytics();
  assert.equal(result.presence.status, "ready");
  assert.equal("onlineUserIds" in result.presence.data, false);
  assert.equal(result.timeZone, "Asia/Jerusalem");
});
test("missing durable database does not become successful empty analytics", async () => {
  let reads = 0;
  const result = await store({ hasDb: false, presenceRead: async () => { reads++; return presence(); } }).readOwnerLiveAnalytics();
  assert.equal(reads, 0);
  assert.equal(result.presence.status, "unavailable"); assert.equal(result.traffic.status, "unavailable");
});
test("traffic failure preserves successful presence and conceals raw errors", async () => {
  const result = await store({ trafficRead: async () => { throw Error("SQL secret fixture"); } }).readOwnerLiveAnalytics();
  assert.equal(result.presence.status, "ready"); assert.equal(result.traffic.status, "unavailable");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
test("presence failure preserves successful traffic", async () => {
  const result = await store({ presenceRead: async () => { throw Error("fixture"); } }).readOwnerLiveAnalytics();
  assert.equal(result.presence.status, "unavailable"); assert.equal(result.traffic.status, "ready");
});
function route(auth, readReport) {
  return load("src/app/api/admin/live-analytics/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/api-auth": { requireApiOwner: async () => auth },
    "@/lib/owner-live-analytics-store": { readOwnerLiveAnalytics: readReport },
  });
}
for (const status of [401, 403, 503]) {
  test(`authorization ${status} is preserved and no analytics are read`, async () => {
    let reads = 0;
    const result = await route({ user: null, unauthorized: Response.json({ error: "fixture" }, { status }) }, async () => { reads++; }).GET();
    assert.equal(result.status, status); assert.equal(reads, 0);
    assert.match(result.headers.get("cache-control"), /private, no-store/);
    assert.equal(result.headers.get("vary"), "Cookie");
  });
}
test("successful authorized endpoint has nonindexable noncacheable response", async () => {
  const response = await route({ user: { id: "synthetic-owner" } }, async () => snapshot()).GET();
  assert.equal(response.status, 200); assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal((await response.json()).traffic.data.pageViewsToday, 5_000);
});
test("partial response stays explicit; both sources unavailable returns 503", async () => {
  const body = snapshot(); body.traffic = unavailable();
  assert.equal((await route({ user: {} }, async () => body).GET()).status, 200);
  body.presence = unavailable();
  assert.equal((await route({ user: {} }, async () => body).GET()).status, 503);
});

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(responses = []) {
  let visible = true, visibility, signOut, clock = now, id = 0, calls = 0, unsubscribed = 0;
  const timers = new Map(); const states = [];
  const module = load("src/lib/owner-live-analytics-poller.ts", { "@/lib/owner-live-analytics": model }, {
    setTimeout: (fn, ms) => { const key = ++id; timers.set(key, { fn, at: clock + ms }); return key; },
    clearTimeout: (key) => timers.delete(key),
  });
  const controller = module.startOwnerAnalyticsPolling({
    onChange: (state) => states.push(clean(state)), isVisible: () => visible, clock: () => clock,
    fetcher: (signal) => {
      calls++;
      const next = responses.shift();
      if (typeof next === "function") return next(signal);
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next ?? Response.json(snapshot()));
    },
    subscribeVisibility: (fn) => { visibility = fn; return () => { visibility = null; unsubscribed++; }; },
    subscribeSignOut: (fn) => { signOut = fn; return () => { signOut = null; unsubscribed++; }; },
  });
  return { controller, states, timers, calls: () => calls, unsubscribed: () => unsubscribed,
    setVisible: (value) => { visible = value; visibility?.(); }, logout: () => signOut?.(),
    async advance(ms) { const end = clock + ms; let steps = 0;
      while (true) {
        const entry = [...timers].filter(([, value]) => value.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        assert.ok(++steps < 100, "unbounded timer loop");
        clock = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await flush();
      } clock = end; await flush();
    },
  };
}
test("polls once initially and every 30 seconds without extra requests", async () => {
  const h = harness(); await flush(); assert.equal(h.calls(), 1);
  await h.advance(29_999); assert.equal(h.calls(), 1);
  await h.advance(1); assert.equal(h.calls(), 2);
  h.controller.stop(); assert.equal(h.timers.size, 0); assert.equal(h.unsubscribed(), 2);
});
test("manual refresh does not overlap in-flight requests", async () => {
  let resolve; const h = harness([() => new Promise((r) => { resolve = r; })]);
  h.controller.refresh(); h.controller.refresh(); assert.equal(h.calls(), 1);
  resolve(Response.json(snapshot())); await flush(); h.controller.stop();
});
test("hidden document pauses polling and visible resumes", async () => {
  const h = harness(); await flush(); h.setVisible(false);
  await h.advance(90_000); assert.equal(h.calls(), 1);
  h.setVisible(true); await flush(); assert.equal(h.calls(), 2); h.controller.stop();
});
for (const status of [401, 403]) {
  test(`${status} clears private snapshot and stops automatic retries`, async () => {
    const h = harness([Response.json(snapshot()), Response.json({}, { status })]); await flush();
    h.controller.refresh(); await flush();
    assert.equal(h.states.at(-1).snapshot, null); assert.equal(h.states.at(-1).forbidden, true);
    await h.advance(90_000); assert.equal(h.calls(), 2); h.controller.stop();
  });
}
test("logout clears data and late response cannot restore it", async () => {
  let resolve; const h = harness([() => new Promise((r) => { resolve = r; })]);
  h.logout(); resolve(Response.json(snapshot())); await flush();
  assert.equal(h.states.at(-1).forbidden, true); assert.equal(h.states.at(-1).snapshot, null);
  assert.equal(h.timers.size, 0); h.controller.stop();
});
test("a request timeout marks failure without logging out", async () => {
  const h = harness([(signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Error("aborted"))))]);
  await h.advance(15_000);
  assert.equal(h.states.at(-1).failed, true); assert.equal(h.states.at(-1).forbidden, false);
  h.controller.stop();
});
test("network failures preserve timestamp but are flagged stale", async () => {
  const h = harness([Response.json(snapshot()), Error("network fixture")]); await flush();
  h.controller.refresh(); await flush();
  assert.equal(h.states.at(-1).failed, true); assert.ok(h.states.at(-1).snapshot);
  h.controller.stop();
});
test("malformed responses fail instead of displaying false zero", async () => {
  const h = harness([Response.json({ ok: true })]); await flush();
  assert.equal(h.states.at(-1).failed, true); assert.equal(h.states.at(-1).snapshot, null); h.controller.stop();
});
test("503 analytics response is parsed without invalidating the owner session", async () => {
  const body = snapshot(); body.presence = unavailable(); body.traffic = unavailable();
  const h = harness([Response.json(body, { status: 503 })]); await flush();
  assert.equal(h.states.at(-1).snapshot.traffic.status, "unavailable");
  assert.equal(h.states.at(-1).forbidden, false); h.controller.stop();
});
test("unmount aborts pending fetch and suppresses subsequent state changes", async () => {
  let resolve, signal; const h = harness([(s) => { signal = s; return new Promise((r) => { resolve = r; }); }]);
  h.controller.stop(); const length = h.states.length;
  resolve(Response.json(snapshot())); await flush();
  assert.equal(signal.aborted, true); assert.equal(h.states.length, length); assert.equal(h.timers.size, 0);
});

// A lightweight JSX fixture verifies visible text. It does not claim a browser run.
const jsx = (type, props) => ({ type, props });
function flatten(value) {
  if (Array.isArray(value)) return value.map(flatten).join(" ");
  if (value && typeof value === "object") return flatten(value.props?.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}
function renderPanel(locale, state, open = true) {
  let i = 0; const values = [open, state, now];
  const component = load("src/components/admin/owner-live-analytics-panel.tsx", {
    react: { useState: () => [values[i++], () => {}], useRef: () => ({ current: null }), useEffect: () => {} },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@/lib/owner-live-analytics": model,
    "@/lib/owner-live-analytics-poller": {},
  });
  return component.OwnerLiveAnalyticsPanel({ locale });
}
for (const locale of ["en", "ar"]) {
  test(`${locale} panel renders formatted counts, reporting timezone and no financial controls`, () => {
    const text = flatten(renderPanel(locale, { ...model.initialLiveAnalyticsState(), snapshot: snapshot() }));
    assert.match(text, /5,000/); assert.match(text, /Asia\/Jerusalem/);
    assert.match(text, locale === "en" ? /Recorded traffic today/ : /الزيارات المسجلة اليوم/);
  });
}
test("panel distinguishes unavailable from zero and clears unauthorized data", () => {
  const body = snapshot(); body.traffic = unavailable();
  const text = flatten(renderPanel("en", { ...model.initialLiveAnalyticsState(), snapshot: body }));
  assert.match(text, /Unavailable/); assert.doesNotMatch(text, /5,000/);
  const denied = flatten(renderPanel("en", { ...model.initialLiveAnalyticsState(), snapshot: snapshot(), forbidden: true }));
  assert.doesNotMatch(denied, /5,000/); assert.match(denied, /Owner access is required/);
});
test("closed panel does not render private metric data", () => {
  const text = flatten(renderPanel("en", { ...model.initialLiveAnalyticsState(), snapshot: snapshot() }, false));
  assert.doesNotMatch(text, /5,000/); assert.match(text, /Open/);
});
test("owner page preserves original guards and destination code byte-for-byte", () => {
  let page = read("src/app/[locale]/admin/alpha-exchange/page.tsx");
  page = page.replace('import { OwnerLiveAnalyticsPanel } from "@/components/admin/owner-live-analytics-panel";\n', "");
  page = page.replace(/  return <>\n    \{hasRole\(user, "owner"\) \? <OwnerLiveAnalyticsPanel[^\n]+\n    (<AlphaExchangeAdminDashboard[^\n]+)\n  <\/>;/,
    (_, original) => `  return ${original};`);
  const bytes = Buffer.from(page); const sha = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  assert.equal(sha, "7be5ff1e1b06bc66a5c16aa5c7eec0019a867ccd");
});
