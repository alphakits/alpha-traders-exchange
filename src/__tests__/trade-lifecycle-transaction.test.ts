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
    if (sql.includes("as version") && sql.includes("json_agg")) return { rows: [{
      version: "12",
      purchase_requests: [
        { payload: request("first"), sort_index: -8 },
        { payload: request("target"), sort_index: 7 },
        { payload: request("last"), sort_index: 20 },
      ],
      audit_logs: [{ payload: { id: "old-audit", action: "purchase_completed", actorUserId: "seller", createdAt: at }, sort_index: -9 }],
      notifications: [],
    }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const repo = new AlphaExchangeRepository({ connect: vi.fn().mockResolvedValue({ query, release }), query: vi.fn(), on: vi.fn() } as unknown as Pool);
  vi.spyOn(repo, "ensureReady").mockResolvedValue();
  return { repo, query, release };
}

describe("canonical trade lifecycle transaction", () => {
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
    expect(auditWrite[1]?.[7]).toEqual(["-10"]);
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
