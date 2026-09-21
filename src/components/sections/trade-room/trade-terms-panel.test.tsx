import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TradeTermsPanel } from "./trade-terms-panel";
import type { PurchaseRequest } from "@/types/alpha-exchange";

const base = { id: "request-1", buyerId: "buyer", sellerId: "seller", status: "pending", priceMode: "buyer_offer", pricePerUsdt: "3.00", usdtAmount: "250", fiatAmount: "750.00", currency: "ILS", paymentMethod: "Bank Transfer", updatedAt: "2026-09-21T00:00:00Z" } as PurchaseRequest;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("trade proposal controls", () => {
  it("sends a counter-offer from the seller's current request", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ request: base }) });
    vi.stubGlobal("fetch", fetch);
    const updated = vi.fn();
    render(<TradeTermsPanel request={base} actorId="seller" isAr={false} onUpdated={updated} />);
    fireEvent.change(screen.getByLabelText("Counter price in ILS per USDT"), { target: { value: "3.10" } });
    fireEvent.click(screen.getByRole("button", { name: "Send counter-offer" }));
    await waitFor(() => expect(updated).toHaveBeenCalledWith(base));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: "counter_offer", value: "3.10", expectedUpdatedAt: base.updatedAt });
  });
  it("shows the exact proposal and accepts its ID, without a new request", async () => {
    const request = { ...base, termsProposal: { id: "offer-2", kind: "counter_offer" as const, status: "pending" as const, usdtAmount: "250.125", pricePerUsdt: "3.10", fiatAmount: "775.39", createdAt: base.updatedAt } };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ request }) }); vi.stubGlobal("fetch", fetch);
    render(<TradeTermsPanel request={request} actorId="buyer" isAr={false} onUpdated={vi.fn()} />);
    expect(screen.getByText(/250.125 USDT/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept these terms" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: "accept_counter_offer", proposalId: "offer-2" });
  });
  it("hides corrections after USDT is sent", () => {
    const { container } = render(<TradeTermsPanel request={{ ...base, status: "usdt_sent" }} actorId="seller" isAr={false} onUpdated={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
