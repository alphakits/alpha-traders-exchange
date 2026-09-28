/* Source-boundary regression checks for the analytics consolidation.
 * The adjacent live-panel/reporting suites exercise actual modules with fixtures.
 * None of these checks contact production or replace full device acceptance.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => fs.readFileSync(root + path, "utf8");

test("owner-only live panel remains mounted once above marketplace controls", () => {
  const page = read("src/app/[locale]/admin/alpha-exchange/page.tsx");
  assert.equal((page.match(/<OwnerLiveAnalyticsPanel\b/g) ?? []).length, 1);
  assert.match(page, /hasRole\(user, "owner"\) \? <OwnerLiveAnalyticsPanel/);
  assert.ok(page.indexOf("<OwnerLiveAnalyticsPanel") < page.indexOf("<AlphaExchangeAdminDashboard"));
});

test("legacy dashboard cannot render duplicate or false-zero user traffic counters", () => {
  const dashboard = read("src/components/admin/alpha-exchange-admin-dashboard.tsx");
  assert.doesNotMatch(dashboard, /presenceAnalytics|trafficAnalytics/);
});

test("marketplace snapshot metrics and management controls remain present", () => {
  const dashboard = read("src/components/admin/alpha-exchange-admin-dashboard.tsx");
  for (const text of ["Active Trades", "Completed Trades", "Open Listings", "Revenue Today (est.)", "TradeOwnerActions", "commissionRecords", "purchaseRequests"]) {
    assert.ok(dashboard.includes(text), text);
  }
});

test("marketplace dashboard loader no longer depends on optional analytics reads", () => {
  const store = read("src/lib/alpha-exchange-store.ts");
  assert.doesNotMatch(store, /readOwnerPresenceAnalytics|readOwnerTrafficAnalytics|presenceAnalytics|trafficAnalytics/);
  assert.match(store, /export async function getAdminPrepDashboardData/);
  assert.match(store, /getOwnerBusinessDashboardMetrics|getOwnerBusinessDashboardData|ownerBusiness/);
});

test("independent live endpoint keeps source isolation and owner access", () => {
  const store = read("src/lib/owner-live-analytics-store.ts");
  assert.match(store, /readOwnerPresenceAnalytics/);
  assert.match(store, /capture\(readOwnerTrafficAnalytics\)/);
  assert.match(store, /status: "unavailable", asOf: null, data: null/);
  const route = read("src/app/api/admin/live-analytics/route.ts");
  assert.match(route, /await requireApiOwner\(\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /noindex, nofollow/);
});

test("traffic collection remains mounted and durable acknowledgement is retained", () => {
  const layout = read("src/app/[locale]/layout.tsx");
  assert.equal((layout.match(/<TrafficAnalyticsTracker\s*\/>/g) ?? []).length, 1);
  const store = read("src/lib/traffic-analytics-store.ts");
  assert.match(store, /return result\.rowCount === 1/);
});

test("Israel reporting and valid-session presence predicates remain in live data sources", () => {
  assert.match(read("src/lib/owner-analytics-reporting.ts"), /OWNER_ANALYTICS_TIME_ZONE = "Asia\/Jerusalem"/);
  const presence = read("src/lib/user-presence-store.ts");
  assert.match(presence, /readOwnerPresenceAnalytics/);
  assert.match(presence, /s\.token_hash = p\.session_key and s\.user_id = p\.user_id and s\.expires_at > now\(\)/);
});

test("production build must execute focused analytics checks before compiling", () => {
  const { scripts } = JSON.parse(read("package.json"));
  assert.match(scripts.build, /npm run test:owner-analytics && node scripts\/build-production\.mjs/);
  for (const script of ["check-owner-live-analytics.mjs", "check-owner-analytics-reporting.mjs", "check-owner-analytics-finalization.mjs"]) {
    assert.ok(scripts["test:owner-analytics"].includes(script), script);
  }
});
