// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("./postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
import { browserPushCategoryEnabled, browserPushConfiguration, browserPushPayload, drainBrowserPush, parseBrowserPushSubscription, pushHash, saveBrowserPush } from "./browser-push";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";
let db: PGlite;
const keys = webpush.generateVAPIDKeys();
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test-device", keys: { p256dh: keys.publicKey, auth: Buffer.alloc(16, 1).toString("base64url") } };
let send: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create schema alpha_exchange;
    create table alpha_exchange.users(id text primary key,payload jsonb);
    create table alpha_exchange.sessions(token_hash text primary key,user_id text,expires_at timestamptz);
    create table alpha_exchange.notifications(id text primary key,user_id text,is_read boolean,created_at timestamptz,payload jsonb);
    insert into alpha_exchange.users values('user','{"notificationPreferences":{"browserPush":true,"inApp":true}}');`);
  await db.query("insert into alpha_exchange.sessions values($1,'user',now()+interval '1 day')", [pushHash("session")]);
  state.pool = { query: async (sql: string, args?: unknown[]) => {
    if (!args && sql.includes("create table")) { await db.exec(sql); return { rows: [], rowCount: 0 }; }
    const result = await db.query(sql, args);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  } };
  vi.stubEnv("WEB_PUSH_ENABLED", "true"); vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY",keys.publicKey);
  vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY",keys.privateKey); vi.stubEnv("WEB_PUSH_VAPID_SUBJECT","https://www.alphatraders.co.il");
  send = vi.spyOn(webpush,"sendNotification").mockResolvedValue({statusCode:201,headers:{},body:""});
  await saveBrowserPush({ userId:"user",sessionToken:"session",subscription,locale:"ar" });
});
afterEach(async () => { await db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); state.pool=null; });
async function notice(id="notice") {
  const payload = { id,userId:"user",category:"listing",title:"New listing",message:"private content",state:"unread",isRead:false,createdAt:new Date().toISOString(),relatedHref:"/usdt-exchange/requests/request-1" } as AlphaExchangeNotification;
  await db.query("insert into alpha_exchange.notifications values($1,'user',false,now(),$2)",[id,JSON.stringify(payload)]); return payload;
}
describe("browser push delivery", () => {
  it("sends a real committed notice once, using an internal Arabic destination and private copy", async () => {
    const n=await notice();
    expect((await drainBrowserPush()).sent).toBe(1);
    expect((await drainBrowserPush()).sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    const payload=JSON.parse(send.mock.calls[0][1]);
    expect(payload.url).toBe("/ar/usdt-exchange/requests/request-1");
    expect(JSON.stringify(payload)).not.toContain(n.message);
  });
  it.each(["logout","read","archived","disabled","preference","category"])("does not send after %s",async reason => {
    await notice();
    if(reason==="logout") await db.exec("delete from alpha_exchange.sessions");
    if(reason==="read") await db.exec("update alpha_exchange.notifications set is_read=true");
    if(reason==="archived") await db.exec(`update alpha_exchange.notifications set payload=payload||'{"state":"archived"}'::jsonb`);
    if(reason==="disabled") await db.exec(`update alpha_exchange.users set payload=payload||'{"disabled":true}'::jsonb`);
    if(reason==="preference") await db.exec(`update alpha_exchange.users set payload='{"notificationPreferences":{"browserPush":false}}'`);
    if(reason==="category") await db.exec(`update alpha_exchange.users set payload='{"notificationPreferences":{"browserPush":true,"browserPushListings":false}}'`);
    await drainBrowserPush(); expect(send).not.toHaveBeenCalled();
  });
  it("rechecks logout between provider calls",async () => {
    await notice("one");await notice("two");
    send.mockImplementationOnce(async()=>{ await db.exec("delete from alpha_exchange.sessions"); return {statusCode:201,headers:{},body:""}; });
    await drainBrowserPush(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("invalidates expired subscriptions and does not resend them",async()=>{
    await notice();send.mockRejectedValueOnce({statusCode:410});await drainBrowserPush();
    expect((await db.query<{active:boolean}>("select active from alpha_exchange.browser_push_subscriptions")).rows[0].active).toBe(false);
    await drainBrowserPush();expect(send).toHaveBeenCalledTimes(1);
  });
  it("recovers a transient failure only after the retry delay",async()=>{
    await notice();send.mockRejectedValueOnce({statusCode:503});await drainBrowserPush();await drainBrowserPush();expect(send).toHaveBeenCalledTimes(1);
    await db.exec("update alpha_exchange.browser_push_deliveries set updated_at=now()-interval '3 minutes'");
    await drainBrowserPush();expect(send).toHaveBeenCalledTimes(2);
  });
  it("rejects expired registrations and external destinations",async()=>{
    await expect(saveBrowserPush({userId:"user",sessionToken:"expired",subscription,locale:"en"})).rejects.toThrow("Session ended");
    const n=await notice();expect(browserPushPayload({...n,relatedHref:"https://evil.example"},"en").url).toBe("/en/notifications");
  });
  it("does not advertise invalid/missing sender configuration",()=>{
    expect(browserPushConfiguration()).not.toBeNull();vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY","invalid");expect(browserPushConfiguration()).toBeNull();
  });
  it("does not advertise a mismatched sender key pair", () => {
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", webpush.generateVAPIDKeys().privateKey);
    expect(browserPushConfiguration()).toBeNull();
  });
  it("respects semantic chat, feedback and admin preferences on trade-category notices", async () => {
    const n = await notice();
    const trade = { ...n, category: "trade" as const };
    expect(browserPushCategoryEnabled({ ...trade, title: "Owner message in Trade Room", reason: "trade_room_message" }, { browserPush: true, browserPushChatMessages: false })).toBe(false);
    expect(browserPushCategoryEnabled({ ...trade, title: "Review available" }, { browserPush: true, browserPushFeedback: false })).toBe(false);
    expect(browserPushCategoryEnabled({ ...trade, title: "Feedback required" }, { browserPush: true, browserPushFeedback: false })).toBe(false);
    expect(browserPushCategoryEnabled({ ...trade, actionHref: "/admin/alpha-exchange" }, { browserPush: true })).toBe(false);
    expect(browserPushCategoryEnabled({ ...trade, actionHref: "/ar/admin/alpha-exchange" }, { browserPush: true, browserPushAdminAlerts: true })).toBe(true);
  });
  it("coalesces overlapping drains without duplicate provider sends", async () => {
    await notice();
    await Promise.all(Array.from({ length: 8 }, () => drainBrowserPush()));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(["cancelled", "expired", "offer-22222222-2222-4222-8222-222222222222", "withdrawn-offer-22222222-2222-4222-8222-222222222222"])("uses transaction preferences for recipient-bound %s request updates", async event => {
    const demandId = "demand-11111111-1111-4111-8111-111111111111";
    const offerId = event.startsWith("withdrawn-") ? event.slice("withdrawn-".length) : event.startsWith("offer-") ? event : null;
    const n = { ...await notice(), id: `demand-notice:${demandId}:1:${event}:user`, relatedHref: `/usdt-exchange/requests/${demandId}${offerId ? `?offer=${offerId}` : ""}` };
    expect(browserPushCategoryEnabled(n, { browserPush: true, browserPushListings: false, browserPushTradeUpdates: true })).toBe(true);
    expect(browserPushCategoryEnabled(n, { browserPush: true, browserPushListings: true, browserPushTradeUpdates: false })).toBe(false);
    const broadcast = { ...n, id: `demand-notice:${demandId}:1:new:user`, relatedHref: `/usdt-exchange/requests/${demandId}` };
    expect(browserPushCategoryEnabled(broadcast, { browserPush: true, browserPushListings: false, browserPushTradeUpdates: true })).toBe(false);
    expect(browserPushCategoryEnabled(broadcast, { browserPush: true, browserPushListings: true, browserPushTradeUpdates: false })).toBe(true);
  });
  it("recovers abandoned processing but stops after three failed attempts", async () => {
    await notice(); send.mockRejectedValue({ statusCode: 503 });
    await drainBrowserPush();
    await db.exec("update alpha_exchange.browser_push_deliveries set status='processing',updated_at=now()-interval '3 minutes'");
    await drainBrowserPush();
    await db.exec("update alpha_exchange.browser_push_deliveries set updated_at=now()-interval '3 minutes'");
    await drainBrowserPush();
    await db.exec("update alpha_exchange.browser_push_deliveries set updated_at=now()-interval '3 minutes'");
    await drainBrowserPush();
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("does not replay notifications from before a device subscribed", async () => {
    await notice();
    await db.query("update alpha_exchange.notifications set created_at=now()-interval '1 hour',payload=jsonb_set(payload,'{createdAt}',$1::jsonb)", [JSON.stringify(new Date(Date.now() - 3600_000).toISOString())]);
    expect((await drainBrowserPush()).sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("delivers new messages even when their reused notification row was created days ago", async () => {
    await notice();
    const old = new Date(Date.now() - 7 * 86400_000).toISOString();
    const updated = new Date().toISOString();
    await db.query("update alpha_exchange.notifications set created_at=$1::timestamptz,payload=payload||$2::jsonb", [old, JSON.stringify({ createdAt: old, updatedAt: updated, category: "trade", title: "New Trade Room message", reason: "trade_room_message", relatedRequestId: "request-1" })]);
    expect((await drainBrowserPush()).sent).toBe(1);
    expect(JSON.parse(send.mock.calls[0][1]).url).toBe("/ar/trade-room/request-1?action=open-trade#chat");
    expect((await drainBrowserPush()).sent).toBe(0);
  });
  it("does not disable replacement subscription keys after an old send expires", async () => {
    await notice();
    const replacement = { ...subscription, keys: { ...subscription.keys, auth: Buffer.alloc(16, 2).toString("base64url") } };
    send.mockImplementationOnce(async () => {
      await saveBrowserPush({ userId: "user", sessionToken: "session", subscription: replacement, locale: "en" });
      throw { statusCode: 410 };
    });
    await drainBrowserPush();
    expect((await db.query<{ active: boolean }>("select active from alpha_exchange.browser_push_subscriptions")).rows[0].active).toBe(true);
  });
  it("rechecks category opt-out while the delivery batch is running", async () => {
    await notice("one"); await notice("two");
    send.mockImplementationOnce(async () => {
      await db.exec(`update alpha_exchange.users set payload='{"notificationPreferences":{"browserPush":true,"browserPushListings":false}}'`);
      return { statusCode: 201, headers: {}, body: "" };
    });
    await drainBrowserPush(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("uses high delivery urgency for critical buyer/seller actions", async () => {
    await notice();
    await db.exec(`update alpha_exchange.notifications set payload=payload||'{"priority":"critical"}'::jsonb`);
    await drainBrowserPush();
    expect(send.mock.calls[0][2]).toMatchObject({ urgency: "high" });
  });
  it("prioritizes a critical trade action ahead of a full older listing broadcast", async () => {
    for (let index = 0; index < 31; index++) await notice(`listing-${index}`);
    await notice("urgent-trade");
    await db.exec(`update alpha_exchange.notifications set payload=payload||'{"priority":"critical","category":"trade"}'::jsonb where id='urgent-trade'`);
    await drainBrowserPush();
    expect(send).toHaveBeenCalledTimes(30);
    expect(JSON.parse(send.mock.calls[0][1]).tag).toBe("urgent-trade");
  });
  it.each(["https://web.push.apple.com/Q/device", "https://wns2-bl2p.notify.windows.com/w/?token=example", "https://updates.push.services.mozilla.com/wpush/v2/device"])("accepts supported provider endpoint %s", endpoint => {
    expect(parseBrowserPushSubscription({ ...subscription, endpoint })).not.toBeNull();
  });
  it.each(["https://127.0.0.1/push","https://fcm.googleapis.com.evil.test/push","http://fcm.googleapis.com/push","https://name:pass@fcm.googleapis.com/push","https://fcm.googleapis.com:8443/push"])("blocks untrusted endpoint %s",endpoint=>{
    expect(parseBrowserPushSubscription({...subscription,endpoint})).toBeNull();
  });
});
