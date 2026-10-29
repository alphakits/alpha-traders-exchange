// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("./postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
import { claimNotificationReminder, snoozeNotificationReminder } from "./notification-engagement";
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec("create schema alpha_exchange; create table alpha_exchange.users(id text primary key); insert into alpha_exchange.users values ('one'),('two')");
  state.pool = { query: async (sql: string, args?: unknown[]) => {
    if (!args) { await db.exec(sql); return { rows: [], rowCount: 0 }; }
    const result = await db.query(sql, args);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  } };
});
afterEach(async () => { await db.close(); state.pool = null; });
describe("account-wide notification reminders", () => {
  it("allows only one of concurrent tabs and keeps accounts independent", async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimNotificationReminder("one")));
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimNotificationReminder("two")).toBe(true);
    expect(await claimNotificationReminder("one")).toBe(false);
  });
  it("uses database time and enforces twelve hours even across midnight", async () => {
    expect(await claimNotificationReminder("one")).toBe(true);
    await db.exec("update alpha_exchange.notification_reminder_state set next_prompt_at=now()+interval '1 second'");
    expect(await claimNotificationReminder("one")).toBe(false);
    await db.exec("update alpha_exchange.notification_reminder_state set next_prompt_at=now()-interval '1 second'");
    expect(await claimNotificationReminder("one")).toBe(true);
    const result = await db.query<{hours:number}>("select extract(epoch from next_prompt_at-now())/3600 as hours from alpha_exchange.notification_reminder_state");
    expect(Number(result.rows[0].hours)).toBeGreaterThan(11.99);
  });
  it("persists a seven-day snooze and removes state when the account is deleted", async () => {
    await snoozeNotificationReminder("one");
    expect(await claimNotificationReminder("one")).toBe(false);
    const result = await db.query<{days:number}>("select extract(epoch from next_prompt_at-now())/86400 as days from alpha_exchange.notification_reminder_state");
    expect(Number(result.rows[0].days)).toBeGreaterThan(6.99);
    await db.exec("delete from alpha_exchange.users where id='one'");
    expect((await db.query("select * from alpha_exchange.notification_reminder_state")).rows).toHaveLength(0);
  });
  it("fails closed when storage is unavailable", async () => { state.pool=null; expect(await claimNotificationReminder("one")).toBe(false); });
  it("revokes inherited client-role grants and enables RLS on every private table", async () => {
    await db.exec("create role anon; create role authenticated; alter default privileges in schema alpha_exchange grant all on tables to anon, authenticated");
    await claimNotificationReminder("one");
    for (const table of ["notification_reminder_state", "browser_push_subscriptions", "browser_push_deliveries"]) {
      const result = await db.query<{ anon: boolean; authenticated: boolean; rls: boolean }>(`select has_table_privilege('anon',$1,'select') as anon,has_table_privilege('authenticated',$1,'select') as authenticated,relrowsecurity as rls from pg_class where oid=$1::regclass`, [`alpha_exchange.${table}`]);
      expect(result.rows[0]).toEqual({ anon: false, authenticated: false, rls: true });
    }
  });
});
