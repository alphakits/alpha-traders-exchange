import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPendingTradeAction, executeTradeOwnerAction, isTradeActionInFlight, readPendingTradeAction } from "./owner-trade-action";
const input = { tradeId: "trade-1", action: "force-complete" as const, isOwner: true, reason: "Private delivery reason" };
beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe("persistent trade action execution", () => {
  it("records opaque metadata before sending and blocks another surface until readback", async () => {
    const fetcher = vi.fn().mockImplementation(async () => {
      expect(readPendingTradeAction(input.tradeId)?.outcome).toBe("pending");
      expect(sessionStorage.getItem("alpha-pending-trade-action:trade-1")).not.toContain(input.reason);
      return Response.json({ success: true });
    });
    await expect(executeTradeOwnerAction(input, fetcher)).resolves.toEqual({ outcome: "saved" });
    await expect(executeTradeOwnerAction(input, fetcher)).resolves.toEqual({ outcome: "blocked" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const saved = readPendingTradeAction(input.tradeId)!;
    expect(saved.outcome).toBe("saved");
    clearPendingTradeAction(input.tradeId, saved.id);
    expect(readPendingTradeAction(input.tradeId)).toBeNull();
  });
  it.each(["fetch", "body"])("bounds a stalled %s and preserves uncertainty without replay", async stage => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const fetcher = vi.fn().mockImplementation(() => stage === "fetch" ? never : Promise.resolve({ ok: true, status: 200, json: () => never }));
    const operation = executeTradeOwnerAction(input, fetcher, 100);
    const marker = readPendingTradeAction(input.tradeId)!;
    expect(isTradeActionInFlight(input.tradeId)).toBe(true);
    expect(() => clearPendingTradeAction(input.tradeId, marker.id)).toThrow("still running");
    await expect(executeTradeOwnerAction(input, fetcher)).resolves.toEqual({ outcome: "blocked" });
    await vi.advanceTimersByTimeAsync(100);
    await expect(operation).resolves.toEqual({ outcome: "unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(readPendingTradeAction(input.tradeId)?.outcome).toBe("unknown");
    expect(isTradeActionInFlight(input.tradeId)).toBe(false);
  });
  it.each([{}, { success: false }, { success: "true" }, { success: true, error: "failed" }])("does not accept an invalid acknowledgement %j", async payload => {
    await expect(executeTradeOwnerAction(input, vi.fn().mockResolvedValue(Response.json(payload)))).resolves.toEqual({ outcome: "unknown" });
  });
  it.each([400, 404, 500])("does not treat legacy HTTP %s as proof of rollback", async status => {
    await expect(executeTradeOwnerAction(input, vi.fn().mockResolvedValue(Response.json({ error: "Failure" }, { status })))).resolves.toEqual({ outcome: "unknown" });
    expect(readPendingTradeAction(input.tradeId)).not.toBeNull();
  });
  it.each([401, 403, 429])("clears a rejected request at the HTTP %s gate without reading its body", async status => {
    const json = vi.fn(() => new Promise(() => {}));
    await expect(executeTradeOwnerAction(input, vi.fn().mockResolvedValue({ ok: false, status, json }))).resolves.toEqual({ outcome: "rejected" });
    expect(json).not.toHaveBeenCalled();
    expect(readPendingTradeAction(input.tradeId)).toBeNull();
  });
  it.each([
    [{ dispute: { id: "dispute-1", status: "resolved" } }, "saved"],
    [{ success: true }, "unknown"],
    [{ dispute: { id: "wrong", status: "resolved" } }, "unknown"],
    [{ dispute: { id: "dispute-1", status: "open" } }, "unknown"],
  ])("validates the resolved dispute's identity and status", async (payload, outcome) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(payload));
    await expect(executeTradeOwnerAction({ ...input, action: "resolve-dispute", disputeId: "dispute-1" }, fetcher)).resolves.toEqual({ outcome });
    expect(fetcher.mock.calls[0][0]).toBe("/api/alpha-exchange/admin/disputes/dispute-1/resolve");
  });
  it("keeps ordinary admin cancellation on its existing route", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true }));
    await executeTradeOwnerAction({ ...input, action: "force-close", isOwner: false }, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe("/api/alpha-exchange/admin/purchase-requests/trade-1/force-cancel");
  });
  it("fails closed with corrupted storage before any request", async () => {
    sessionStorage.setItem("alpha-pending-trade-action:trade-1", "broken");
    const fetcher = vi.fn();
    await expect(executeTradeOwnerAction(input, fetcher)).resolves.toEqual({ outcome: "blocked" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
