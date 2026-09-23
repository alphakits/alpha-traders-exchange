import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TradeOwnerActions } from "./trade-owner-actions";
import type { PurchaseRequest, TradeDisputeCase } from "@/types/alpha-exchange";

const trade = (status: PurchaseRequest["status"] = "accepted") => ({ id: "trade-1", status, timeline: [] } as unknown as PurchaseRequest);
const disabled = (name: string) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
    const fetchMock = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
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

  it("uses owner closure for completed trades and preserves form input after a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const updated = vi.fn();
    render(<TradeOwnerActions locale="en" isOwner request={trade("review_open")} onUpdated={updated} />);
    fireEvent.click(screen.getByRole("button", { name: "Force close trade" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Owner reviewed history" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("Owner reviewed history");
    expect(updated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm action" }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/alpha-exchange/admin/purchase-requests/trade-1/force-close");
  });

  it("requires dispute resolution before trade actions and refreshes the parent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true }));
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
