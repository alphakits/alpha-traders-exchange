// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261017214355_announcement_request_key_required.sql", "utf8");
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`create schema alpha_exchange;
    create table alpha_exchange.admin_announcement_runs (
      id text primary key, created_by_user_id text not null, request_key text, payload jsonb not null);
    create unique index idx_alpha_exchange_announcement_runs_request_key
      on alpha_exchange.admin_announcement_runs(created_by_user_id,request_key);
    alter table alpha_exchange.admin_announcement_runs enable row level security;
    insert into alpha_exchange.admin_announcement_runs values ('old-run','owner','request-1','{"retained":true}');`);
});
afterEach(async () => { await db.close(); });

describe("announcement request-key parity migration", () => {
  it("replays without changing history and keeps RLS and duplicate-request protection", async () => {
    const before = (await db.query("select * from alpha_exchange.admin_announcement_runs order by id")).rows;
    await db.exec(migration);
    await db.exec(migration);
    expect((await db.query("select * from alpha_exchange.admin_announcement_runs order by id")).rows).toEqual(before);
    expect((await db.query("select is_nullable from information_schema.columns where table_schema='alpha_exchange' and table_name='admin_announcement_runs' and column_name='request_key'")).rows).toEqual([{ is_nullable: "NO" }]);
    expect((await db.query("select relrowsecurity from pg_class where oid='alpha_exchange.admin_announcement_runs'::regclass")).rows).toEqual([{ relrowsecurity: true }]);
    await expect(db.exec("insert into alpha_exchange.admin_announcement_runs values ('duplicate','owner','request-1','{}')")).rejects.toThrow(/unique constraint/);
    await expect(db.exec("insert into alpha_exchange.admin_announcement_runs values ('missing','owner',null,'{}')")).rejects.toThrow(/not-null constraint/);
    await db.exec("insert into alpha_exchange.admin_announcement_runs values ('new-run','owner','request-2','{}')");
    expect((await db.query("select count(*)::int as n from alpha_exchange.admin_announcement_runs")).rows).toEqual([{ n: 2 }]);
  });
  it("fails safely on unknown legacy nulls without inventing keys or rewriting payloads", async () => {
    await db.exec("insert into alpha_exchange.admin_announcement_runs values ('legacy','owner',null,'{\"historical\":true}')");
    const before = (await db.query("select * from alpha_exchange.admin_announcement_runs order by id")).rows;
    await expect(db.exec(migration)).rejects.toThrow(/contains null values/);
    await db.exec("rollback");
    expect((await db.query("select * from alpha_exchange.admin_announcement_runs order by id")).rows).toEqual(before);
    expect((await db.query("select is_nullable from information_schema.columns where table_schema='alpha_exchange' and table_name='admin_announcement_runs' and column_name='request_key'")).rows).toEqual([{ is_nullable: "YES" }]);
  });
});
