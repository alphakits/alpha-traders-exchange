// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { USDT_DEMAND_SCHEMA_SQL } from "@/lib/usdt-demand-schema";
import { readUsdtDemandSchemaReadiness } from "@/lib/usdt-demand-schema-readiness";
import { createDemand, respondToDemand } from "@/lib/usdt-demand-engine";
import { commitDemandMatch } from "@/lib/usdt-demand-policy";
import { demandTestDb, demandTestMarket, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";
import type { UsdtDemand } from "@/types/usdt-demand";
import type { PurchaseRequest } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
let database: PGlite;
let repository: AlphaExchangeRepository;
const tables = ["users", "listings", "purchase_requests", "usdt_demands", "notifications"] as const;

beforeAll(async () => {
  database = await PGlite.create();
  await database.exec(await readFile("supabase/migrations/20260720160000_alpha_exchange_runtime.sql", "utf8"));
  await database.exec("create role anon; create role authenticated; grant usage on schema alpha_exchange to anon, authenticated");
  await database.exec(USDT_DEMAND_SCHEMA_SQL.join(";\n"));
  const client = { query: (sql: string, values?: unknown[]) => database.query(sql, values), release() {} };
  repository = new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
  vi.spyOn(repository, "ensureReady").mockResolvedValue();
}, 30_000);

beforeEach(async () => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "0");
  await database.exec(`reset role;
    truncate alpha_exchange.usdt_demands, alpha_exchange.notifications, alpha_exchange.purchase_requests, alpha_exchange.listings;
    update alpha_exchange.runtime_meta set version = 0;
    alter table alpha_exchange.notifications drop constraint if exists injected_failure;
    alter table alpha_exchange.usdt_demands drop constraint if exists injected_failure;`);
  await database.exec(USDT_DEMAND_SCHEMA_SQL.join(";\n"));
  const fixture = demandTestDb();
  for (const [index, user] of fixture.users.entries()) {
    await database.query(`insert into alpha_exchange.users(id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) on conflict(id) do update set payload=excluded.payload`,
    [user.id, user.email, user.role, user.sellerStatus, user.availabilityStatus, user.onlineStatus, user.createdAt, user.updatedAt, index, JSON.stringify(user)]);
  }
  for (const [index, listing] of fixture.marketplaceListings.entries()) {
    await database.query(`insert into alpha_exchange.listings(id,seller_id,status,expires_at,created_at,updated_at,sort_index,payload)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [listing.id, listing.sellerId, listing.status, listing.expiresAt, listing.createdAt, listing.updatedAt, index, JSON.stringify(listing)]);
  }
});
afterEach(async () => { await database.exec("reset role"); vi.unstubAllEnvs(); });
afterAll(async () => { await database.close(); });

function sample(overrides: Partial<UsdtDemand> = {}) {
  return { ...createDemand(demandTestDb(), "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket()), ...overrides };
}
function insert(demand: UsdtDemand, payload: unknown = demand) {
  return database.query(`insert into alpha_exchange.usdt_demands(id,requester_id,operation_id,state,revision,purchase_request_id,expires_at,updated_at,payload)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
  [demand.id, demand.requesterId, demand.operationId, demand.state, demand.revision, demand.purchaseRequestId ?? null, demand.expiresAt, demand.updatedAt, JSON.stringify(payload)]);
}
const readiness = () => readUsdtDemandSchemaReadiness(database as unknown as Pool);
function realRepository() {
  const client = { query: (sql: string, values?: unknown[]) => database.query(sql, values), release() {} };
  return new AlphaExchangeRepository({ ...client, connect: async () => client, on() {} } as unknown as Pool);
}
async function counts() {
  const result = await database.query<{ demands: number; trades: number; notices: number; version: string }>(`select
    (select count(*)::int from alpha_exchange.usdt_demands) as demands,
    (select count(*)::int from alpha_exchange.purchase_requests) as trades,
    (select count(*)::int from alpha_exchange.notifications) as notices,
    (select version::text from alpha_exchange.runtime_meta) as version`);
  return result.rows[0];
}

describe("draft USDT PostgreSQL invariants", () => {
  it("keeps the standalone rollout review SQL identical to runtime schema and safely repeatable", async () => {
    const review = (await readFile("docs/sql/usdt-demand-schema-review.sql", "utf8")).replace(/\r\n/g, "\n");
    const body = review.split("-- BEGIN REVIEWED DEMAND SCHEMA\n")[1]?.split("-- END REVIEWED DEMAND SCHEMA")[0];
    const compact = (value: string) => value.replace(/\s+/g, " ").trim();
    expect(compact(body ?? "")).toBe(compact(`${USDT_DEMAND_SCHEMA_SQL.join(";\n")};`));
    const migration = await readFile("supabase/migrations/20261024024258_usdt_buy_requests.sql", "utf8");
    expect(compact(migration.split("-- BEGIN REVIEWED DEMAND SCHEMA\n")[1]?.split("-- END REVIEWED DEMAND SCHEMA")[0] ?? "")).toBe(compact(body ?? ""));
    await database.exec(review);
    const rows = await database.query<{ rls: boolean; client_access: boolean }>(`select
      (select relrowsecurity from pg_class where oid='alpha_exchange.usdt_demands'::regclass) as rls,
      has_table_privilege('anon','alpha_exchange.usdt_demands','select')
        or has_table_privilege('authenticated','alpha_exchange.usdt_demands','select') as client_access`);
    expect(rows.rows[0]).toEqual({ rls: true, client_access: false });
  });

  it("verifies the actual private table contract and trusted runtime role without reading records", async () => {
    expect(await readiness()).toEqual({ ready: true, issues: [] });
    await database.exec("begin");
    try {
      await database.exec("create role demand_runtime; grant usage on schema alpha_exchange to demand_runtime; grant select,insert,update,delete on alpha_exchange.usdt_demands to demand_runtime; set role demand_runtime");
      expect((await readiness()).issues).toEqual(["server_role_access"]);
      await database.exec("reset role; alter role demand_runtime bypassrls; set role demand_runtime");
      expect(await readiness()).toEqual({ ready: true, issues: [] });
    } finally { await database.exec("rollback; reset role"); }
  });

  it.each([
    ["drop index alpha_exchange.idx_usdt_demands_one_open; create index idx_usdt_demands_one_open on alpha_exchange.usdt_demands(requester_id)", "index_one_open"],
    ["alter table alpha_exchange.usdt_demands drop constraint usdt_demands_state_check; alter table alpha_exchange.usdt_demands add constraint usdt_demands_state_check check(state <> '')", "constraint_state"],
    ["alter table alpha_exchange.usdt_demands drop constraint usdt_demands_revision_check; alter table alpha_exchange.usdt_demands add constraint usdt_demands_revision_check check(revision > 0) not valid", "constraint_revision"],
    ["alter table alpha_exchange.usdt_demands alter column sort_index set default 1", "column_sort_index"],
    ["alter table alpha_exchange.usdt_demands disable row level security", "rls_disabled"],
    ["grant select(payload) on alpha_exchange.usdt_demands to anon", "client_privileges"],
    ["grant select on alpha_exchange.usdt_demands to public", "public_privileges"],
    ["create policy unsafe_read on alpha_exchange.usdt_demands for select using(true)", "unexpected_rls_policies"],
    ["create unique index unsafe_unique_state on alpha_exchange.usdt_demands(state)", "unexpected_unique_indexes"],
    ["create function alpha_exchange.discard_demand() returns trigger language plpgsql as 'begin return null; end'; create trigger discard_demand before insert on alpha_exchange.usdt_demands for each row execute function alpha_exchange.discard_demand()", "unexpected_triggers"],
    ["create rule discard_demand as on insert to alpha_exchange.usdt_demands do instead nothing", "unexpected_rules"],
  ])("rejects catalog drift even when the bootstrap sentinel remains: %s", async (sql, issue) => {
    await database.exec("begin");
    try {
      await database.exec(sql);
      expect((await readiness()).issues).toContain(issue);
      expect((await database.query("select to_regclass('alpha_exchange.idx_usdt_demands_owner') as sentinel")).rows[0]).toHaveProperty("sentinel", "alpha_exchange.idx_usdt_demands_owner");
    } finally { await database.exec("rollback"); }
    expect((await readiness()).ready).toBe(true);
  });

  it("checks a warm OFF-to-ON transition, fails closed without repairing grants, then recovers after reviewed repair", async () => {
    const repo = realRepository();
    await database.exec("grant select on alpha_exchange.usdt_demands to anon");
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0");
    await expect(repo.healthCheck()).resolves.toBe("ok");
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
    await expect(repo.healthCheck()).rejects.toThrow("database schema is not ready");
    expect((await readiness()).issues).toContain("client_privileges");
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0");
    await expect(repo.healthCheck()).resolves.toBe("ok");
    await database.exec("revoke all on alpha_exchange.usdt_demands from anon");
    vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
    await expect(repo.healthCheck()).resolves.toBe("ok");
  });

  it("upgrades only the known missing decimal check on an otherwise valid existing table", async () => {
    const d = sample(); await insert(d);
    await database.exec("alter table alpha_exchange.usdt_demands drop constraint usdt_demands_decimal_terms");
    expect((await readiness()).issues).toEqual(["decimal_terms_missing"]);
    await realRepository().ensureReady();
    expect((await readiness()).ready).toBe(true);
    expect((await counts()).demands).toBe(1);
  });

  it("does not repair existing demand privileges when its final bootstrap sentinel is missing", async () => {
    await database.exec("drop index alpha_exchange.idx_usdt_demands_owner; grant select on alpha_exchange.usdt_demands to anon");
    try {
      vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "0");
      const repo = realRepository();
      await expect(repo.healthCheck()).resolves.toBe("ok");
      expect((await readiness()).issues).toEqual(expect.arrayContaining(["index_owner", "client_privileges"]));
      vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
      await expect(repo.healthCheck()).rejects.toThrow("database schema is not ready");
    } finally {
      await database.exec("create index idx_usdt_demands_owner on alpha_exchange.usdt_demands(requester_id,updated_at desc); revoke all on alpha_exchange.usdt_demands from anon");
    }
  });

  it("does not upgrade invalid persisted decimals or silently replace a weak named check", async () => {
    await database.exec("begin");
    try {
      await database.exec("alter table alpha_exchange.usdt_demands drop constraint usdt_demands_decimal_terms");
      await insert(sample({ amount: "NaN" }));
      await expect(realRepository().ensureReady()).rejects.toThrow(/check constraint/);
    } finally { await database.exec("rollback"); }
    await database.exec("begin");
    try {
      await database.exec("alter table alpha_exchange.usdt_demands drop constraint usdt_demands_decimal_terms; alter table alpha_exchange.usdt_demands add constraint usdt_demands_decimal_terms check(revision>0)");
      await expect(realRepository().ensureReady()).rejects.toThrow("database schema is not ready");
      expect((await readiness()).issues).toContain("constraint_decimal_terms");
    } finally { await database.exec("rollback"); }
  });

  it("enforces one open request per account and durable publication idempotency", async () => {
    const first = sample(); await insert(first);
    await expect(insert(sample())).rejects.toThrow(/idx_usdt_demands_one_open/);
    const closed = { ...first, state: "cancelled" as const };
    await database.query("update alpha_exchange.usdt_demands set state='cancelled', payload=$2::jsonb where id=$1", [first.id, JSON.stringify(closed)]);
    await expect(insert(sample({ operationId: first.operationId }))).rejects.toThrow(/unique constraint/);
    await insert(sample()); expect((await counts()).demands).toBe(2);
  });

  it("rejects missing payload identity, inconsistent state, revision, amount and trade pointers", async () => {
    const d = sample();
    for (const payload of [{}, { ...d, id: "wrong" }, { ...d, state: "cancelled" }, { ...d, revision: 2 }, { ...d, amount: "0" }, { ...d, purchaseRequestId: "orphan" }]) {
      await expect(insert(d, payload)).rejects.toThrow(/check constraint/);
    }
    await expect(insert({ ...d, state: "matched" })).rejects.toThrow(/check constraint/);
    expect((await counts()).demands).toBe(0);
  });

  it("rejects non-finite numbers, exponent notation, numeric JSON and precision outside the API contract", async () => {
    const d = sample();
    for (const amount of ["NaN", "Infinity", "+Infinity", "1e3", "1000000000", "1.0000001", 1000]) {
      await expect(insert(d, { ...d, amount })).rejects.toThrow(/check constraint/);
    }
    for (const price of ["NaN", "Infinity", "+Infinity", "3.2e0", "10000", "3.201", 3.2]) {
      await expect(insert(d, { ...d, price })).rejects.toThrow(/check constraint/);
    }
    expect((await counts()).demands).toBe(0);
  });

  it("preserves the complete valid decimal range without rounding persisted terms", async () => {
    const d = sample({ amount: "999999999.999999", price: "9999.99" });
    await insert(d);
    const row = (await database.query<{ payload: UsdtDemand }>("select payload from alpha_exchange.usdt_demands where id=$1", [d.id])).rows[0];
    expect(row.payload.amount).toBe("999999999.999999");
    expect(row.payload.price).toBe("9999.99");
  });

  it("adds the decimal invariant to an existing draft table without replacing valid data", async () => {
    const d = sample();
    await insert(d);
    await database.exec("alter table alpha_exchange.usdt_demands drop constraint usdt_demands_decimal_terms");
    await database.exec(USDT_DEMAND_SCHEMA_SQL.join(";\n"));
    await database.exec(USDT_DEMAND_SCHEMA_SQL.join(";\n"));
    expect((await counts()).demands).toBe(1);
    await expect(insert(sample({ requesterId: "buyer-two", amount: "NaN" }))).rejects.toThrow(/usdt_demands_decimal_terms/);
    const row = (await database.query<{ payload: UsdtDemand }>("select payload from alpha_exchange.usdt_demands where id=$1", [d.id])).rows[0];
    expect(row.payload).toEqual(d);
  });

  it("prevents a purchase from being assigned to two matched requests", async () => {
    await insert(sample({ state: "matched", purchaseRequestId: "one-purchase" }));
    await expect(insert(sample({ requesterId: "buyer-two", state: "matched", purchaseRequestId: "one-purchase" }))).rejects.toThrow(/unique constraint/);
  });

  it("revokes client privileges and retains default-deny RLS even if a grant is added", async () => {
    const d = sample(); await insert(d);
    const privileges = await database.query<{ anon: boolean; authenticated: boolean; rls: boolean }>(`select
      has_table_privilege('anon','alpha_exchange.usdt_demands','select') as anon,
      has_table_privilege('authenticated','alpha_exchange.usdt_demands','select') as authenticated,
      (select relrowsecurity from pg_class where oid='alpha_exchange.usdt_demands'::regclass) as rls`);
    expect(privileges.rows[0]).toEqual({ anon: false, authenticated: false, rls: true });
    await database.exec("set role anon");
    await expect(database.query("select * from alpha_exchange.usdt_demands")).rejects.toThrow(/permission denied/);
    await database.exec("reset role; grant select, insert, update on alpha_exchange.usdt_demands to authenticated; set role authenticated");
    expect((await database.query("select * from alpha_exchange.usdt_demands")).rows).toHaveLength(0);
    await expect(insert(sample({ requesterId: "buyer-two" }))).rejects.toThrow(/row-level security/);
    expect((await database.query("update alpha_exchange.usdt_demands set revision=2 returning id")).rows).toHaveLength(0);
  });

  it("rolls back request and notices together on persistence failure, then retries safely", async () => {
    const body = { terms: demandTestTerms(), operationId: randomUUID() };
    await database.exec("alter table alpha_exchange.notifications add constraint injected_failure check(false)");
    const failed = await repository.beginTradeLifecycleTransaction(tables);
    try {
      createDemand(failed!.snapshot, "buyer", body, demandTestMarket());
      await expect(failed!.commit(failed!.snapshot, { selectedTables: ["usdt_demands", "notifications"] })).rejects.toThrow(/injected_failure/);
    } finally { await failed!.close(); }
    expect(await counts()).toEqual({ demands: 0, trades: 0, notices: 0, version: "0" });
    await database.exec("alter table alpha_exchange.notifications drop constraint injected_failure");
    const retry = await repository.beginTradeLifecycleTransaction(tables);
    try {
      createDemand(retry!.snapshot, "buyer", body, demandTestMarket());
      await retry!.commit(retry!.snapshot, { selectedTables: ["usdt_demands", "notifications"] });
    } finally { await retry!.close(); }
    expect(await counts()).toEqual({ demands: 1, trades: 0, notices: 2, version: "1" });
  });

  it("rolls back the trade when the matched request fails to persist, keeping its response available", async () => {
    const setup = await repository.beginTradeLifecycleTransaction(tables);
    let d!: UsdtDemand;
    let offerId!: string;
    try {
      d = createDemand(setup!.snapshot, "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket());
      offerId = respondToDemand(setup!.snapshot, "seller", d.id, { listingId: "listing-seller", revision: d.revision, price: d.price, operationId: randomUUID() }, demandTestMarket()).id;
      await setup!.commit(setup!.snapshot, { selectedTables: ["usdt_demands", "notifications"] });
    } finally { await setup!.close(); }
    await database.exec("alter table alpha_exchange.usdt_demands add constraint injected_failure check(state <> 'matched')");
    const match = await repository.beginTradeLifecycleTransaction(tables);
    try {
      const now = new Date().toISOString();
      const trade = { id: "draft-purchase", listingId: "listing-seller", buyerId: "buyer", sellerId: "seller", status: "pending", usdtAmount: d.amount,
        pricePerUsdt: d.price, feePolicyVersion: "buyer_seller_1pct_v1", createdAt: now, updatedAt: now, usdtDemandId: d.id, usdtDemandOfferId: offerId } as PurchaseRequest;
      match!.snapshot.purchaseRequests.push(trade);
      commitDemandMatch(match!.snapshot, { buyerId: "buyer", demandId: d.id, offerId, revision: 1, listingId: trade.listingId, amount: d.amount, paymentMethod: d.paymentMethod, network: d.network }, demandTestMarket(), trade);
      await expect(match!.commit(match!.snapshot, { selectedTables: ["purchase_requests", "usdt_demands"] })).rejects.toThrow(/injected_failure/);
    } finally { await match!.close(); }
    expect(await counts()).toEqual({ demands: 1, trades: 0, notices: 3, version: "1" });
    const row = (await database.query<{ payload: UsdtDemand }>("select payload from alpha_exchange.usdt_demands where id=$1", [d.id])).rows[0].payload;
    expect(row.state).toBe("open"); expect(row.offers[0].state).toBe("open"); expect(row.purchaseRequestId).toBeUndefined();
  });
});
