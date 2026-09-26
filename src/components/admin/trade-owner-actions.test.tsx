import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeOwnerActions } from "./trade-owner-actions";
import type { PurchaseRequest, TradeDisputeCase } from "@/types/alpha-exchange";

const trade = (status: PurchaseRequest["status"] = "accepted") => ({ id: "trade-1", status, timeline: [] } as unknown as PurchaseRequest);
const disabled = (name: string) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
beforeEach(() => sessionStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });
const snapshot = () => Response.json({ request: trade("completed"), hasOpenDispute: false, ownerHistory: { disputes: [] } });

describe("owner trade actions", () => {
  it("explains why completion is unavailable while a terms proposal is pending", () => {
    const request = { ...trade(), termsProposal: { status: "pending" } } as PurchaseRequest;
    render(<TradeOwnerActions locale="en" isOwner request={request} onUpdated={vi.fn()} />);
    expect(disabled("Mark as completed")).toBe(true);
    expect(screen.getByText(/pending amount or price proposal/)).toBeTruthy();
  });
  it.each(["completed", "review_open", "locked"] as const)("keeps controls visible on %s and allows closing without completing twice", status => {
    render(<TradeOwnerActions locale="en" isOwner request={trade(status)} onUpdated={vi.fn()} />);
    expect(disabled("Mark as completed")).toBe(true);
    expect(disabled("Force close trade")).toBe(false);
    expect(disabled("Unlock Review")).toBe(false);
    expect(screen.getByText(/Already completed/)).toBeTruthy();
  });

  it.each(["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const)("allows completion but prevents cancellation after %s", status => {
    render(<TradeOwnerActions locale="en" isOwner request={trade(status)} onUpdated={vi.fn()} />);
    expect(disabled("Mark as completed")).toBe(false);
    expect(disabled("Force close trade")).toBe(true);
    expect(disabled("Unlock Review")).toBe(true);
  });

  it("requires an in-page reason, blocks duplicate clicks and refreshes after completion", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; })).mockImplementation(async () => snapshot());
    vi.stubGlobal("fetch", fetchMock);
    const updated = vi.fn();
    render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={updated} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as completed" }));
    expect(disabled("Confirm action")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "  Delivery verified  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/alpha-exchange/admin/purchase-requests/trade-1/force-complete", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "Delivery verified" }) }));
    resolve(Response.json({ success: true }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status").textContent).toContain("Action saved");
  });

  it("retains an uncertain closure and verifies with a read instead of replaying the write", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Connection interrupted")).mockImplementation(async () => snapshot());
    vi.stubGlobal("fetch", fetchMock);
    const updated = vi.fn();
    render(<TradeOwnerActions locale="en" isOwner request={trade("review_open")} onUpdated={updated} />);
    fireEvent.click(screen.getByRole("button", { name: "Force close trade" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Owner reviewed history" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("Owner reviewed history");
    expect(disabled("Confirm action")).toBe(true);
    expect(disabled("Verify current state")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Verify current state" }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/alpha-exchange/admin/purchase-requests/trade-1/force-close");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/alpha-exchange/trade-room/trade-1?view=history");
    expect(fetchMock.mock.calls[1][1].method).toBeUndefined();
    expect(screen.getByRole("status").textContent).toContain("No action was repeated");
  });

  it("requires dispute resolution before trade actions and refreshes the parent", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ dispute: { id: "dispute-1", status: "resolved" } })).mockImplementation(async () => snapshot());
    vi.stubGlobal("fetch", fetchMock);
    const updated = vi.fn();
    const dispute = { id: "dispute-1", reason: "Check payment", status: "open" } as TradeDisputeCase;
    render(<TradeOwnerActions locale="en" isOwner request={trade()} openDispute={dispute} onUpdated={updated} />);
    expect(disabled("Mark as completed")).toBe(true);
    expect(disabled("Force close trade")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Resolve Dispute" }));
    fireEvent.change(screen.getByLabelText("Resolution notes"), { target: { value: "Payment verified" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/alpha-exchange/admin/disputes/dispute-1/resolve", expect.objectContaining({ body: JSON.stringify({ resolutionNotes: "Payment verified" }) }));
  });

  it("keeps Arabic controls available and does not offer owner closure to ordinary admins", () => {
    render(<TradeOwnerActions locale="ar" isOwner={false} request={trade("completed")} onUpdated={vi.fn()} />);
    expect(disabled("إغلاق الصفقة إجباريًا")).toBe(true);
    expect(disabled("فتح التقييم")).toBe(false);
  });
});


describe("trade action uncertainty recovery", () => {
  function confirmCompletion() {
    fireEvent.click(screen.getByRole("button", { name: "Mark as completed" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Verified delivery" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
  }

  it("keeps a saved action protected when readback fails, including after remount", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ success: true })).mockRejectedValueOnce(new Error("Offline")).mockImplementation(async () => snapshot());
    vi.stubGlobal("fetch", fetchMock);
    const updated = vi.fn();
    const view = render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={updated} />);
    confirmCompletion();
    await screen.findByRole("alert");
    expect(screen.getByRole("status").textContent).toBe("Action saved.");
    expect(disabled("Mark as completed")).toBe(true);
    view.unmount();
    render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={updated} />);
    expect(disabled("Mark as completed")).toBe(true);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Verify current state" }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });

  it("retains a saved receipt after navigation without updating an unmounted page", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => snapshot());
    vi.stubGlobal("fetch", fetchMock);
    const updated = vi.fn();
    const view = render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={updated} />);
    confirmCompletion();
    view.unmount();
    finish(Response.json({ success: true }));
    await waitFor(() => expect(sessionStorage.getItem("alpha-pending-trade-action:trade-1")).toContain('"outcome":"saved"'));
    expect(updated).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={updated} />);
    expect(disabled("Mark as completed")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Verify current state" }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });

  it("keeps completion protected when a fresh read does not yet confirm completion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json({ request: trade("accepted"), hasOpenDispute: false })));
    render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={vi.fn()} />);
    confirmCompletion();
    await screen.findByRole("alert");
    expect(disabled("Mark as completed")).toBe(true);
    expect(sessionStorage.getItem("alpha-pending-trade-action:trade-1")).toContain('"outcome":"saved"');
  });

  it("does not accept malformed success as a saved receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: false })));
    const updated = vi.fn();
    render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={updated} />);
    confirmCompletion();
    await screen.findByRole("alert");
    expect(screen.queryByRole("status")).toBeNull();
    expect(disabled("Mark as completed")).toBe(true);
    expect(updated).not.toHaveBeenCalled();
  });

  it("requires the exact trade on readback and blocks further changes after access loss", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ request: { id: "other", status: "completed" }, hasOpenDispute: false }))
      .mockResolvedValueOnce(Response.json({}, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={vi.fn()} />);
    confirmCompletion();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Verify current state" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Verify current state" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Mark as completed" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, options]) => options.method === "POST")).toHaveLength(1);
  });

  it("sends nothing if session recovery storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<TradeOwnerActions locale="en" isOwner request={trade()} onUpdated={vi.fn()} />);
    confirmCompletion();
    await screen.findByRole("alert");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
