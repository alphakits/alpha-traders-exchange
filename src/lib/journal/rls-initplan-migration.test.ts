// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const tables = ["journal_trades", "journal_reviews", "journal_settings", "journal_files", "journal_file_cleanup"];
let db: PGlite;
let migration: string;
let originalRows: unknown[];

async function asUser<T>(userId: string, operation: () => Promise<T>) {
  await db.exec("begin; set local role alpha_journal_runtime;");
  try {
    await db.query("select set_config('alpha_journal.user_id', $1, true)", [userId]);
    return await operation();
  } finally {
    await db.exec("rollback");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create schema alpha_exchange; create table alpha_exchange.users(id text primary key); insert into alpha_exchange.users values('alice'),('bob'); create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
  await db.exec(await readFile("supabase/migrations/20261008200530_private_trading_journal.sql", "utf8"));
  await db.exec("insert into alpha_exchange.journal_settings(user_id,payload) values('alice','{\"private\":\"alice\"}'),('bob','{\"private\":\"bob\"}');");
  originalRows = (await db.query("select * from alpha_exchange.journal_settings order by user_id")).rows;
  migration = await readFile("supabase/migrations/20261016171500_journal_owner_statement_context.sql", "utf8");
  await db.exec(migration);
});
afterAll(async () => { await db?.close(); });

describe.sequential("journal statement-context migration", () => {
  it("is repeatable and leaves existing journal data unchanged", async () => {
    await db.exec(migration);
    expect((await db.query("select * from alpha_exchange.journal_settings order by user_id")).rows).toEqual(originalRows);
  });

  it("preserves forced RLS, restricted roles, and all five read/write policies", async () => {
    const result = await db.query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean;anon_read:boolean;authenticated_write:boolean}>(
      "select relname, relrowsecurity, relforcerowsecurity, has_table_privilege('anon',c.oid,'select') as anon_read, has_table_privilege('authenticated',c.oid,'insert') as authenticated_write from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='alpha_exchange' and relname = any($1::text[]) order by relname", [tables]);
    expect(result.rows).toHaveLength(5);
    for (const row of result.rows) expect(row).toMatchObject({relrowsecurity:true,relforcerowsecurity:true,anon_read:false,authenticated_write:false});
    const policies = await db.query<{roles:string[];cmd:string;qual:string;with_check:string}>("select roles,cmd,qual,with_check from pg_policies where schemaname='alpha_exchange' and tablename = any($1::text[])", [tables]);
    expect(policies.rows).toHaveLength(5);
    for (const row of policies.rows) {
      expect(row.roles).toEqual(["alpha_journal_runtime"]);
      expect(row.cmd).toBe("ALL");
      expect(row.qual).toContain("SELECT");
      expect(row.with_check).toContain("SELECT");
    }
  });

  it("re-evaluates ownership for each pooled transaction and denies missing identity", async () => {
    for (const userId of ["alice", "bob", "", "alice"]) {
      const result = await asUser(userId, () => db.query<{user_id:string}>("select user_id from alpha_exchange.journal_settings"));
      expect(result.rows.map(row => row.user_id)).toEqual(userId ? [userId] : []);
    }
  });

  it("keeps another account's records unreadable and unmodifiable without application filters", async () => {
    const update = await asUser("bob", () => db.query("update alpha_exchange.journal_settings set payload='{}' where user_id='alice' returning user_id"));
    expect(update.rows).toEqual([]);
    await expect(asUser("bob", () => db.query("insert into alpha_exchange.journal_reviews(user_id,review_date,period,payload) values('alice','2026-10-16','day','{}')"))).rejects.toThrow(/row-level security/);
    expect((await db.query("select * from alpha_exchange.journal_settings order by user_id")).rows).toEqual(originalRows);
  });

  it("uses an InitPlan for the fixed account context", async () => {
    const plan = await asUser("alice", () => db.query("explain (format json) select * from alpha_exchange.journal_settings"));
    expect(JSON.stringify(plan.rows)).toContain("InitPlan");
  });
});
