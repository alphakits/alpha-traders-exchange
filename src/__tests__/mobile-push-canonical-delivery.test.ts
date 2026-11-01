// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
import { deliverMobilePushNotification, mobilePushDeliveryKey, registerMobilePushSubscription, runMobilePushDeliverySweep } from "@/lib/mobile-push";

describe("canonical push delivery under publication bursts", () => {
  let db: PGlite;
  let receiptGate: Promise<void> | undefined;
  let receiptFailure: Error | undefined;
  let afterClaim: (() => Promise<void>) | undefined;
  let clock = 0;
  const queries: string[] = [];
  const notification: AlphaExchangeNotification = { id: "notice", userId: "buyer", category: "trade",
    title: "Trade completed", message: "PRIVATE_BANK_DETAIL", isRead: false,
    relatedRequestId: "trade", createdAt: "2026-10-17T00:00:00.000Z" };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create schema alpha_exchange;
      create table alpha_exchange.notifications (id text primary key, user_id text, is_read boolean, payload jsonb,
        category text default 'trade', created_at timestamptz default now());
      create table alpha_exchange.users (id text primary key, payload jsonb);
      create table alpha_exchange.sessions (token_hash text primary key, user_id text, expires_at timestamptz);`);
    const query = async (sql: string, args?: unknown[]) => {
      queries.push(sql);
      if (/select notification_id, subscription_id, ticket_id/.test(sql)) {
        if (receiptGate) await receiptGate;
        if (receiptFailure) {
          const error = receiptFailure;
          receiptFailure = undefined;
          throw error;
        }
      }
      const result = await db.query(sql, args);
      if (sql.includes("insert into alpha_exchange.mobile_push_deliveries") && afterClaim) {
        const action = afterClaim; afterClaim = undefined; await action();
      }
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    };
    state.pool = { query, connect: async () => ({ query, release: () => undefined }) };
    // Warm-up writes the receipt cache timestamp too. Keep it on the same
    // monotonic clock as each case instead of switching backwards afterward.
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    await deliverMobilePushNotification(notification);
  });
  afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.close(); });
  beforeEach(async () => {
    clock += 2_000;
    receiptGate = undefined;
    receiptFailure = undefined;
    afterClaim = undefined;
    await db.exec(`delete from alpha_exchange.mobile_push_deliveries; delete from alpha_exchange.mobile_push_subscriptions;
      delete from alpha_exchange.sessions; delete from alpha_exchange.notifications; delete from alpha_exchange.users;
      insert into alpha_exchange.users values ('buyer','{}'), ('other','{}');`);
    notification.createdAt = new Date(Date.now() - 60_000).toISOString();
    await db.query("insert into alpha_exchange.notifications (id,user_id,is_read,payload) values ($1,$2,false,$3)", [notification.id, notification.userId, JSON.stringify(notification)]);
    queries.length = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ status: "ok", id: "synthetic-ticket" }] })));
  });
  async function subscribe(id: string, expires = "1 hour", active = true, userId = "buyer") {
    await db.query("insert into alpha_exchange.sessions values ($1,$2,now()+$3::interval)", [id, userId, expires]);
    await db.query(`insert into alpha_exchange.mobile_push_subscriptions
      (id,user_id,session_token_hash,installation_id_hash,expo_push_token,platform,locale,app_version,active,created_at)
      values ($1,$2,$1,$1,$3,'ios','en','test',$4,now()-interval '1 hour')`, [id, userId, `ExpoPushToken[${id}abcdefghijk]`, active]);
  }
  const registration = {
    userId: "buyer", sessionToken: "mock-current-session-token", installationId: "test-device-installation-1",
    expoPushToken: "ExpoPushToken[abcdefghijklmno]", platform: "ios" as const, locale: "en" as const, appVersion: "1.0.0",
  };
  const sessionHash = (token: string) => createHash("sha256").update(token).digest("hex");
  async function registerSession(userId: string, token: string, expires = "1 hour") {
    await db.query("insert into alpha_exchange.sessions values($1,$2,now()+$3::interval)", [sessionHash(token), userId, expires]);
  }

  it("registers and refreshes a device only for its live canonical session", async () => {
    await expect(registerMobilePushSubscription(registration)).rejects.toThrow("Authenticated session is no longer active.");
    await registerSession("buyer", registration.sessionToken);
    const first = await registerMobilePushSubscription(registration);
    const refreshed = await registerMobilePushSubscription({ ...registration, locale: "ar", expoPushToken: "ExpoPushToken[rotatedabcdefgh]" });
    expect(refreshed.id).toBe(first.id);
    expect((await db.query("select user_id,locale,active,expo_push_token from alpha_exchange.mobile_push_subscriptions")).rows)
      .toEqual([{ user_id: "buyer", locale: "ar", active: true, expo_push_token: "ExpoPushToken[rotatedabcdefgh]" }]);
  });

  it("moves a shared physical token to the current account without retaining the previous delivery ownership", async () => {
    await registerSession("buyer", registration.sessionToken);
    const first = await registerMobilePushSubscription(registration);
    await db.query("insert into alpha_exchange.mobile_push_deliveries(notification_id,subscription_id,status) values('old',$1,'sent')", [first.id]);
    await registerSession("other", "mock-other-session");
    await registerMobilePushSubscription({ ...registration, userId: "other", sessionToken: "mock-other-session" });
    expect((await db.query("select user_id from alpha_exchange.mobile_push_subscriptions")).rows).toEqual([{ user_id: "other" }]);
    expect((await db.query("select * from alpha_exchange.mobile_push_deliveries")).rows).toEqual([]);
    await deliverMobilePushNotification(notification);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["expired", "wrong-account"])("rejects %s registration without changing the existing device owner", async scenario => {
    await registerSession("buyer", registration.sessionToken);
    await registerMobilePushSubscription(registration);
    await registerSession(scenario === "expired" ? "other" : "buyer", "mock-invalid-session", scenario === "expired" ? "-1 hour" : "1 hour");
    await expect(registerMobilePushSubscription({ ...registration, userId: "other", sessionToken: "mock-invalid-session" }))
      .rejects.toThrow("Authenticated session is no longer active.");
    expect((await db.query("select user_id from alpha_exchange.mobile_push_subscriptions")).rows).toEqual([{ user_id: "buyer" }]);
  });
  it("uses the persisted notification, unread badge and eligible session without leaking private copy", async () => {
    await subscribe("valid"); await subscribe("expired", "-1 hour"); await subscribe("disabled", "1 hour", false); await subscribe("other", "1 hour", true, "other");
    await db.query("insert into alpha_exchange.notifications (id,user_id,is_read,payload) values ('second','buyer',false,$1)", [JSON.stringify({ ...notification, id: "second" })]);
    await deliverMobilePushNotification({ ...notification, title: "Forged input title", relatedRequestId: "forged" });
    expect(fetch).toHaveBeenCalledTimes(1);
    const messages = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ to: "ExpoPushToken[validabcdefghijk]", badge: 2 });
    expect(messages[0].data.url).toContain("/trade-room/trade");
    expect(JSON.stringify(messages)).not.toMatch(/PRIVATE_BANK_DETAIL|Forged input title|forged/);
    await deliverMobilePushNotification(notification);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-account, read and archived notifications", async () => {
    await subscribe("valid");
    await deliverMobilePushNotification({ ...notification, userId: "other" });
    for (const value of [{ isRead: true }, { state: "archived" }, { state: "read" }]) {
      await db.query("update alpha_exchange.notifications set payload=$1", [JSON.stringify({ ...notification, ...value })]);
      await deliverMobilePushNotification(notification);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shares an empty receipt result across overlapping and sequential publications for one second", async () => {
    let release!: () => void;
    receiptGate = new Promise<void>(resolve => { release = resolve; });
    const burst = Promise.all(Array.from({ length: 20 }, () => deliverMobilePushNotification(notification)));
    await vi.waitFor(() => expect(queries.filter(q => q.includes("from alpha_exchange.notifications notification"))).toHaveLength(20));
    await vi.waitFor(() => expect(queries.filter(q => q.includes("select notification_id, subscription_id, ticket_id"))).toHaveLength(1));
    release(); await burst; receiptGate = undefined;
    expect(queries.filter(q => /^\s*select /i.test(q))).toHaveLength(21);
    expect(fetch).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) await deliverMobilePushNotification(notification);
    clock += 999;
    await deliverMobilePushNotification(notification);
    expect(queries.filter(q => q.includes("select notification_id, subscription_id, ticket_id"))).toHaveLength(1);
    clock += 1;
    await deliverMobilePushNotification(notification);
    expect(queries.filter(q => q.includes("select notification_id, subscription_id, ticket_id"))).toHaveLength(2);
  });
  it("retries receipt recovery after a failed shared scan", async () => {
    receiptFailure = new Error("synthetic database interruption");
    await expect(deliverMobilePushNotification(notification)).rejects.toThrow("synthetic database interruption");
    await expect(deliverMobilePushNotification(notification)).resolves.toBeUndefined();
    expect(queries.filter(q => q.includes("select notification_id, subscription_id, ticket_id"))).toHaveLength(2);
  });

  it("recovers newly eligible receipts and backs off missing receipts so newer tickets are not starved", async () => {
    await deliverMobilePushNotification(notification);
    await subscribe("receipt-only", "1 hour", false);
    await db.exec(`insert into alpha_exchange.mobile_push_deliveries
      (notification_id,subscription_id,status,ticket_id,updated_at)
      values ('old-notice','receipt-only','sent','old-ticket',now()-interval '16 minutes')`);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: {} }));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: { "old-ticket": { status: "ok" } } }));
    clock += 999;
    await deliverMobilePushNotification(notification);
    expect(fetch).not.toHaveBeenCalled();
    clock += 1;
    await deliverMobilePushNotification(notification);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await db.query("select status from alpha_exchange.mobile_push_deliveries")).rows).toEqual([{ status: "sent" }]);
    await deliverMobilePushNotification(notification);
    expect(fetch).toHaveBeenCalledTimes(1);
    await db.exec("update alpha_exchange.mobile_push_deliveries set receipt_checked_at=now()-interval '7 hours'");
    clock += 2_000;
    await deliverMobilePushNotification(notification);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await db.query("select status from alpha_exchange.mobile_push_deliveries")).rows).toEqual([{ status: "delivered" }]);
  });
  it("recovers a committed notification with no publication exactly once across concurrent sweeps", async () => {
    await subscribe("valid");
    const sweeps = await Promise.all([runMobilePushDeliverySweep(), runMobilePushDeliverySweep()]);
    expect(sweeps).toEqual([{ processed: 1, failed: 0 }, { processed: 1, failed: 0 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await runMobilePushDeliverySweep()).toEqual({ processed: 0, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("recovers a transient provider failure on a later sweep without requiring another publication", async () => {
    await subscribe("valid");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await runMobilePushDeliverySweep();
    expect((await db.query("select status,attempt_count from alpha_exchange.mobile_push_deliveries")).rows)
      .toEqual([{ status: "failed", attempt_count: 1 }]);
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(1);
    await db.exec("update alpha_exchange.mobile_push_deliveries set updated_at=now()-interval '31 seconds'");
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await db.query("select status,attempt_count from alpha_exchange.mobile_push_deliveries")).rows)
      .toEqual([{ status: "sent", attempt_count: 2 }]);
  });

  it("reclaims stale processing claims but stops after three delivery attempts", async () => {
    await subscribe("valid");
    await db.query(`insert into alpha_exchange.mobile_push_deliveries
      (notification_id,subscription_id,status,attempt_count,updated_at)
      values ($1,'valid','processing',1,now()-interval '31 seconds')`, [mobilePushDeliveryKey(notification)]);
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(1);
    await db.exec("update alpha_exchange.mobile_push_deliveries set status='failed',attempt_count=3,updated_at=now()-interval '31 seconds'");
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("recovers a new revision of an old chat row, not a revision from before device registration", async () => {
    await subscribe("valid");
    const revised = { ...notification, title: "New trade room message", updatedAt: new Date().toISOString() };
    await db.query("update alpha_exchange.notifications set created_at=now()-interval '3 days',payload=$1", [JSON.stringify(revised)]);
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(1);
    await db.exec("delete from alpha_exchange.mobile_push_deliveries; update alpha_exchange.mobile_push_subscriptions set created_at=now()+interval '1 minute'");
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not fan recovered history out to newer devices when another device is eligible", async () => {
    await subscribe("older");
    await subscribe("newer");
    await db.exec("update alpha_exchange.mobile_push_subscriptions set created_at=now()+interval '1 minute' where id='newer'");
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(1);
    const messages = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(messages.map((message: { to: string }) => message.to)).toEqual(["ExpoPushToken[olderabcdefghijk]"]);
  });

  it("reaches the twenty-first device on the next bounded sweep without resending the first twenty", async () => {
    for (let index = 0; index < 21; index++) await subscribe(`device-${index}`);
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const messages = JSON.parse(String(init?.body)) as Array<{ to: string }>;
      return Response.json({ data: messages.map(message => ({ status: "ok", id: `ticket-${message.to}` })) });
    });
    expect(await runMobilePushDeliverySweep()).toEqual({ processed: 1, failed: 0 });
    const first = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as Array<{ to: string }>;
    expect(first).toHaveLength(20);
    expect(await runMobilePushDeliverySweep()).toEqual({ processed: 1, failed: 0 });
    const second = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)) as Array<{ to: string }>;
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map(message => message.to)).size).toBe(21);
    expect((await db.query("select status,count(*)::int as count from alpha_exchange.mobile_push_deliveries group by status")).rows)
      .toEqual([{ status: "sent", count: 21 }]);
    expect(await runMobilePushDeliverySweep()).toEqual({ processed: 0, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the claimed devices in preflight even if many newer registrations arrive", async () => {
    await subscribe("original");
    afterClaim = async () => {
      for (let index = 0; index < 21; index++) await subscribe(`new-device-${index}`);
    };
    await deliverMobilePushNotification(notification);
    expect(fetch).toHaveBeenCalledTimes(1);
    const messages = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(messages.map((message: { to: string }) => message.to)).toEqual(["ExpoPushToken[originalabcdefghijk]"]);
  });

  it("does not send a claimed batch if another worker already replaced its claim attempt", async () => {
    await subscribe("valid");
    afterClaim = async () => { await db.exec("update alpha_exchange.mobile_push_deliveries set attempt_count=2"); };
    await deliverMobilePushNotification(notification);
    expect(fetch).not.toHaveBeenCalled();
    expect((await db.query("select status,attempt_count from alpha_exchange.mobile_push_deliveries")).rows)
      .toEqual([{ status: "processing", attempt_count: 2 }]);
  });

  it("bounds one recovery sweep to twelve notifications and drains the remainder later", async () => {
    await subscribe("valid");
    for (let index = 0; index < 13; index++) {
      const next = { ...notification, id: `notice-${index}` };
      await db.query("insert into alpha_exchange.notifications(id,user_id,is_read,payload) values($1,'buyer',false,$2)", [next.id, JSON.stringify(next)]);
    }
    expect(await runMobilePushDeliverySweep()).toEqual({ processed: 12, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(12);
    expect(await runMobilePushDeliverySweep()).toEqual({ processed: 2, failed: 0 });
    expect(fetch).toHaveBeenCalledTimes(14);
  });

  it("recovers new critical/high trade actions ahead of an older optional-listing backlog", async () => {
    await subscribe("valid");
    const urgent = { ...notification, priority: "critical", updatedAt: new Date().toISOString() };
    await db.query("update alpha_exchange.notifications set payload=$1", [JSON.stringify(urgent)]);
    const high = { ...notification, id: "high", priority: "high", updatedAt: new Date().toISOString() };
    await db.query("insert into alpha_exchange.notifications(id,user_id,is_read,payload) values('high','buyer',false,$1)", [JSON.stringify(high)]);
    for (let index = 0; index < 13; index++) {
      const next = { ...notification, id: `listing-${index}`, category: "listing", priority: "normal" };
      await db.query("insert into alpha_exchange.notifications(id,user_id,is_read,payload,category) values($1,'buyer',false,$2,'listing')", [next.id, JSON.stringify(next)]);
    }
    expect(await runMobilePushDeliverySweep()).toEqual({ processed: 12, failed: 0 });
    const first = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    const second = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
    expect(first[0].data.notificationId).toBe("notice");
    expect(second[0].data.notificationId).toBe("high");
  });

  it.each([
    "update alpha_exchange.notifications set payload=jsonb_set(payload,'{createdAt}',to_jsonb(to_char(now()-interval '25 hours','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')))",
    "update alpha_exchange.notifications set is_read=true",
    "update alpha_exchange.notifications set payload=payload || '{\"state\":\"archived\"}'::jsonb",
    "update alpha_exchange.users set payload='{\"disabled\":true}'",
    "delete from alpha_exchange.sessions",
    "update alpha_exchange.mobile_push_subscriptions set active=false",
    "update alpha_exchange.users set payload='{\"notificationPreferences\":{\"inApp\":false}}'; update alpha_exchange.notifications set category='listing',payload=payload || '{\"category\":\"listing\"}'::jsonb",
  ])("does not recover ineligible or stale work: %s", async sql => {
    await subscribe("valid");
    await db.exec(sql);
    await runMobilePushDeliverySweep();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains critical transactional delivery when optional in-app notices are disabled", async () => {
    await subscribe("valid");
    await db.exec("update alpha_exchange.users set payload='{\"notificationPreferences\":{\"inApp\":false}}'");
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "delete from alpha_exchange.sessions",
    "update alpha_exchange.mobile_push_subscriptions set expo_push_token='ExpoPushToken[replacement123]'",
    "update alpha_exchange.notifications set is_read=true",
    "update alpha_exchange.users set payload='{\"disabled\":true}'",
  ])("rechecks eligibility between claiming and sending: %s", async sql => {
    await subscribe("valid");
    afterClaim = async () => { await db.exec(sql); };
    await deliverMobilePushNotification(notification);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rechecks session revocation after a provider retry delay", async () => {
    await subscribe("valid");
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await db.exec("delete from alpha_exchange.sessions");
      return Response.json({}, { status: 503 });
    });
    await deliverMobilePushNotification(notification);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not let an old send failure disable a refreshed device token", async () => {
    await subscribe("valid");
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await db.exec("update alpha_exchange.mobile_push_subscriptions set expo_push_token='ExpoPushToken[replacement123]'");
      return Response.json({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] });
    });
    await deliverMobilePushNotification(notification);
    expect((await db.query("select active from alpha_exchange.mobile_push_subscriptions")).rows).toEqual([{ active: true }]);
  });

  it("does not let a delayed receipt disable a replacement token", async () => {
    await subscribe("valid");
    await deliverMobilePushNotification(notification);
    await db.exec(`update alpha_exchange.mobile_push_deliveries set updated_at=now()-interval '16 minutes';
      update alpha_exchange.mobile_push_subscriptions set expo_push_token='ExpoPushToken[replacement123]'`);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: { "synthetic-ticket": { status: "error", details: { error: "DeviceNotRegistered" } } } }));
    clock += 2_000;
    await runMobilePushDeliverySweep();
    expect((await db.query("select active from alpha_exchange.mobile_push_subscriptions")).rows).toEqual([{ active: true }]);
  });

  it("does deactivate the unchanged token when the provider reports it unregistered", async () => {
    await subscribe("valid");
    await deliverMobilePushNotification(notification);
    await db.exec("update alpha_exchange.mobile_push_deliveries set updated_at=now()-interval '16 minutes'");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: { "synthetic-ticket": { status: "error", details: { error: "DeviceNotRegistered" } } } }));
    clock += 2_000;
    await runMobilePushDeliverySweep();
    expect((await db.query("select active from alpha_exchange.mobile_push_subscriptions")).rows).toEqual([{ active: false }]);
  });

  it("does not overwrite a newer claim when an interrupted attempt finishes late", async () => {
    await subscribe("valid");
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await db.exec("update alpha_exchange.mobile_push_deliveries set attempt_count=2,status='sent',ticket_id='newer-ticket'");
      return Response.json({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] });
    });
    await deliverMobilePushNotification(notification);
    expect((await db.query("select status,ticket_id from alpha_exchange.mobile_push_deliveries")).rows)
      .toEqual([{ status: "sent", ticket_id: "newer-ticket" }]);
    expect((await db.query("select active from alpha_exchange.mobile_push_subscriptions")).rows).toEqual([{ active: true }]);
  });

  it("rotates a full missing-receipt batch so later tickets can be reconciled", async () => {
    await subscribe("valid", "1 hour", false);
    await db.exec(`insert into alpha_exchange.mobile_push_deliveries (notification_id,subscription_id,status,ticket_id,updated_at)
      select 'old-'||n,'valid','sent','ticket-'||n,now()-interval '20 minutes' from generate_series(1,100) n;
      insert into alpha_exchange.mobile_push_deliveries (notification_id,subscription_id,status,ticket_id,updated_at)
      values ('new','valid','sent','new-ticket',now()-interval '16 minutes')`);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: {} }));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: { "new-ticket": { status: "ok" } } }));
    await runMobilePushDeliverySweep();
    await runMobilePushDeliverySweep();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({ ids: ["new-ticket"] });
    expect((await db.query("select status from alpha_exchange.mobile_push_deliveries where notification_id='new'")).rows)
      .toEqual([{ status: "delivered" }]);
  });

  it("records expired receipts without resending a possibly delivered notification", async () => {
    await subscribe("valid");
    await db.query(`insert into alpha_exchange.mobile_push_deliveries
      (notification_id,subscription_id,status,ticket_id,updated_at)
      values ($1,'valid','sent','expired-ticket',now()-interval '25 hours')`, [mobilePushDeliveryKey(notification)]);
    await runMobilePushDeliverySweep();
    await deliverMobilePushNotification(notification);
    expect(fetch).not.toHaveBeenCalled();
    expect((await db.query("select status,last_error_code from alpha_exchange.mobile_push_deliveries")).rows)
      .toEqual([{ status: "failed", last_error_code: "EXPO_RECEIPT_EXPIRED" }]);
  });
});
