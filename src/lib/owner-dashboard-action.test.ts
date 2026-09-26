import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgesOwnerDashboardAction, executeOwnerDashboardAction, prepareOwnerDashboardAction } from "./owner-dashboard-action";
import { finishOwnerPendingOperation, readOwnerPendingOperations } from "./owner-pending-operation";

const request = prepareOwnerDashboardAction("/api/alpha-exchange/admin/listings/listing-1", { method: "PATCH", body: JSON.stringify({ action: "approve" }) });
describe("owner dashboard single-attempt actions", () => {
  beforeEach(() => sessionStorage.clear());
  it("persists before sending, blocks a duplicate, and retains the acknowledgment for readback", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => {
      expect(readOwnerPendingOperations()[0].outcome).toBe("pending");
      return new Promise<Response>(done => { resolve = done; });
    });
    const first = executeOwnerDashboardAction(request, fetcher);
    expect((await executeOwnerDashboardAction(request, fetcher)).outcome).toBe("blocked");
    resolve(Response.json({ listing: { id: "listing-1" } }));
    expect((await first).outcome).toBe("saved");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readOwnerPendingOperations()[0].outcome).toBe("saved");
    expect(JSON.stringify(readOwnerPendingOperations())).not.toContain("approve");
  });
  it.each([{}, { listing: { id: "someone-else" } }, { success: true }, null, []])("does not accept an unrelated or malformed success body: %j", async payload => {
    expect((await executeOwnerDashboardAction(request, vi.fn(async () => Response.json(payload)))).outcome).toBe("unknown");
    expect(readOwnerPendingOperations()[0].outcome).toBe("unknown");
  });
  it("times out a stalled response body, retains uncertainty, and ignores late completion", async () => {
    let resolveBody!: (value: unknown) => void;
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(done => { resolveBody = done; }) }) as Response);
    const result = await executeOwnerDashboardAction(request, fetcher, 10);
    expect(result.outcome).toBe("unknown");
    finishOwnerPendingOperation(result.operation!.id, "clear");
    resolveBody({ listing: { id: "listing-1" } });
    await Promise.resolve();
    expect(readOwnerPendingOperations()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves an uncertain transport failure across a new executor without replay", async () => {
    const fetcher = vi.fn(async () => { throw new Error("lost response"); });
    expect((await executeOwnerDashboardAction(request, fetcher)).outcome).toBe("unknown");
    expect((await executeOwnerDashboardAction(request, fetcher)).outcome).toBe("blocked");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429])("releases a request rejected at the authorization/throttle gate (%s)", async status => {
    expect((await executeOwnerDashboardAction(request, vi.fn(async () => new Response(null, { status })))).outcome).toBe("rejected");
    expect(readOwnerPendingOperations()).toEqual([]);
  });
  it("does not misrepresent a legacy HTTP 400 as rollback", async () => {
    expect((await executeOwnerDashboardAction(request, vi.fn(async () => Response.json({ error: "write failed" }, { status: 400 })))).outcome).toBe("unknown");
  });
  it("sends nothing when recovery storage is unavailable", async () => {
    sessionStorage.setItem("alpha-owner-pending-operations-v1", "corrupt");
    const fetcher = vi.fn();
    expect((await executeOwnerDashboardAction(request, fetcher)).outcome).toBe("blocked");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires the endpoint-specific acknowledgment for email and destructive actions", () => {
    const email = prepareOwnerDashboardAction("/api/alpha-exchange/admin/seller-applications/app-1/approval-email", { method: "POST" });
    expect(acknowledgesOwnerDashboardAction(email, { success: true })).toBe(false);
    expect(acknowledgesOwnerDashboardAction(email, { status: "accepted_for_delivery" })).toBe(true);
    expect(acknowledgesOwnerDashboardAction({ ...request, init: { method: "DELETE" } }, { success: true })).toBe(true);
    expect(acknowledgesOwnerDashboardAction({ ...request, init: { method: "DELETE" } }, { success: false })).toBe(false);
  });
  it("distinguishes a completed reverification from a verified payment", async () => {
    const reverify = prepareOwnerDashboardAction("/api/alpha-exchange/admin/commissions/fee-1/reverify", { method: "POST" });
    const result = await executeOwnerDashboardAction(reverify, vi.fn(async () => Response.json({ success: false, notes: "Receipt pending" })));
    expect(result.outcome).toBe("saved");
    expect(result.payload?.success).toBe(false);
    expect(acknowledgesOwnerDashboardAction(reverify, { success: true })).toBe(false);
  });
});
