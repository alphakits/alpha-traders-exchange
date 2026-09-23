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
    fireEvent.click(screen.getByRole("button", { name: "Make a counter-offer" }));
    fireEvent.change(screen.getByLabelText("Counter price in ILS per USDT"), { target: { value: "3.10" } });
    fireEvent.click(screen.getByRole("button", { name: "Send counter-offer" }));
    await waitFor(() => expect(updated).toHaveBeenCalledWith(base));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: "counter_offer", value: "3.10", expectedUpdatedAt: base.updatedAt });
  });
  it("shows the exact proposal and accepts its ID, without a new request", async () => {
    const request = { ...base, termsProposal: { id: "offer-2", kind: "counter_offer" as const, status: "pending" as const, usdtAmount: "250.125", pricePerUsdt: "3.10", fiatAmount: "775.39", createdAt: base.updatedAt } };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ request }) }); vi.stubGlobal("fetch", fetch);
    render(<TradeTermsPanel request={request} actorId="buyer" isAr={false} onUpdated={vi.fn()} />);
    expect(screen.getByText((_, element) => element?.tagName === "P" && /250.125 USDT/.test(element.textContent ?? ""))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept these terms" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: "accept_counter_offer", proposalId: "offer-2" });
  });
  it("explains why correction is locked after USDT is sent", () => {
    render(<TradeTermsPanel request={{ ...base, status: "usdt_sent" }} actorId="seller" isAr={false} onUpdated={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Adjust Amount" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText((_, element) => element?.tagName === "P" && /USDT release has started/.test(element.textContent ?? ""))).toBeTruthy();
  });
});


it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("proposes a correction and requires buyer approval for %s", async (paymentMethod) => {
  const request = { ...base, status: "accepted" as const, priceMode: "listing_price" as const, paymentMethod };
  const proposed = { ...request, termsProposal: { id: "amount-1", kind: "amount_correction" as const, status: "pending" as const, usdtAmount: "300", fiatAmount: "900.00", pricePerUsdt: "3.00", createdAt: request.updatedAt } };
  const fetch = vi.fn().mockResolvedValue(Response.json({ request: proposed }));
  vi.stubGlobal("fetch", fetch);
  const updated = vi.fn();
  const { rerender } = render(<TradeTermsPanel request={request} actorId="seller" isAr={false} onUpdated={updated} />);
  fireEvent.click(screen.getByRole("button", { name: "Adjust Amount" }));
  fireEvent.change(screen.getByLabelText("Correct USDT amount"), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "Propose corrected amount" }));
  await waitFor(() => expect(updated).toHaveBeenCalledWith(proposed));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: "propose_amount", value: "300", expectedUpdatedAt: request.updatedAt });
  rerender(<TradeTermsPanel request={proposed} actorId="buyer" isAr={false} onUpdated={updated} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept these terms" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ action: "accept_amount", proposalId: "amount-1" });
});

it("does not submit a correction while another trade mutation owns the lock", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  render(<TradeTermsPanel request={{ ...base, status: "accepted" }} actorId="seller" isAr={false} onUpdated={vi.fn()} onBusyChange={() => false} />);
  fireEvent.click(screen.getByRole("button", { name: "Adjust Amount" }));
  fireEvent.change(screen.getByLabelText("Correct USDT amount"), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "Propose corrected amount" }));
  expect(fetch).not.toHaveBeenCalled();
});
