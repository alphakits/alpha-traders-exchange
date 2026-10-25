import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import * as repositoryModule from "@/lib/alpha-exchange-repository";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "@/lib/alpha-exchange-identity";
import { updatePurchaseRequestStatus } from "@/lib/alpha-exchange-store";
import { publicAccountId } from "@/lib/public-account-identity";
import { getSnapshotIdentityUsers } from "@/lib/alpha-exchange-identity-directory";

const participantScopedStatuses = ["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "completed"] as const;

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
  it.each([...participantScopedStatuses, undefined])("%s retains the whole request collection and its participants while legacy numbering is incomplete", async nextStatus => {
    await db.exec("update alpha_exchange.purchase_requests set payload = payload - 'displayNumber' where id='unrelated'");
    const accounts = ["seller-a", "buyer-a", "seller-b", "buyer-b", "seller-c", "buyer-c", "caller"];
    for (const [index, id] of accounts.entries()) {
      await db.query("insert into alpha_exchange.users values ($1,$2,$3)", [id, index, JSON.stringify({ id, role: "buyer" })]);
    }
    const tx = (await repository.beginTradeLifecycleTransaction(["users", "purchase_requests"], "target", nextStatus, "caller"))!;
    try {
      expect(tx.snapshot.purchaseRequests.map(request => request.id)).toEqual(["target", "seller-capacity", "buyer-other-seller", "unrelated"]);
      expect(tx.snapshot.users.map(user => user.id)).toEqual(accounts);
    } finally { await tx.close(); }
  });
  it("acknowledges a committed completion with one read-only request and cannot write through that retry", async () => {
    await db.exec("update alpha_exchange.purchase_requests set status='completed', payload=jsonb_set(payload,'{status}','\"completed\"') where id='target'");
    const tx = (await repository.beginTradeLifecycleTransaction(["purchase_requests"], "target", "completed"))!;
    expect(tx.snapshot.purchaseRequests.map(request => request.id)).toEqual(["target"]);
    await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).rejects.toThrow("read-only lifecycle retry");
    await tx.close();
  });
  it.each(["accepted", "payment_sent", "usdt_release_pending", "usdt_sent"])("receipt reads at %s retain related history without using a status-only retry", async status => {
    await db.query("update alpha_exchange.purchase_requests set status=$1, payload=jsonb_set(payload,'{status}',to_jsonb($1::text)) where id='target'", [status]);
    const tx = (await repository.beginTradeLifecycleTransaction(["purchase_requests"], "target", undefined, "buyer-a"))!;
    try {
      expect(tx.snapshot.purchaseRequests.map(request => request.id)).toEqual(["target", "seller-capacity", "buyer-other-seller"]);
      // Even an already-advanced status must leave the locked transaction
      // available for the receipt store to validate content identity itself.
      await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).resolves.toBeUndefined();
    } finally { await tx.close(); }
    expect((await db.query("select id from alpha_exchange.purchase_requests order by sort_index")).rows).toHaveLength(4);
  });
  it.each(participantScopedStatuses)("%s retries mask unrelated account names in retained trade text", async status => {
    const accounts = [
      { id: "seller-a", role: "approved_seller", fullName: "Trade Seller" },
      { id: "buyer-a", role: "buyer", fullName: "Trade Buyer" },
      { id: "unrelated", role: "buyer", fullName: "Maya Chen", buyerDisplayName: "Maya OTC" },
      { id: "email-owner", role: "buyer", email: ` ${ALPHA_EXCHANGE_OWNER_EMAIL.toUpperCase()} `, fullName: "Legacy Owner" },
      { id: "role-owner", role: "owner", fullName: "Public Owner" },
      { id: "disabled-owner", role: "owner", fullName: "Hidden Owner", disabled: true },
    ];
    for (const [index, user] of accounts.entries()) {
      await db.query("insert into alpha_exchange.users values ($1,$2,$3)", [user.id, index, JSON.stringify(user)]);
    }
    await db.query(`update alpha_exchange.purchase_requests
      set status=$1, payload=payload || $2::jsonb where id='target'`, [status, JSON.stringify({
      status, paymentMethod: "Bank Transfer", buyerName: "Trade Buyer",
      timeline: [{ id: "historical-event", type: "payment_sent", message: "Maya Chen sent 800 ILS with Legacy Owner, Public Owner and Hidden Owner", createdAt: "2026-10-20T00:00:00.000Z" }],
      messages: [{ id: "historical-message", message: "Maya OTC confirmed the amount", senderUserId: "seller-a", createdAt: "2026-10-20T00:00:00.000Z" }],
    })]);
    // Exercise the real canonical SQL and store response projection. The
    // committed retry needs only these two table fixtures to reach that path.
    const getRepository = vi.spyOn(repositoryModule, "getAlphaExchangeRepository").mockResolvedValue({
      beginTradeLifecycleTransaction: (_tables, requestId, nextStatus, actorUserId) => repository.beginTradeLifecycleTransaction(["users", "purchase_requests"], requestId, nextStatus, actorUserId),
    } as AlphaExchangeRepository);
    try {
      const result = await updatePurchaseRequestStatus({ requestId: "target", actorUserId: status === "payment_sent" ? "buyer-a" : "seller-a", actorRole: status === "payment_sent" ? "buyer" : "approved_seller", nextStatus: status,
        ...(status === "completed" ? { completionMode: "seller" as const } : {}) });
      expect(result.statusChanged).toBe(false);
      expect(result.request.timeline[0].message).toBe(`${publicAccountId(accounts[2])} sent 800 ILS with Legacy Owner, Public Owner and ${publicAccountId(accounts[5])}`);
      expect(result.request.messages?.[0].message).toBe(`${publicAccountId(accounts[2])} confirmed the amount`);
    } finally { getRepository.mockRestore(); }
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

  it.each([...participantScopedStatuses, undefined])("%s retains related counterparties and every canonical admin/owner without unrelated account payloads", async nextStatus => {
    const accounts = [
      { id: "seller-a", role: "approved_seller" },
      { id: "buyer-a", role: "buyer" },
      { id: "buyer-b", role: "buyer", disabled: true },
      { id: "seller-b", role: "approved_seller" },
      { id: "role-admin", role: "admin" },
      { id: "roles-admin", role: "buyer", roles: ["admin"] },
      { id: "roles-owner", role: "buyer", roles: ["owner"] },
      { id: "email-owner", role: "buyer", email: ` ${ALPHA_EXCHANGE_OWNER_EMAIL.toUpperCase()} ` },
      { id: "unrelated", role: "buyer", fullName: "Maya Chen", buyerDisplayName: "Maya OTC", passwordHash: "private-password-hash", sellerBankAccounts: [{ accountNumber: "private-bank-number" }] },
      { id: "disabled-caller", role: "buyer", disabled: true },
    ];
    for (const [index, user] of accounts.entries()) {
      await db.query("insert into alpha_exchange.users values ($1,$2,$3)", [user.id, index, JSON.stringify(user)]);
    }
    const tx = (await repository.beginTradeLifecycleTransaction(["users", "purchase_requests"], "target", nextStatus, "disabled-caller"))!;
    try {
      expect(tx.snapshot.users).toEqual(accounts.filter(user => user.id !== "unrelated"));
      const identities = getSnapshotIdentityUsers(tx.snapshot);
      expect(identities.find(user => user.id === "unrelated")).toMatchObject({ id: "unrelated", fullName: "Maya Chen", buyerDisplayName: "Maya OTC" });
      expect(JSON.stringify(identities)).not.toMatch(/private-password-hash|private-bank-number/);
      expect(JSON.stringify(tx.snapshot)).not.toMatch(/Maya|private-password-hash|private-bank-number/);
      await expect(tx.commit(tx.snapshot, { selectedTables: ["users"] })).rejects.toThrow("unsupported lifecycle write table");
    } finally { await tx.close(); }
    expect((await db.query<{ payload: unknown }>("select payload from alpha_exchange.users order by sort_index")).rows.map(row => row.payload)).toEqual(accounts);
  });

  it.each(participantScopedStatuses)("%s keeps the full authority collection for legacy callers without an actor ID", async nextStatus => {
    const accounts = [{ id: "seller-a", role: "approved_seller" }, { id: "unrelated", role: "buyer" }];
    for (const [index, user] of accounts.entries()) {
      await db.query("insert into alpha_exchange.users values ($1,$2,$3)", [user.id, index, JSON.stringify(user)]);
    }
    const tx = (await repository.beginTradeLifecycleTransaction(["users", "purchase_requests"], "target", nextStatus))!;
    try { expect(tx.snapshot.users).toEqual(accounts); }
    finally { await tx.close(); }
  });

  it.each(["cancelled", "declined", "locked", "review_open"] as const)("%s keeps the full authority collection outside the audited progress scope", async nextStatus => {
    const accounts = [{ id: "seller-a", role: "approved_seller" }, { id: "unrelated", role: "buyer" }];
    for (const [index, user] of accounts.entries()) {
      await db.query("insert into alpha_exchange.users values ($1,$2,$3)", [user.id, index, JSON.stringify(user)]);
    }
    const tx = (await repository.beginTradeLifecycleTransaction(["users", "purchase_requests"], "target", nextStatus, "seller-a"))!;
    try { expect(tx.snapshot.users).toEqual(accounts); }
    finally { await tx.close(); }
  });
});
