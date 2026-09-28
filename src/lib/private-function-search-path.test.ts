// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const hardening = read("supabase/migrations/20260928233913_pin_private_function_search_paths.sql");
const discordMigrations = [
  "20260807000000_discord_identity_sync.sql",
  "20260808030000_discord_listing_sharing.sql",
  "20260808100000_discord_market_intelligence.sql",
  "20260808140000_discord_community_interactions.sql",
  "20260808170000_discord_management_dashboard.sql",
];
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema alpha_exchange;
    create schema shadow;
    create table alpha_exchange.commissions(id text primary key, seller_id text, payload jsonb);
    create table alpha_exchange.audit_logs(id text primary key, actor_user_id text, created_at timestamptz, payload jsonb);
    create table alpha_exchange.discord_listing_messages(id uuid primary key, event_version bigint, state text, updated_at timestamptz, listing_id text, seller_id text);
    create table alpha_exchange.discord_listing_outbox(mapping_id uuid, listing_id text, seller_id text, event_type text, event_version bigint, dedupe_key text unique);
    create table alpha_exchange.discord_interaction_claims(expires_at timestamptz);
    create table alpha_exchange.discord_command_rate_limits(updated_at timestamptz);
    create table alpha_exchange.discord_notification_audit(created_at timestamptz);
    create table alpha_exchange.discord_operator_requests(status text, updated_at timestamptz);
    create table alpha_exchange.discord_interaction_audit(created_at timestamptz);
    create function shadow.lower(text) returns text language sql immutable as $$select 'spoofed'::text$$;
    set search_path = shadow, pg_catalog;
  `);
  await db.exec(read("db/migrations/20260925_commission_batch_receipt_reservations.sql"));
  for (const filename of discordMigrations) {
    // Exercise the actual committed function bodies without installing worker
    // schedules or requiring a live Discord/database connection.
    const source = read(`supabase/migrations/${filename}`);
    for (const [definition] of source.matchAll(/create or replace function alpha_exchange\.[\s\S]*?\$\$;/gi)) {
      await db.exec(definition);
    }
  }
  await db.exec(hardening);
}, 30_000);
afterAll(async () => { await db?.close(); });

describe("private database function search paths", () => {
  it("pins all 14 functions and reapplies without changing their bodies or privileges", async () => {
    const query = "select proname, prosrc, prosecdef, proacl, proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='alpha_exchange' order by proname";
    const before = await db.query<{ proconfig: string[] }>(query);
    expect(before.rows).toHaveLength(14);
    expect(before.rows.every(row => row.proconfig.includes('search_path=""'))).toBe(true);
    await db.exec(hardening);
    expect((await db.query(query)).rows).toEqual(before.rows);
  });

  it("ignores a caller's shadow functions and still enforces receipt ownership", async () => {
    const signature = "A".repeat(64);
    const normalized = await db.query<{ receipt: string }>("select alpha_exchange.commission_batch_receipt_key($1) as receipt", [`0x${signature}`]);
    expect(normalized.rows[0].receipt).toBe(signature.toLowerCase());
    const payload = { newValue: { kind: "commission_batch_receipt_approval_v1", batch: {
      id: "test-batch", kind: "owner_confirmed_receipt", sellerId: "seller", commissionIds: ["fee-1"],
      signature, approvedByUserId: "owner",
    } } };
    await db.query("insert into alpha_exchange.audit_logs values ('test-batch:approved','owner',now(),$1)", [JSON.stringify(payload)]);
    await db.query("insert into alpha_exchange.commissions values ('fee-1','seller',$1)", [JSON.stringify({ paymentSignature: signature })]);
    await expect(db.query("insert into alpha_exchange.commissions values ('stolen','other',$1)", [JSON.stringify({ paymentSignature: signature })]))
      .rejects.toThrow(/another authorized payment group/);
    expect((await db.query("select id from alpha_exchange.commissions")).rows).toEqual([{ id: "fee-1" }]);
  });

  it("preserves versioned Discord listing work under a different caller search path", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    await db.query("insert into alpha_exchange.discord_listing_messages values ($1,1,'active',now(),'listing','seller')", [id]);
    await db.query("select alpha_exchange.enqueue_discord_listing_mapping($1,'reconcile')", [id]);
    expect((await db.query("select state,event_version from alpha_exchange.discord_listing_messages")).rows)
      .toEqual([{ state: "update_pending", event_version: 2 }]);
    expect((await db.query("select dedupe_key from alpha_exchange.discord_listing_outbox")).rows)
      .toEqual([{ dedupe_key: `${id}:2` }]);
    expect((await db.query("select alpha_exchange.discord_desired_seller_status('approved_seller') as status")).rows)
      .toEqual([{ status: "approved" }]);
  });

  it("keeps Discord retention cleanup scoped to expired fixture rows", async () => {
    await db.exec(`
      insert into alpha_exchange.discord_interaction_claims values (now()-interval '1 day'),(now()+interval '1 day');
      insert into alpha_exchange.discord_operator_requests values ('completed',now()-interval '91 days'),('pending',now()-interval '91 days');
    `);
    const community = await db.query<{ interaction_claims_deleted: number }>("select * from alpha_exchange.cleanup_discord_community_state()");
    expect(community.rows[0].interaction_claims_deleted).toBe(1);
    const management = await db.query<{ operator_requests_deleted: number }>("select * from alpha_exchange.cleanup_discord_management_state()");
    expect(management.rows[0].operator_requests_deleted).toBe(1);
    expect((await db.query("select status from alpha_exchange.discord_operator_requests")).rows).toEqual([{ status: "pending" }]);
  });
});
