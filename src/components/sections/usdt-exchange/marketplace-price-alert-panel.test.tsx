import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketplacePriceAlertPanel } from "./marketplace-price-alert-panel";
const preference = { enabled: true, maxPrice: "3.50", minUsdt: "200", paymentMethod: "Bank Transfer" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("account price-alert controls", () => {
  it("only enables saving after the owning account's preferences are confirmed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ownerId: "another-account", preference })));
    render(<MarketplacePriceAlertPanel userId="buyer-a" isAr={false} />);
    expect(screen.getByRole("button", { name: "Save alert" }).closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("More"));
    await screen.findByText(/Could not load/);
    expect((screen.getByRole("button", { name: "Save alert" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Maximum price (₪ / USDT)") as HTMLInputElement).value).toBe("");
  });
  it("saves once and requires a reload when the mutation result is uncertain", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ ownerId: "buyer-a", preference }))).mockRejectedValue(new Error("lost response"));
    render(<MarketplacePriceAlertPanel userId="buyer-a" isAr={false} />);
    expect(screen.getByRole("button", { name: "Save alert" }).closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("More"));
    const button = screen.getByRole("button", { name: "Save alert" }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText(/Saving could not be confirmed/);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });
  it("discards a delayed read when the account changes", async () => {
    let finish!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(new Response(JSON.stringify({ ownerId: "buyer-b", preference: { ...preference, maxPrice: "3.00" } })));
    const { rerender } = render(<MarketplacePriceAlertPanel key="buyer-a" userId="buyer-a" isAr={false} />);
    rerender(<MarketplacePriceAlertPanel key="buyer-b" userId="buyer-b" isAr={false} />);
    fireEvent.click(screen.getByText("More"));
    await waitFor(() => expect((screen.getByLabelText("Maximum price (₪ / USDT)") as HTMLInputElement).value).toBe("3.00"));
    await act(async () => { finish(new Response(JSON.stringify({ ownerId: "buyer-a", preference }))); });
    expect((screen.getByLabelText("Maximum price (₪ / USDT)") as HTMLInputElement).value).toBe("3.00");
  });
  it("renders the same accessible settings in Arabic", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ownerId: "buyer-a", preference })));
    render(<MarketplacePriceAlertPanel userId="buyer-a" isAr />);
    fireEvent.click(screen.getByText("المزيد"));
    await waitFor(() => expect((screen.getByRole("button", { name: "حفظ التنبيه" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("أعلى سعر (₪ / USDT)") as HTMLInputElement).value).toBe("3.50");
  });
});
