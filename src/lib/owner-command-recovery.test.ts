import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeOwnerAccountCommand } from "./owner-account-command";
import { executeOwnerRankBatch } from "./owner-rank-batch";
import { readOwnerDashboardJson } from "./owner-dashboard-read";
import { beginOwnerPendingOperation, finishOwnerPendingOperation, readOwnerPendingOperations } from "./owner-pending-operation";
const target = { id: "seller", fullName: "Private test name", role: "buyer", roles: ["buyer"], sellerStatus: "buyer" };
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());
it("persists an unresolved command without private names, reasons or a replayable request", () => {
  const operation = beginOwnerPendingOperation({ targetId: target.id, command: "disable" });
  expect(readOwnerPendingOperations()).toEqual([operation]);
  expect(() => beginOwnerPendingOperation({ targetId: target.id, command: "rank", value: "gold" })).toThrow();
  finishOwnerPendingOperation(operation.id, "unknown");
  expect(readOwnerPendingOperations()[0].outcome).toBe("unknown");
  expect(sessionStorage.getItem("alpha-owner-pending-operations-v1")).not.toContain(target.fullName);
  finishOwnerPendingOperation(operation.id, "clear");
  finishOwnerPendingOperation(operation.id, "saved");
  expect(readOwnerPendingOperations()).toEqual([]);
});
it("returns unknown at the deadline even if a response body ignores abort; late data never resubmits", async () => {
  vi.useFakeTimers(); let complete!: (value: unknown) => void;
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(resolve => { complete = resolve; }) });
  const pending = executeOwnerAccountCommand(target, "disable", "Test reason", undefined, fetcher, 20);
  await vi.advanceTimersByTimeAsync(21);
  const outcome = await pending;
  expect(outcome).toEqual({ outcome: "unknown", code: "timeout" });
  complete({ success: true }); await Promise.resolve();
  expect(outcome.outcome).toBe("unknown"); expect(fetcher).toHaveBeenCalledOnce();
});
it("distinguishes pre-mutation rejection from a legacy 400 after mutation entry", async () => {
  const call = (body: unknown) => executeOwnerAccountCommand(target, "disable", "Test reason", undefined, vi.fn().mockResolvedValue(Response.json(body, { status: 400 })));
  expect((await call({ error: "connection failed after commit" })).outcome).toBe("unknown");
  expect((await call({ code: "owner_command_validation", commandOutcome: "rejected", mutationAttempted: false })).outcome).toBe("rejected");
  expect((await call({ code: "owner_command_validation", commandOutcome: "rejected", mutationAttempted: true })).outcome).toBe("unknown");
});
it("stops the batch after an uncertain write and does not treat a matching rank as a success receipt", async () => {
  const targets = ["first", "second"].map(id => ({ ...target, id, sellerPrestigeRank: "bronze" }));
  const fetcher = vi.fn().mockRejectedValue(new Error("connection lost"));
  const result = await executeOwnerRankBatch(targets, "set", "Test reason", "gold", { fetcher, refresh: async () => targets.map(row => ({ ...row, sellerPrestigeRank: "gold" })) });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(result.items.map(row => row.outcome)).toEqual(["unknown", "not_attempted"]);
  expect(result.complete).toBe(false);
});
it("requires canonical readback after successful rank responses", async () => {
  const seller = { ...target, sellerPrestigeRank: "bronze" };
  const fetcher = vi.fn().mockResolvedValue(Response.json({ seller: { ...seller, sellerPrestigeRank: "gold" } }));
  const result = await executeOwnerRankBatch([seller], "set", "Test reason", "gold", { fetcher, refresh: async () => [seller] });
  expect(result.savedUnverified).toBe(1); expect(result.verified).toBe(0);
});
it("does not start another rank write after its dashboard is unmounted", async () => {
  const targets = ["first", "second"].map(id => ({ ...target, id, sellerPrestigeRank: "bronze" }));
  let active = true;
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
  const refresh = vi.fn();
  const pending = executeOwnerRankBatch(targets, "set", "Test reason", "gold", { fetcher, refresh, isActive: () => active });
  active = false;
  resolve(Response.json({ seller: { ...targets[0], sellerPrestigeRank: "gold" } }));
  const result = await pending;
  expect(result.items.map(row => row.outcome)).toEqual(["saved_unverified", "not_attempted"]);
  expect(fetcher).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
});
it("verifies clearing an override against automatic state, not the old rank", async () => {
  const seller = { ...target, sellerPrestigeRank: "gold", sellerRankOverride: { rank: "gold" } };
  const automatic = { ...target, sellerPrestigeRank: "bronze" };
  const fetcher = vi.fn().mockResolvedValue(Response.json({ seller: automatic }));
  const result = await executeOwnerRankBatch([seller], "set", "Return to automatic", "gold", { fetcher, clearOverride: true, refresh: async () => [automatic] });
  expect(result.verified).toBe(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ clearOverride: true });
});
it("bounds read bodies and does not wait for an authorization error body", async () => {
  const json = vi.fn(() => new Promise(() => {}));
  const denied = await readOwnerDashboardJson("/api/alpha-exchange/admin-prep", vi.fn().mockResolvedValue({ ok: false, status: 401, json }));
  expect(denied.status).toBe(401); expect(json).not.toHaveBeenCalled();
  vi.useFakeTimers();
  const pending = readOwnerDashboardJson("/api/alpha-exchange/admin-prep", vi.fn().mockResolvedValue({ ok: true, status: 200, json }), 20);
  const assertion = expect(pending).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(21); await assertion;
});
