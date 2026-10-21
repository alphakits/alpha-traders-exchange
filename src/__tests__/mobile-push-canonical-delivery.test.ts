// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
import { deliverMobilePushNotification } from "@/lib/mobile-push";

describe("canonical push delivery under publication bursts", () => {
  let db: PGlite;
  let receiptGate: Promise<void> | undefined;
  let receiptFailure: Error | undefined;
  let clock = 0;
  const queries: string[] = [];
  const notification: AlphaExchangeNotification = { id: "notice", userId: "buyer", category: "trade",
    title: "Trade completed", message: "PRIVATE_BANK_DETAIL", isRead: false,
    relatedRequestId: "trade", createdAt: "2026-10-17T00:00:00.000Z" };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create schema alpha_exchange;
      create table alpha_exchange.notifications (id text primary key, user_id text, is_read boolean, payload jsonb);
      create table alpha_exchange.sessions (token_hash text primary key, user_id text, expires_at timestamptz);`);
    state.pool = { query: async (sql: string, args?: unknown[]) => {
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
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    } };
    await deliverMobilePushNotification(notification);
  });
  afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.close(); });
  beforeEach(async () => {
    clock += 2_000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    receiptGate = undefined;
    receiptFailure = undefined;
    await db.exec(`delete from alpha_exchange.mobile_push_deliveries; delete from alpha_exchange.mobile_push_subscriptions;
      delete from alpha_exchange.sessions; delete from alpha_exchange.notifications;`);
    await db.query("insert into alpha_exchange.notifications values ($1,$2,false,$3)", [notification.id, notification.userId, JSON.stringify(notification)]);
    queries.length = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ status: "ok", id: "synthetic-ticket" }] })));
  });
  async function subscribe(id: string, expires = "1 hour", active = true, userId = "buyer") {
    await db.query("insert into alpha_exchange.sessions values ($1,$2,now()+$3::interval)", [id, userId, expires]);
    await db.query(`insert into alpha_exchange.mobile_push_subscriptions
      (id,user_id,session_token_hash,installation_id_hash,expo_push_token,platform,locale,app_version,active)
      values ($1,$2,$1,$1,$3,'ios','en','test',$4)`, [id, userId, `ExpoPushToken[${id}abcdefghijk]`, active]);
  }
  it("uses the persisted notification, unread badge and eligible session without leaking private copy", async () => {
    await subscribe("valid"); await subscribe("expired", "-1 hour"); await subscribe("disabled", "1 hour", false); await subscribe("other", "1 hour", true, "other");
    await db.query("insert into alpha_exchange.notifications values ('second','buyer',false,$1)", [JSON.stringify({ ...notification, id: "second" })]);
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

  it("recovers newly eligible receipts after the empty-result window and retries missing provider receipts immediately", async () => {
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
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await db.query("select status from alpha_exchange.mobile_push_deliveries")).rows).toEqual([{ status: "delivered" }]);
  });
});
