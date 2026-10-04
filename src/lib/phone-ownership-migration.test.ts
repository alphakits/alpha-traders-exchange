// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { canonicalPhoneNumber } from "@/lib/phone-number-normalization";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261004101724_unique_exchange_phone_ownership.sql"), "utf8");
let db: PGlite;
async function insert(id: string, contact: string, verified?: string, email = `${id}@example.test`, verifiedAt = "2026-10-01T12:00:00Z") {
  return db.query("insert into alpha_exchange.users(id,email,payload) values($1,$2,$3)", [id, email,
    JSON.stringify({ id, email, whatsappNumber: contact, ...(verified ? { verifiedPhone: verified, phoneVerifiedAt: verifiedAt } : {}) }),
  ]);
}
async function apply() { await db.exec(`begin; ${migration} commit;`); }
beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(`create schema alpha_exchange; create role anon; create role authenticated; create role service_role;
    create table alpha_exchange.users(id text primary key,email text,payload jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
    create table alpha_exchange.runtime_meta(singleton boolean primary key,version bigint,updated_at timestamptz);
    insert into alpha_exchange.runtime_meta values(true,1,now());`);
}, 30_000);
afterEach(async () => { await db?.close(); });

describe("durable phone ownership", () => {
  it("retires later duplicate verification while retaining private contacts and account history", async () => {
    await insert("first", "+972521234567", "+972521234567");
    await insert("later", "0521234567", "0521234567", "later@example.test", "2026-10-02T12:00:00Z");
    await db.exec("update alpha_exchange.users set payload=payload || '{\"role\":\"approved_seller\",\"history\":\"retained\"}'::jsonb where id='later'");
    await apply();
    const rows = (await db.query<{ id: string; payload: Record<string, unknown> }>("select id,payload from alpha_exchange.users order by id")).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].payload.verifiedPhone).toBe("+972521234567");
    expect(rows[1].payload).toMatchObject({ whatsappNumber: "0521234567", role: "approved_seller", history: "retained", buyerVerificationStatus: "not_started" });
    expect(rows[1].payload).not.toHaveProperty("verifiedPhone");
    expect((await db.query("select user_id from alpha_exchange.phone_verification_reconciliations")).rows).toEqual([{ user_id: "later" }]);
    await apply();
    expect((await db.query("select count(*)::int count from alpha_exchange.phone_verification_reconciliations")).rows[0]).toEqual({ count: 1 });
    // Repository upserts of unchanged legacy contacts remain safe.
    await db.exec("insert into alpha_exchange.users select id,email,payload,created_at,updated_at from alpha_exchange.users where id='later' on conflict(id) do update set payload=excluded.payload");
  });
  it.each(["0521234567", "972521234567", "00972521234567", "+972 (52) 123-4567", "٠٥٢١٢٣٤٥٦٧", "۰۵۲۱۲۳۴۵۶۷"])("matches the app's canonical phone key for %s", async phone => {
    await apply();
    const result = await db.query<{ phone: string }>("select alpha_exchange.canonical_user_phone($1) phone", [phone]);
    expect(result.rows[0].phone).toBe(canonicalPhoneNumber(phone));
    expect(result.rows[0].phone).toBe("+972521234567");
  });
  it("blocks duplicated verification through direct writes even when the contacts differ", async () => {
    await apply();
    await insert("one", "+972541234567", "+972521234567");
    await expect(insert("two", "+972551234567", "0521234567")).rejects.toThrow("users_verified_phone_unique");
  });
  it("blocks registrations and contact changes using another account's number", async () => {
    await apply();
    await insert("one", "+972521234567");
    await expect(insert("two", "٠٥٢١٢٣٤٥٦٧")).rejects.toThrow("already linked");
    await insert("two", "+972541234567");
    await expect(db.exec("update alpha_exchange.users set payload=payload || '{\"whatsappNumber\":\"0521234567\"}'::jsonb where id='two'")).rejects.toThrow("already linked");
  });
  it("allows shared private contacts only for exact authorized IDs and emails", async () => {
    await apply();
    await insert("user-cfa3bd2c-25e7-4a9e-9ae5-55ac4900846f", "+972521234567", undefined, "jozenmark834@yahoo.com");
    await insert("user-030c4619-e1a6-4147-9d91-a8bbd2e2db4a", "0521234567", undefined, "alphatradersai@gmail.com");
    await insert("user-6f3a0120-5d36-423f-8dee-9a875e8e064e", "٠٥٢١٢٣٤٥٦٧", undefined, "claudiahttps11@gmail.com");
    await expect(insert("ordinary", "0521234567", undefined, "other@example.test")).rejects.toThrow("already linked");
    await expect(insert("recreated", "0521234567", undefined, "alphatradersai@gmail.com")).rejects.toThrow("already linked");
    expect((await db.query("select count(*)::int count from alpha_exchange.users")).rows[0]).toEqual({ count: 3 });
  });
  it("keeps reconciliation data and privileged functions inaccessible to public API roles", async () => {
    await apply();
    const result = await db.query<{ readable: boolean; executable: boolean }>(`select
      has_table_privilege('authenticated','alpha_exchange.phone_verification_reconciliations','select') readable,
      has_function_privilege('anon','alpha_exchange.enforce_unique_contact_phone()','execute') executable`);
    expect(result.rows[0]).toEqual({ readable: false, executable: false });
  });
});
