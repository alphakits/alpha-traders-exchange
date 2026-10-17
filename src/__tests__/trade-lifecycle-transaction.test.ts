import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const at = "2026-10-17T00:00:00.000Z";
const request = (id: string) => ({ id, buyerId: "buyer", sellerId: "seller", listingId: "listing", status: "pending", createdAt: at, updatedAt: at });
function fixture(fail?: (sql: string) => Error | undefined) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    void values;
    const error = fail?.(sql);
    if (error) throw error;
    if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: true, overdue: false }] } as never;
    if (sql.includes("as version") && sql.includes("json_agg")) return { rows: [{
      version: "12",
      read_only_retry: false,
      purchase_requests: [
        { payload: request("first"), sort_index: -8 },
        { payload: request("target"), sort_index: 7 },
        { payload: request("last"), sort_index: 20 },
      ],
      audit_logs: [{ payload: { id: "old-audit", action: "purchase_completed", actorUserId: "seller", createdAt: at }, sort_index: -9 }],
      notifications: [],
      sort_bounds: { audit_logs: { minimum: -50, maximum: 20 }, notifications: { minimum: -30, maximum: 40 } },
    }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const repo = new AlphaExchangeRepository({ connect: vi.fn().mockResolvedValue({ query, release }), query: vi.fn(), on: vi.fn() } as unknown as Pool);
  vi.spyOn(repo, "ensureReady").mockResolvedValue();
  return { repo, query, release };
}

describe("canonical trade lifecycle transaction", () => {
  it("rechecks a duplicate after its request lock without joining the global mutation queue", async () => {
    const { repo, query, release } = fixture();
    const original = query.getMockImplementation()!;
    let reads = 0;
    query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes("pg_try_advisory_xact_lock(61422919")) return { rows: [{ acquired: false }] } as never;
      const result = await original(sql, values);
      if (sql.includes("json_agg") && ++reads === 2) Object.assign(result.rows[0], { read_only_retry: true });
      return result;
    });
    const tx = (await repo.beginTradeLifecycleTransaction(["users", "purchase_requests", "notifications"], "target", "completed"))!;
    expect(query).toHaveBeenCalledWith("select pg_advisory_xact_lock(61422919, hashtext($1))", ["target"]);
    expect(query.mock.calls.some(([sql]) => sql === "select pg_advisory_xact_lock(61422917)")).toBe(false);
    await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).rejects.toThrow("read-only lifecycle retry");
    await tx.close();
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("rechecks canonical state under the mutation lock without an extra snapshot for an uncontested request", async () => {
    const { repo, query } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["users", "purchase_requests"], "target", "accepted"))!;
    const sql = query.mock.calls.map(([statement]) => statement);
    expect(sql.filter(statement => statement.includes("json_agg"))).toHaveLength(2);
    expect(sql.some(statement => statement === "select pg_advisory_xact_lock(61422919, hashtext($1))")).toBe(false);
    expect(sql.indexOf("select pg_advisory_xact_lock(61422917)")).toBeLessThan(sql.findLastIndex(statement => statement.includes("json_agg")));
    await tx.close();
  });
  it("reads after obtaining the cross-instance lock and persists only changed rows with stable ordering", async () => {
    const { repo, query, release } = fixture();
    const tx = await repo.beginTradeLifecycleTransaction(["purchase_requests", "audit_logs", "notifications"]);
    expect(tx).not.toBeNull();
    const snapshot = tx!.snapshot;
    expect(snapshot.purchaseRequests.map(row => row.id)).toEqual(["first", "target", "last"]);
    snapshot.purchaseRequests[1].status = "accepted";
    snapshot.auditLogs.unshift({ id: "new-audit", action: "purchase_completed", actorUserId: "seller", createdAt: at } as AlphaExchangeDb["auditLogs"][number]);
    await tx!.commit(snapshot, { selectedTables: ["purchase_requests", "audit_logs", "notifications"] });
    await tx!.close();
    const sql = query.mock.calls.map(call => call[0]);
    expect(sql.indexOf("select pg_advisory_xact_lock(61422917)")).toBeLessThan(sql.findIndex(text => text.includes("json_agg")));
    const requestWrite = query.mock.calls.find(call => call[0].startsWith("INSERT INTO alpha_exchange.purchase_requests"))!;
    expect(requestWrite[1]?.[0]).toEqual(["target"]);
    expect(requestWrite[1]?.[10]).toEqual(["7"]);
    const auditWrite = query.mock.calls.find(call => call[0].startsWith("INSERT INTO alpha_exchange.audit_logs"))!;
    expect(auditWrite[1]?.[0]).toEqual(["new-audit"]);
    expect(auditWrite[1]?.[7]).toEqual(["-51"]);
    expect(sql.some(text => text.startsWith("delete"))).toBe(false);
    expect(sql.some(text => text.startsWith("INSERT INTO alpha_exchange.notifications"))).toBe(false);
    expect(sql.at(-1)).toBe("commit");
    expect((snapshot as unknown as { __runtimeVersion: number }).__runtimeVersion).toBe(13);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("makes an unchanged retry a no-op and releases the transaction", async () => {
    const { repo, query, release } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    await tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] });
    await tx.close();
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete)\b/i.test(sql))).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("scopes historical events to the trade while preserving global business dependencies", async () => {
    const { repo, query } = fixture();
    const id = "trade-id-with-'quotes";
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests", "users", "commissions", "notifications", "audit_logs", "sms_deliveries", "activity_logs", "evidence"], id))!;
    const read = query.mock.calls.find(([sql]) => sql.includes("json_agg"))!;
    expect(read[1]).toEqual([id]);
    expect(read[0]).not.toContain(id);
    for (const table of ["users", "purchase_requests", "commissions"]) expect(read[0]).toContain(`from alpha_exchange.${table} ),`);
    expect(read[0]).toContain("payload->>'relatedRequestId' = $1");
    expect(read[0]).toContain("starts_with(event_key, 'trade:' || $1 || ':')");
    expect(read[0]).toContain("min(sort_index)");
    await tx.close();
  });

  it("does not rewrite canonical tables when another process already finished the reconciliation", async () => {
    const { repo, query } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    const incoming = tx.snapshot;
    await tx.close();
    query.mockClear();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("json_agg")) return { rows: [{ version: "13", purchase_requests: [request("first"), request("target"), request("last")] }] } as never;
      if (sql.includes("select version::text")) return { rows: [{ version: "13" }] } as never;
      return { rows: [] };
    });
    await repo.saveSnapshot(incoming, { selectedTables: ["purchase_requests"], rebaseTables: ["purchase_requests"], rebaseOnLatest: snapshot => snapshot });
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete)\b/i.test(sql))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql === "commit")).toBe(true);
    expect((incoming as unknown as { __runtimeVersion: number }).__runtimeVersion).toBe(13);
  });

  it("cannot turn a lightweight retry read into a state-changing commit", async () => {
    const { repo, query } = fixture();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, values?: unknown[]) => {
      const result = await original(sql, values);
      if (result.rows[0]) Object.assign(result.rows[0], { read_only_retry: true });
      return result;
    });
    const tx = (await repo.beginTradeLifecycleTransaction(["users", "purchase_requests", "notifications", "commissions", "listings", "trust_snapshots"], "target", "completed"))!;
    await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).rejects.toThrow("read-only lifecycle retry");
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete)\b/i.test(sql))).toBe(false);
    expect(query.mock.calls.some(([sql]) => /begin|rollback|pg_advisory_xact_lock/.test(sql))).toBe(false);
    const probe = query.mock.calls.find(([sql]) => sql.includes("json_agg"))![0];
    for (const table of ["notifications", "commissions", "listings", "trust_snapshots"]) expect(probe).not.toContain(`alpha_exchange.${table}`);
  });

  it("does not rewrite rows for JSON key order or omitted undefined fields", async () => {
    const { repo, query } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    tx.snapshot.purchaseRequests = tx.snapshot.purchaseRequests.map(row => Object.assign({ status: row.status }, row, { tradeId: undefined }));
    await tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] });
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete)\b/i.test(sql))).toBe(false);
  });

  it("reindexes a changed order without deleting retained trades", async () => {
    const { repo, query } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    tx.snapshot.purchaseRequests.reverse();
    await tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] });
    const write = query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO alpha_exchange.purchase_requests"))!;
    expect(write[1]?.[0]).toEqual(["last", "target", "first"]);
    expect(write[1]?.[10]).toEqual(["0", "1", "2"]);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("delete"))).toBe(false);
  });

  it("deletes only the explicitly removed row", async () => {
    const { repo, query } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    tx.snapshot.purchaseRequests.splice(1, 1);
    await tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] });
    expect(query).toHaveBeenCalledWith("delete from alpha_exchange.purchase_requests where id = any($1::text[])", [["target"]]);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });

  it("destroys a connection when rollback itself fails", async () => {
    const { repo, release } = fixture(sql => sql === "rollback" ? new Error("connection lost") : undefined);
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    await tx.close();
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("rolls back an abandoned early-return transaction exactly once", async () => {
    const { repo, query, release } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    await tx.close();
    await tx.close();
    expect(query.mock.calls.filter(([sql]) => sql === "rollback")).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
    await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).rejects.toThrow("closed");
  });

  it("validates the final financial snapshot before any row is written", async () => {
    const { repo, query, release } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    tx.snapshot.purchaseRequests[1].status = "accepted";
    await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"], validateBeforeCommit: () => { throw new Error("commission intent collision"); } })).rejects.toThrow("commission intent collision");
    await tx.close();
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete)\b/i.test(sql))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql === "commit")).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(["users", "sessions", "commissions"] as const)("rejects an undeclared or unsupported write to %s", async table => {
    const { repo } = fixture();
    const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
    await expect(tx.commit(tx.snapshot, { selectedTables: [table] })).rejects.toThrow("lifecycle");
    await tx.close();
  });

  it.each(["begin", "lock", "read", "commit"])("cleans up a failed %s without returning an uncertain socket to the pool", async stage => {
    const { repo, query, release } = fixture(sql => (
      (stage === "begin" && sql === "begin") || (stage === "lock" && sql.includes("pg_advisory_xact_lock"))
      || (stage === "read" && sql.includes("json_agg")) || (stage === "commit" && sql === "commit")
    ) ? new Error("Query read timeout") : undefined);
    if (stage === "commit") {
      const tx = (await repo.beginTradeLifecycleTransaction(["purchase_requests"]))!;
      tx.snapshot.purchaseRequests[1].status = "accepted";
      await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).rejects.toThrow("Query read timeout");
      await tx.close();
      expect((tx.snapshot as unknown as { __runtimeVersion: number }).__runtimeVersion).toBe(12);
    } else await expect(repo.beginTradeLifecycleTransaction(["purchase_requests"])).rejects.toThrow("Query read timeout");
    expect(query.mock.calls.some(([sql]) => sql === "rollback")).toBe(false);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
  });
});


describe("durable trade trust transaction", () => {
  function trustFixture(pending = true) {
    const setup = fixture();
    const original = setup.query.getMockImplementation()!;
    setup.query.mockImplementation(async (sql, values) => {
      const result = await original(sql, values);
      if (result.rows[0]) Object.assign(result.rows[0], {
        has_pending_trust: pending,
        users: [{ payload: { id: "seller", email: "seller@example.test", role: "approved_seller", disabled: true,
          passwordHash: "latest-password", createdAt: at, updatedAt: at }, sort_index: 8 }],
        trust_snapshots: [{ payload: { sellerId: "seller", snapshot: { trustScore: 50 }, updatedAt: at }, sort_index: 5 }],
        seller_profiles: [], seller_settings: [],
      });
      return result;
    });
    return setup;
  }

  it.each([false, true])("yields fresh trust work but queues an overdue intent (overdue=%s)", async overdue => {
    const { repo, query, release } = trustFixture();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql, values) => sql.includes("pg_try_advisory_xact_lock")
      ? { rows: [{ acquired: false, overdue }] } as never : original(sql, values));
    const tx = (await repo.beginTradeTrustTransaction(["users", "purchase_requests"]))!;
    if (!overdue) {
      expect(tx.snapshot.purchaseRequests).toEqual([]);
      await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).rejects.toThrow("did not acquire");
      expect(query.mock.calls.some(([sql]) => sql.includes("json_agg"))).toBe(false);
    }
    expect(query.mock.calls.some(([sql]) => sql === "select pg_advisory_xact_lock(61422917)")).toBe(overdue);
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete)\b/i.test(sql))).toBe(false);
    await tx.close();
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("updates only the derived account fields without deleting accounts or sessions", async () => {
    const { repo, query } = trustFixture();
    const tx = (await repo.beginTradeTrustTransaction(["users", "purchase_requests"]))!;
    tx.snapshot.users[0].lifetimeCompletedVolumeUsdt = 250;
    await tx.commit(tx.snapshot, { selectedTables: ["users", "seller_profiles", "seller_settings"] });
    const write = query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO alpha_exchange.users"))!;
    expect(write[0]).toContain("ON CONFLICT (id) DO UPDATE");
    expect(write[1]?.[8]).toEqual(["8"]);
    expect(JSON.parse((write[1]?.[9] as string[])[0])).toMatchObject({ disabled: true, passwordHash: "latest-password", lifetimeCompletedVolumeUsdt: 250 });
    expect(query.mock.calls.some(([sql]) => /delete from alpha_exchange.users|alpha_exchange.sessions/.test(sql))).toBe(false);
    const profile = query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO alpha_exchange.seller_profiles"))!;
    expect(profile[1]?.[0]).toEqual(["seller"]);
    const settings = query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO alpha_exchange.seller_settings"))!;
    expect(settings[1]?.[0]).toEqual(["seller"]);
  });

  it("replaces a changed trust snapshot by seller identity and preserves its order", async () => {
    const { repo, query } = trustFixture();
    const tx = (await repo.beginTradeTrustTransaction(["users", "purchase_requests", "trust_snapshots"]))!;
    tx.snapshot.trustSnapshots[0].snapshot.trustScore = 60;
    await tx.commit(tx.snapshot, { selectedTables: ["trust_snapshots"] });
    expect(query).toHaveBeenCalledWith("delete from alpha_exchange.trust_snapshots where seller_id = any($1::text[])", [["seller"]]);
    const write = query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO alpha_exchange.trust_snapshots"))!;
    expect(write[1]?.[0]).toEqual(["seller"]);
    expect(write[1]?.[2]).toEqual(["5"]);
  });

  it("refuses to delete an account during derived trust work", async () => {
    const { repo, query, release } = trustFixture();
    const tx = (await repo.beginTradeTrustTransaction(["users", "purchase_requests"]))!;
    tx.snapshot.users = [];
    await expect(tx.commit(tx.snapshot, { selectedTables: ["users"] })).rejects.toThrow("cannot delete accounts");
    expect(query.mock.calls.some(([sql]) => sql.startsWith("delete"))).toBe(false);
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("does not allow an already-consumed intent to produce another write", async () => {
    const { repo, query } = trustFixture(false);
    const tx = (await repo.beginTradeTrustTransaction(["users", "purchase_requests"]))!;
    await expect(tx.commit(tx.snapshot, { selectedTables: ["purchase_requests"] })).rejects.toThrow("No pending trust");
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete)\b/i.test(sql))).toBe(false);
  });

  it("cannot modify financial obligations through trust reconciliation", async () => {
    const { repo, query } = trustFixture();
    const tx = (await repo.beginTradeTrustTransaction(["users", "purchase_requests", "commissions"]))!;
    await expect(tx.commit(tx.snapshot, { selectedTables: ["commissions"] })).rejects.toThrow("unsupported lifecycle");
    expect(query.mock.calls.some(([sql]) => /^(insert|update|delete)\b/i.test(sql))).toBe(false);
  });
});
