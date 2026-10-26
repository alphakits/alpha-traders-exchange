import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateCardlessUsdtAmount } from "@alpha-traders/contracts";
import type { ComponentProps } from "react";
import type { DemandView } from "@/types/usdt-demand";
import { SellerResponseForm } from "./usdt-response-form";

vi.mock("@/i18n/navigation", () => ({ Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
const now = Date.parse("2026-10-24T12:00:00.000Z");
const current = (): DemandView => ({ id: "demand-one", requesterName: "AT-100", amount: "5000", price: "3.20", network: "TRC20", paymentMethod: "Bank Transfer", city: "",
  revision: 1, state: "open", isMine: false, expiresAt: new Date(now + 86_400_000).toISOString(), updatedAt: new Date(now).toISOString(), offers: [] });
const props = (): ComponentProps<typeof SellerResponseForm> => ({ ar: false, current: current(), listings: [{ id: "listing-one", amount: "10000", price: "3.20" }],
  reference: { price: "3.20", minimum: "2.85", maximum: "3.55" }, listingId: "listing-one", offerPrice: "3.20", onListingChange: vi.fn(), onPriceChange: vi.fn(), busy: false, ready: true, now, onSubmit: vi.fn() });
const submitButton = () => screen.getByRole("button", { name: /^(Send|Update) response$/ }) as HTMLButtonElement;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("seller response form", () => {
  it.each([["2.74", true], ["2.75", false], ["3.45", false], ["3.46", true]])("enforces the live 3.10 band for response price %s", (offerPrice, disabled) => {
    const input = { ...props(), offerPrice: String(offerPrice), reference: { price: "3.10", minimum: "2.75", maximum: "3.45" } };
    render(<SellerResponseForm {...input} />);
    expect(submitButton().disabled).toBe(disabled);
    fireEvent.submit(screen.getByRole("form", { name: "Seller response" }));
    expect(input.onSubmit).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });
  it("shows grouped available stock and the exact inclusive payment preview", () => {
    const input = props(); render(<SellerResponseForm {...input} />);
    expect(screen.getByRole("option", { name: "10,000 USDT · ₪3.20 per USDT" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Buyer payment preview" }).textContent).toContain("₪16,160.00");
    expect(submitButton().disabled).toBe(false);
    fireEvent.submit(screen.getByRole("form", { name: "Seller response" }));
    expect(input.onSubmit).toHaveBeenCalledOnce();
  });

  it.each(["0", "3.201", "3.", "2.84", "3.56"])("blocks invalid or out-of-band price %s, including programmatic submit", offerPrice => {
    const input = { ...props(), offerPrice }; render(<SellerResponseForm {...input} />);
    expect(submitButton().disabled).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Seller response" }));
    expect(input.onSubmit).not.toHaveBeenCalled();
  });

  it("honors native form validation before calling the mutation handler", () => {
    const input = props(); render(<SellerResponseForm {...input} />);
    const form = screen.getByRole("form", { name: "Seller response" }) as HTMLFormElement;
    vi.spyOn(form, "reportValidity").mockReturnValue(false);
    fireEvent.submit(form); expect(input.onSubmit).not.toHaveBeenCalled();
  });

  it.each(["3.201", "1,23", "3.20 USDT"])("keeps invalid pasted price %s visible and never submits the earlier valid price", pasted => {
    const input = props(); render(<SellerResponseForm {...input} />);
    const field = screen.getByLabelText("Your response price (ILS)") as HTMLInputElement;
    field.setSelectionRange(0, field.value.length);
    fireEvent.paste(field, { clipboardData: { getData: () => pasted } });
    expect(field.value).toBe(pasted);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.checkValidity()).toBe(false);
    expect(input.onPriceChange).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "Seller response" }));
    expect(input.onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Match requested price/ }));
    const corrected = screen.getByLabelText("Your response price (ILS)") as HTMLInputElement;
    expect(corrected.value).toBe("3.20");
    expect(corrected.checkValidity()).toBe(true);
    fireEvent.submit(screen.getByRole("form", { name: "Seller response" }));
    expect(input.onSubmit).toHaveBeenCalledOnce();
  });

  it("requires a current pinned listing selection and a fresh reference", () => {
    const input = props(); const view = render(<SellerResponseForm {...input} ready={false} />);
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText("Select an eligible listing for the current request to continue.")).toBeTruthy();
    view.rerender(<SellerResponseForm {...input} reference={null} />);
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText(/Waiting for a fresh price reference/)).toBeTruthy();
  });

  it("requires a compatible inclusive ATM total and lets the seller match the requested price", () => {
    const input = props();
    input.current = { ...input.current, paymentMethod: "Cardless ATM Withdrawal", amount: calculateCardlessUsdtAmount("5000", "3.20", true)! };
    const view = render(<SellerResponseForm {...input} offerPrice="3.10" />);
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText(/At this price,/).textContent).toContain("must be ₪100–₪10,000");
    fireEvent.click(screen.getByRole("button", { name: /Match requested price/ }));
    expect(input.onPriceChange).toHaveBeenCalledWith("3.20");
    view.rerender(<SellerResponseForm {...input} offerPrice="3.20" />);
    expect(submitButton().disabled).toBe(false);
    expect(screen.getByRole("region", { name: "Buyer payment preview" }).textContent).toContain("₪5,000.00");
  });

  it("counts withdrawn responses toward the same 60-second cooldown", () => {
    const input = props();
    input.current.offers = [
      { id: "open", listingId: "listing-one", sellerName: "AT-200", price: "3.20", revision: 1, state: "open", isMine: true, available: true, createdAt: new Date(now - 120_000).toISOString() },
      { id: "withdrawn", listingId: "listing-one", sellerName: "AT-200", price: "3.20", revision: 1, state: "withdrawn", isMine: true, available: false, createdAt: new Date(now - 45_000).toISOString() },
    ];
    const view = render(<SellerResponseForm {...input} />);
    expect(screen.getByRole("heading", { name: "Respond to this request" })).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText("You can send another response in 15 seconds.")).toBeTruthy();
    view.rerender(<SellerResponseForm {...input} now={now + 15_000} />);
    expect(submitButton().disabled).toBe(false);
  });

  it("uses update labels when the latest own response is still open", () => {
    const input = props();
    input.current.offers = [{ id: "open", listingId: "listing-one", sellerName: "AT-200", price: "3.20", revision: 1, state: "open", isMine: true, available: true, createdAt: new Date(now - 120_000).toISOString() }];
    render(<SellerResponseForm {...input} />);
    expect(screen.getByRole("heading", { name: "Update your response" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update response" })).toBeTruthy();
  });

  it("ignores rival response timestamps and rejects expired requests", () => {
    const input = props();
    input.current.offers = [{ id: "rival", listingId: "other-listing", sellerName: "AT-300", price: "3.20", revision: 1, state: "open", isMine: false, available: true, createdAt: new Date(now).toISOString() }];
    const view = render(<SellerResponseForm {...input} />);
    expect(submitButton().disabled).toBe(false);
    view.rerender(<SellerResponseForm {...input} now={Date.parse(input.current.expiresAt)} />);
    expect(submitButton().disabled).toBe(true);
  });

  it("gives concrete listing recovery actions without a submit button when none is eligible", () => {
    render(<SellerResponseForm {...props()} listings={[]} listingId="" ready={false} />);
    expect(screen.getByRole("heading", { name: "No eligible listing yet" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create a listing for this request" }).getAttribute("href")).toBe("/usdt-exchange?demand=demand-one#create-listing");
    expect(screen.getByRole("link", { name: "Manage listings" }).getAttribute("href")).toBe("/usdt-exchange#my-listings-section");
    expect(screen.queryByRole("button", { name: "Send response" })).toBeNull();
  });

  it("provides Arabic controls and left-to-right grouped monetary values", () => {
    render(<SellerResponseForm {...props()} ar />);
    expect(screen.getByRole("form", { name: "رد البائع" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Seller response" })).toBeNull();
    expect(screen.getByRole("button", { name: "إرسال الرد" })).toBeTruthy();
    expect(screen.getByLabelText("سعر ردك (شيكل)").getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("region", { name: "معاينة دفعة المشتري" }).textContent).toContain("₪16,160.00");
  });
});
