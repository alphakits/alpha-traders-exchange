// @vitest-environment node
import { createHash } from "crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const state = vi.hoisted(() => ({ pool: null as unknown, browser: vi.fn(), native: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
vi.mock("@/lib/alpha-exchange-store", () => ({ invalidateAlphaExchangeStoreCache: state.invalidate }));
vi.mock("@/lib/browser-push", () => ({ deliverBrowserPushNotification: state.browser, browserDeliveryKey: (notice: AlphaExchangeNotification) => `${notice.id}:${notice.updatedAt}` }));
vi.mock("@/lib/mobile-push", () => ({ deliverMobilePushNotification: state.native, mobilePushDeliveryKey: (notice: AlphaExchangeNotification) => `${notice.id}:revision` }));
import { sendNotificationPushTest } from "./notification-push-test";

let db: PGlite;
let committed: boolean;
let released: boolean;
let failCommit: boolean;
let sqlCalls: string[];
const input = { userId: "self", sessionToken: "self-session", locale: "en" as const };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema alpha_exchange;
    create table alpha_exchange.users(id text primary key, payload jsonb not null);
    create table alpha_exchange.sessions(token_hash text primary key, user_id text, expires_at timestamptz);
    create table alpha_exchange.notifications(id text primary key, user_id text, category text, is_read boolean, created_at timestamptz, sort_index integer, payload jsonb);
    create table alpha_exchange.runtime_meta(singleton boolean primary key, version bigint, updated_at timestamptz);
    create table alpha_exchange.mobile_push_subscriptions(id text primary key, user_id text);
    create table alpha_exchange.mobile_push_deliveries(notification_id text, subscription_id text, status text);
    create table alpha_exchange.browser_push_subscriptions(endpoint_hash text primary key, user_id text);
    create table alpha_exchange.browser_push_deliveries(delivery_key text, endpoint_hash text, status text);`);
}, 60_000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  vi.clearAllMocks(); committed = false; released = false; failCommit = false; sqlCalls = [];
  await db.exec(`truncate alpha_exchange.users, alpha_exchange.sessions, alpha_exchange.notifications, alpha_exchange.runtime_meta, alpha_exchange.mobile_push_subscriptions, alpha_exchange.mobile_push_deliveries, alpha_exchange.browser_push_subscriptions, alpha_exchange.browser_push_deliveries;
    insert into alpha_exchange.users values ('self','{"notificationPreferences":{"inApp":true},"role":"buyer","balance":99}'),('other','{"role":"seller"}');
    insert into alpha_exchange.runtime_meta values(true,7,now());
    insert into alpha_exchange.notifications values('existing-other','other','trade',false,now(),0,'{"id":"existing-other","userId":"other"}');
    insert into alpha_exchange.mobile_push_subscriptions values('own-device','self'),('other-device','other');
    insert into alpha_exchange.browser_push_subscriptions values('own-browser','self'),('other-browser','other');`);
  await db.query("insert into alpha_exchange.sessions values ($1,'self',now()+interval '1 hour')", [createHash("sha256").update(input.sessionToken).digest("hex")]);
  async function query(sql: string, args?: unknown[]) {
    sqlCalls.push(sql);
    // PGlite has no advisory locks. Check the real snapshot lock below; all
    // persistence, recipient selection and rollback SQL execute against PG.
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
    if (sql === "commit" && failCommit) throw new Error("commit rejected");
    const result = await db.query(sql, args);
    if (sql === "commit") committed = true;
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  }
  state.pool = { query, connect: async () => ({ query, release: () => { released = true; } }) };
  state.browser.mockImplementation(async () => {
    expect(committed && released).toBe(true);
    return { sent: 1 };
  });
  state.native.mockImplementation(async () => { expect(committed && released).toBe(true); });
});

async function testRows() {
  return (await db.query<{ payload: AlphaExchangeNotification }>("select payload from alpha_exchange.notifications where id like 'push-test:%'")).rows;
}

describe("isolated canonical device test alerts", () => {
  it("persists fixed private bilingual copy before targeted sends and leaves other user data intact", async () => {
    const result = await sendNotificationPushTest({ ...input, locale: "ar" });
    expect(result).toEqual({ notificationId: expect.stringMatching(/^push-test:/), status: "accepted", accepted: { browser: 1, native: 0 } });
    const rows = await testRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      id: result.notificationId, userId: "self", category: "system", centerCategory: "system",
      title: "Test notification", titleEn: "Test notification", titleAr: "إشعار تجريبي",
      message: "This is a test alert. Open Alpha Traders to confirm notifications are working.",
      messageAr: "هذا تنبيه تجريبي. افتح Alpha Traders للتأكد من عمل الإشعارات.",
      actionHref: "/ar/notifications", reason: "push_test", isRead: false, state: "unread",
    });
    expect(rows[0].payload).not.toHaveProperty("relatedTradeId");
    expect(rows[0].payload).not.toHaveProperty("relatedRequestId");
    expect(rows[0].payload).not.toHaveProperty("reviewEligible");
    expect(state.browser).toHaveBeenCalledExactlyOnceWith({ userId: "self", notificationId: result.notificationId });
    expect(state.native).toHaveBeenCalledExactlyOnceWith(rows[0].payload, { reconcileReceipts: false, providerMaxAttempts: 1 });
    expect(state.invalidate).toHaveBeenCalledOnce();
    expect(sqlCalls.indexOf("select pg_advisory_xact_lock(61422917)")).toBeLessThan(sqlCalls.findIndex(sql => sql.includes("insert into alpha_exchange.notifications")));
    expect((await db.query<{version: number}>("select version from alpha_exchange.runtime_meta")).rows[0].version).toBe(8);
    expect((await db.query("select payload from alpha_exchange.notifications where id='existing-other'")).rows).toEqual([{ payload: { id: "existing-other", userId: "other" } }]);
    expect((await db.query("select payload from alpha_exchange.users where id='self'")).rows).toEqual([{ payload: { notificationPreferences: { inApp: true }, role: "buyer", balance: 99 } }]);
  });

  it.each(["expired", "deleted", "other-account", "disabled"])("rechecks a %s session before any notice or provider call", async scenario => {
    if (scenario === "expired") await db.exec("update alpha_exchange.sessions set expires_at=now()-interval '1 minute'");
    if (scenario === "deleted") await db.exec("delete from alpha_exchange.sessions");
    if (scenario === "other-account") await db.exec("update alpha_exchange.sessions set user_id='other'");
    if (scenario === "disabled") await db.exec("update alpha_exchange.users set payload=payload || '{\"disabled\":true}' where id='self'");
    await expect(sendNotificationPushTest(input)).rejects.toMatchObject({ code: "session_ended" });
    expect(await testRows()).toHaveLength(0);
    expect(state.browser).not.toHaveBeenCalled(); expect(state.native).not.toHaveBeenCalled();
    expect(released).toBe(true);
  });

  it("does not override an account's disabled alerts", async () => {
    await db.exec("update alpha_exchange.users set payload=jsonb_set(payload,'{notificationPreferences,inApp}','false') where id='self'");
    await expect(sendNotificationPushTest(input)).rejects.toMatchObject({ code: "alerts_disabled" });
    expect(await testRows()).toHaveLength(0);
    expect(state.browser).not.toHaveBeenCalled(); expect(state.native).not.toHaveBeenCalled();
    expect((await db.query<{enabled:boolean}>("select (payload->'notificationPreferences'->>'inApp')::boolean as enabled from alpha_exchange.users where id='self'")).rows[0].enabled).toBe(false);
  });

  it.each(["missing-runtime-version", "commit-error"])("rolls back a %s without delivering an uncommitted notice", async scenario => {
    if (scenario === "missing-runtime-version") await db.exec("delete from alpha_exchange.runtime_meta");
    else failCommit = true;
    await expect(sendNotificationPushTest(input)).rejects.toBeInstanceOf(Error);
    expect(await testRows()).toHaveLength(0);
    expect(state.browser).not.toHaveBeenCalled(); expect(state.native).not.toHaveBeenCalled();
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(sqlCalls).toContain("rollback"); expect(released).toBe(true);
  });

  it("keeps the canonical notice and reports saved when providers reject", async () => {
    state.browser.mockRejectedValue(new Error("private browser failure"));
    state.native.mockRejectedValue(new Error("private native failure"));
    const result = await sendNotificationPushTest(input);
    expect(result.status).toBe("saved");
    expect(result.accepted).toEqual({ browser: 0, native: 0 });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(await testRows()).toHaveLength(1);
  });

  it("counts native provider acceptance for only this notice and this account, without receipt reconciliation", async () => {
    state.browser.mockResolvedValue({ sent: 0 });
    state.native.mockImplementation(async (notice: AlphaExchangeNotification, options: unknown) => {
      expect(options).toEqual({ reconcileReceipts: false, providerMaxAttempts: 1 });
      await db.query(`insert into alpha_exchange.mobile_push_deliveries values
        ($1,'own-device','sent'),($1,'other-device','sent'),($1,'own-device','failed'),('different-notice','own-device','delivered')`, [`${notice.id}:revision`]);
    });
    const result = await sendNotificationPushTest(input);
    expect(result.status).toBe("accepted");
    expect(result.accepted).toEqual({ browser: 0, native: 1 });
    expect(Object.keys(result).sort()).toEqual(["accepted", "notificationId", "status"]);
  });

  it("reports an exact browser receipt accepted by a concurrent sender, excluding other accounts, revisions and notices", async () => {
    state.browser.mockImplementation(async ({ notificationId }: { notificationId: string }) => {
      const notice = (await testRows())[0].payload;
      await db.query(`insert into alpha_exchange.browser_push_deliveries values
        ($1,'own-browser','sent'),($1,'other-browser','sent'),($1,'own-browser','failed'),
        ($2,'own-browser','sent'),('another-notice','own-browser','sent')`,
      [`${notificationId}:${notice.updatedAt}`, `${notificationId}:old-revision`]);
      // The competing recovery worker already sent it, so this sender did not.
      return { sent: 0 };
    });
    const result = await sendNotificationPushTest(input);
    expect(result.status).toBe("accepted");
    expect(result.accepted).toEqual({ browser: 1, native: 0 });
  });

  it("fails closed without canonical storage or session identity", async () => {
    state.pool = null;
    await expect(sendNotificationPushTest(input)).rejects.toMatchObject({ code: "storage_unavailable" });
    await expect(sendNotificationPushTest({ ...input, sessionToken: " " })).rejects.toMatchObject({ code: "session_ended" });
    expect(state.browser).not.toHaveBeenCalled(); expect(state.native).not.toHaveBeenCalled();
  });
});
