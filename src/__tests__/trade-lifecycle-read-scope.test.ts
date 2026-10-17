import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "@/lib/alpha-exchange-identity";

describe("PostgreSQL lifecycle request dependencies", () => {
  let db: PGlite;
  let repository: AlphaExchangeRepository;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create schema alpha_exchange;
      create table alpha_exchange.runtime_meta (singleton boolean, version bigint);
      insert into alpha_exchange.runtime_meta values (true, 1);
      create table alpha_exchange.purchase_requests
        (id text primary key, seller_id text, buyer_id text, status text, sort_index bigint, payload jsonb);
      create table alpha_exchange.seller_profiles (sort_index bigint, payload jsonb);
      create table alpha_exchange.seller_settings (sort_index bigint, payload jsonb);
      create table alpha_exchange.users (id text primary key, sort_index bigint, payload jsonb);`);
    const client = { query: (sql: string, parameters?: unknown[]) => db.query(sql, parameters), release: () => {} };
    repository = new AlphaExchangeRepository({ connect: async () => client } as unknown as Pool);
    vi.spyOn(repository, "ensureReady").mockResolvedValue();
  });
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.exec("delete from alpha_exchange.purchase_requests; delete from alpha_exchange.users");
    const rows = [
      ["target", "seller-a", "buyer-a"],
      ["seller-capacity", "seller-a", "buyer-b"],
      ["buyer-other-seller", "seller-b", "buyer-a"],
      ["unrelated", "seller-c", "buyer-c"],
    ];
    for (const [index, [id, sellerId, buyerId]] of rows.entries()) {
      const payload = { id, sellerId, buyerId, status: "pending", displayNumber: index + 1 };
      await db.query("insert into alpha_exchange.purchase_requests values ($1,$2,$3,'pending',$4,$5)",
        [id, sellerId, buyerId, index, JSON.stringify(payload)]);
    }
  });
  it("retains seller capacity and the buyer's trades with other sellers without loading unrelated histories", async () => {
    const tx = (await repository.beginTradeLifecycleTransaction(["purchase_requests"], "target", "accepted"))!;
    expect(tx.snapshot.purchaseRequests.map(request => request.id)).toEqual(["target", "seller-capacity", "buyer-other-seller"]);
    await tx.close();
    expect((await db.query("select id from alpha_exchange.purchase_requests order by sort_index")).rows).toHaveLength(4);
  });
  it("retains the whole collection while a legacy request still needs a global display number", async () => {
    await db.exec("update alpha_exchange.purchase_requests set payload = payload - 'displayNumber' where id='unrelated'");
    const tx = (await repository.beginTradeLifecycleTransaction(["purchase_requests"], "target", "accepted"))!;
    expect(tx.snapshot.purchaseRequests.map(request => request.id)).toEqual(["target", "seller-capacity", "buyer-other-seller", "unrelated"]);
    await tx.close();
  });
  it("acknowledges a committed completion with one read-only request and cannot write through that retry", async () => {
    await db.exec("update alpha_exchange.purchase_requests set status='completed', payload=jsonb_set(payload,'{status}','\"completed\"') where id='target'");
    const tx = (await repository.beginTradeLifecycleTransaction(["purchase_requests"], "target", "completed"))!;
    expect(tx.snapshot.purchaseRequests.map(request => request.id)).toEqual(["target"]);
    await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).rejects.toThrow("read-only lifecycle retry");
    await tx.close();
  });
  it.each([{ ageMs: 0, deferred: true }, { ageMs: 45_000, deferred: false }])(
    "gives active financial requests priority without starving overdue trust work ($ageMs ms old)", async ({ ageMs, deferred }) => {
      await db.query("update alpha_exchange.purchase_requests set payload = jsonb_set(payload, '{trustReconciliation}', $1::jsonb) where id='target'",
        [JSON.stringify({ requestedAt: new Date(Date.now() - ageMs).toISOString() })]);
      // Keep the global financial lock free: a duplicate or pooled lifecycle
      // request can still be pending in the per-request lock namespace.
      await db.query("select pg_advisory_lock(61422919, hashtext($1))", ["target"]);
      try {
        const tx = (await repository.beginTradeTrustTransaction(["purchase_requests"]))!;
        try { expect(tx.snapshot.purchaseRequests.length === 0).toBe(deferred); }
        finally { await tx.close(); }
        const result = await db.query<{ payload: { trustReconciliation: { reconciledAt?: string } } }>("select payload from alpha_exchange.purchase_requests where id='target'");
        expect(result.rows[0].payload.trustReconciliation.reconciledAt).toBeUndefined();
      } finally {
        await db.query("select pg_advisory_unlock(61422919, hashtext($1))", ["target"]);
      }
    });
  it.each(["pending", "completed"])("retains caller and participant authority during completion (%s)", async status => {
    for (const [index, id] of ["seller-a", "buyer-a", "owner-caller", "unrelated"].entries()) {
      await db.query("insert into alpha_exchange.users values ($1,$2,$3)",
        [id, index, JSON.stringify({ id, role: id === "owner-caller" ? "owner" : "buyer", disabled: id === "owner-caller" })]);
    }
    await db.query("update alpha_exchange.purchase_requests set status=$1, payload=jsonb_set(payload,'{status}',to_jsonb($1::text)) where id='target'", [status]);
    const tx = (await repository.beginTradeLifecycleTransaction(["users", "purchase_requests"], "target", "completed", "owner-caller"))!;
    try {
      expect(tx.snapshot.users.map(user => user.id)).toEqual(["seller-a", "buyer-a", "owner-caller"]);
      expect(tx.snapshot.users.find(user => user.id === "owner-caller")).toMatchObject({ role: "owner", disabled: true });
    } finally { await tx.close(); }
    expect((await db.query("select id from alpha_exchange.users")).rows).toHaveLength(4);
  });

  it.each(["accepted", "completed"] as const)("%s retains related counterparties and every canonical admin/owner without unrelated account payloads", async nextStatus => {
    const accounts = [
      { id: "seller-a", role: "approved_seller" },
      { id: "buyer-a", role: "buyer" },
      { id: "buyer-b", role: "buyer", disabled: true },
      { id: "seller-b", role: "approved_seller" },
      { id: "role-admin", role: "admin" },
      { id: "roles-admin", role: "buyer", roles: ["admin"] },
      { id: "roles-owner", role: "buyer", roles: ["owner"] },
      { id: "email-owner", role: "buyer", email: ` ${ALPHA_EXCHANGE_OWNER_EMAIL.toUpperCase()} ` },
      { id: "unrelated", role: "buyer" },
      { id: "disabled-caller", role: "buyer", disabled: true },
    ];
    for (const [index, user] of accounts.entries()) {
      await db.query("insert into alpha_exchange.users values ($1,$2,$3)", [user.id, index, JSON.stringify(user)]);
    }
    const tx = (await repository.beginTradeLifecycleTransaction(["users", "purchase_requests"], "target", nextStatus, "disabled-caller"))!;
    try {
      expect(tx.snapshot.users).toEqual(accounts.filter(user => user.id !== "unrelated"));
      await expect(tx.commit(tx.snapshot, { selectedTables: ["users"] })).rejects.toThrow("unsupported lifecycle write table");
    } finally { await tx.close(); }
    expect((await db.query<{ payload: unknown }>("select payload from alpha_exchange.users order by sort_index")).rows.map(row => row.payload)).toEqual(accounts);
    const payment = (await repository.beginTradeLifecycleTransaction(["users", "purchase_requests"], "target", "payment_sent", "seller-a"))!;
    try { expect(payment.snapshot.users).toEqual(accounts); }
    finally { await payment.close(); }
  });
});
