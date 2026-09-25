/* Run with: node scripts/check-traffic-analytics.mjs
 * Focused offline regression checks; not a full browser/device or database test.
 * Uses the repository's existing TypeScript dependency; no network or secrets.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function compile(relative) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, "utf8");
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.ES2020, true);
  assert.equal(parsed.parseDiagnostics.length, 0, `${relative}: parse error`);
  const result = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal((result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  return result.outputText;
}
const loaded = { exports: {} };
vm.runInNewContext(compile("src/lib/traffic-analytics-client.ts"), {
  module: loaded, exports: loaded.exports, URL, Uint8Array, Promise,
});
const { buildTrafficPageView, createTrafficRecorder } = loaded.exports;
const VISITOR = "alpha_analytics_visitor";
const SESSION = "alpha_analytics_session";
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function browser(ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", native = false) {
  let sequence = 0;
  return {
    localStorage: storage(), sessionStorage: storage(),
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` },
    navigator: { userAgent: ua, platform: "Win32", maxTouchPoints: 0, doNotTrack: null },
    location: { origin: "https://www.alphatraders.co.il" },
    ...(native ? { ReactNativeWebView: { postMessage() { return undefined; } } } : {}),
  };
}
function view(b, pathname = "/en/start", referrer = "") {
  return buildTrafficPageView(pathname, b, { referrer });
}

test("desktop website is web/desktop", () => {
  const result = view(browser());
  assert.equal(result.platform, "web"); assert.equal(result.deviceType, "desktop");
});
for (const [name, ua] of [["iPhone Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari"], ["Android Chrome", "Mozilla/5.0 (Linux; Android 15) Chrome Mobile"]]) {
  test(`${name} is a mobile website visit, not an installed app`, () => {
    const result = view(browser(ua));
    assert.equal(result.platform, "web"); assert.equal(result.deviceType, "mobile");
  });
}
for (const [platform, ua] of [["ios", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile"], ["android", "Mozilla/5.0 (Linux; Android 15; wv) Mobile"]]) {
  test(`${platform} WebView uses its native platform`, () => {
    const result = view(browser(ua, true));
    assert.equal(result.platform, platform); assert.equal(result.deviceType, "mobile");
  });
}
test("iPad desktop user-agent is handled without classifying Macs as iOS", () => {
  const b = browser("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit", true);
  b.navigator.platform = "MacIntel"; b.navigator.maxTouchPoints = 5;
  assert.equal(view(b).platform, "ios");
  b.navigator.maxTouchPoints = 0;
  assert.equal(view(b), null);
});
test("unknown native platform is not guessed", () => assert.equal(view(browser("Unknown OS", true)), null));
test("tablet website traffic remains web/mobile", () => {
  const b = browser("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
  b.navigator.platform = "MacIntel"; b.navigator.maxTouchPoints = 5;
  assert.equal(view(b).platform, "web"); assert.equal(view(b).deviceType, "mobile");
});
for (const kind of ["localStorage", "sessionStorage"]) {
  test(`${kind} getter failure cannot crash the page`, () => {
    const b = browser(); Object.defineProperty(b, kind, { get() { throw Error("SecurityError"); } });
    assert.equal(view(b), null);
  });
  for (const operation of ["getItem", "setItem"]) {
    test(`${kind}.${operation} failure skips analytics safely`, () => {
      const b = browser(); b[kind][operation] = () => { throw Error("blocked"); };
      assert.equal(view(b), null);
    });
  }
}
test("visitor and session identifiers persist across navigation", () => {
  const b = browser(); const a = view(b); const next = view(b, "/en/learn-trading-free");
  assert.equal(a.visitorId, next.visitorId); assert.equal(a.sessionId, next.sessionId);
});
test("existing valid identifiers are preserved", () => {
  const b = browser(); b.localStorage.setItem(VISITOR, "existing-visitor-12345"); b.sessionStorage.setItem(SESSION, "existing-session-12345");
  assert.equal(view(b).visitorId, "existing-visitor-12345"); assert.equal(view(b).sessionId, "existing-session-12345");
});
test("malformed stored identifiers are repaired", () => {
  const b = browser(); b.localStorage.setItem(VISITOR, "bad"); b.sessionStorage.setItem(SESSION, "x".repeat(101));
  const result = view(b); assert.match(result.visitorId, /^[\w-]{16,100}$/); assert.match(result.sessionId, /^[\w-]{16,100}$/);
});
test("secure random fallback works without randomUUID", () => {
  const b = browser(); b.crypto = { getRandomValues: (bytes) => bytes.fill(42) };
  assert.equal(view(b).visitorId, "2a".repeat(16));
});
test("missing crypto skips collection instead of using insecure identifiers", () => {
  const b = browser(); b.crypto = {}; assert.equal(view(b), null);
});
for (const preference of ["navigatorDnt", "windowDnt", "gpc"]) {
  test(`${preference} skips collection before accessing storage`, () => {
    const b = browser(); let reads = 0;
    if (preference === "navigatorDnt") b.navigator.doNotTrack = "1";
    if (preference === "windowDnt") { b.doNotTrack = "1"; b.navigator.doNotTrack = "unspecified"; }
    if (preference === "gpc") b.navigator.globalPrivacyControl = true;
    Object.defineProperty(b, "localStorage", { get() { reads++; throw Error("must not read"); } });
    assert.equal(view(b), null); assert.equal(reads, 0);
  });
}
test("query strings and fragments are not collected", () => assert.equal(view(browser(), "/en/login?token=secret#email=private").path, "/en/login"));
test("invalid, protocol-relative, overlong and control-character paths are rejected", () => {
  for (const value of ["", "https://evil.test", "//evil.test", "/" + "x".repeat(240), "/en/\u0000start"]) assert.equal(view(browser(), value), null);
});
test("external referrer retains only the hostname", () => assert.equal(view(browser(), "/en/start", "https://example.com/private?token=secret#id").referrerHost, "example.com"));
test("apex and www internal referrals are not external sources", () => {
  for (const value of ["https://alphatraders.co.il/en", "https://www.alphatraders.co.il/ar"]) assert.equal(view(browser(), "/en/start", value).referrerHost, null);
});
test("malformed and non-HTTP referrers are ignored", () => {
  for (const value of ["not a url", "javascript:alert(1)", "data:text/plain,secret"]) assert.equal(view(browser(), "/en/start", value).referrerHost, null);
});
test("repeated effects count once, while A to B to A counts three page views", () => {
  const sent = []; const record = createTrafficRecorder((event) => { sent.push(event.path); }); const b = browser();
  assert.equal(record(view(b)), true); assert.equal(record(view(b)), false);
  assert.equal(record(view(b, "/ar/start")), true); assert.equal(record(view(b)), true);
  assert.deepEqual(sent, ["/en/start", "/ar/start", "/en/start"]);
});
test("rejected network requests do not become unhandled rejections or automatic retries", async () => {
  let calls = 0; const record = createTrafficRecorder(() => { calls++; return Promise.reject(Error("offline")); }); const event = view(browser());
  assert.equal(record(event), true); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(record(event), false); assert.equal(calls, 1);
});
test("synchronous send failure is isolated and does not record a sent view", () => {
  let calls = 0; const record = createTrafficRecorder(() => { calls++; throw Error("fetch blocked"); }); const event = view(browser());
  assert.equal(record(event), false); assert.equal(record(event), false); assert.equal(calls, 2);
});
test("the React collector parses and imports the checked helper", () => {
  compile("src/components/analytics/traffic-analytics-tracker.tsx");
  const source = fs.readFileSync(path.join(root, "src/components/analytics/traffic-analytics-tracker.tsx"), "utf8");
  assert.match(source, /useRef/); assert.match(source, /buildTrafficPageView\(pathname, window, document\)/);
});

function storeWithPool(db) {
  const sandboxModule = { exports: {} };
  vm.runInNewContext(compile("src/lib/traffic-analytics-store.ts"), {
    module: sandboxModule, exports: sandboxModule.exports,
    require(name) {
      if (name === "server-only") return {};
      if (name === "crypto") return crypto;
      if (name === "@/lib/postgres-runtime") return { getRuntimePostgresPool: () => db };
      throw Error(`Unexpected dependency: ${name}`);
    },
  });
  return sandboxModule.exports;
}
const storedEvent = { visitorKey: "hashed-visitor", sessionKey: "hashed-session", eventName: "page_view", path: "/en/start", platform: "web", deviceType: "desktop" };
test("a missing database cannot report successful persistence", async () => {
  assert.equal(await storeWithPool(null).recordTrafficEvent(storedEvent), false);
});
test("only an inserted row returns success, with parameterized data", async () => {
  const calls = []; const db = { async query(sql, values) { calls.push({ sql, values }); return { rowCount: 1, rows: [] }; } };
  const store = storeWithPool(db);
  assert.equal(await store.recordTrafficEvent(storedEvent), true);
  assert.equal(calls.length, 2); assert.match(calls[1].sql, /values \(\$1,\$2,\$3/);
  assert.equal(calls[1].values[1], "hashed-visitor"); assert.equal(calls[1].values[6], "web");
  assert.equal(await store.recordTrafficEvent({ ...storedEvent, platform: "ios" }), true);
  assert.equal(calls.length, 3); assert.equal(calls[2].values[6], "ios");
});
test("a zero-row insert is not reported as saved", async () => {
  const db = { async query() { return { rowCount: 0, rows: [] }; } };
  assert.equal(await storeWithPool(db).recordTrafficEvent(storedEvent), false);
});
test("insert errors are not swallowed as success by the store", async () => {
  const db = { async query(sql) { if (sql.startsWith("insert")) throw Error("database down"); return { rowCount: 0, rows: [] }; } };
  await assert.rejects(storeWithPool(db).recordTrafficEvent(storedEvent), /database down/);
});
test("schema initialization failure permits a later recovery", async () => {
  let calls = 0; const db = { async query() { if (++calls === 1) throw Error("initialization down"); return { rowCount: 1, rows: [] }; } };
  const store = storeWithPool(db);
  await assert.rejects(store.recordTrafficEvent(storedEvent), /initialization down/);
  assert.equal(await store.recordTrafficEvent(storedEvent), true); assert.equal(calls, 3);
});
test("the endpoint parses and guards success on the insert result", () => {
  compile("src/app/api/analytics/event/route.ts");
  const source = fs.readFileSync(path.join(root, "src/app/api/analytics/event/route.ts"), "utf8");
  assert.match(source, /if \(!recorded\) return unavailable\(\)/);
  assert.match(source, /status: 503/);
  assert.doesNotMatch(source, /identifier:\s*analyticsKey\(parsed\.data\.visitorId\)/);
});
