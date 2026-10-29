import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MobileTradeDetail } from "@alpha-traders/contracts";
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: ({ accessibilityLabel, value, onChangeText, editable }: { accessibilityLabel: string; value: string; onChangeText: (value: string) => void; editable: boolean }) => <input aria-label={accessibilityLabel} value={value} disabled={!editable} onChange={e => onChangeText(e.target.value)} />,
  Switch: ({ accessibilityLabel, value, onValueChange }: { accessibilityLabel: string; value: boolean; onValueChange: (value: boolean) => void }) => <input type="checkbox" aria-label={accessibilityLabel} checked={value} onChange={e => onValueChange(e.target.checked)} />,
}));
vi.mock("./branded-text", () => ({ BrandedText: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("./gold-button", () => ({ GoldButton: ({ children, disabled, onPress }: { children: ReactNode; disabled: boolean; onPress: () => void }) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
import { TradeTermsPanel } from "./trade-terms-panel";

const base = { id: "trade-1", side: "seller", status: "pending", currency: "ILS", paymentMethod: "Cardless ATM Withdrawal", usdtAmount: "420", fiatAmount: "1315.02", pricePerUsdt: "3.10", priceMode: "listing_price", feePolicyVersion: "buyer_seller_1pct_v1", actions: { canCancel: true, canAdjustAmounts: true } } as MobileTradeDetail;
afterEach(cleanup);

it.each([false, true])("calculates a native ATM correction from cash including the fee, Arabic=%s", async isAr => {
  const onAction = vi.fn().mockResolvedValue(undefined);
  render(<TradeTermsPanel trade={base} isAr={isAr} disabled={false} onAction={onAction} />);
  const input = screen.getByLabelText("New withdrawal amount (ILS)");
  const submit = screen.getByRole("button", { name: isAr ? "إرسال التصحيح للموافقة" : "Propose corrected amount" });
  fireEvent.change(input, { target: { value: isAr ? "١٣٠٠" : "1300" } });
  expect(screen.getByText("420 → 415.202811 USDT")).toBeTruthy();
  expect(screen.getByText("ILS 1300.00")).toBeTruthy();
  fireEvent.click(submit);
  await waitFor(() => expect(onAction).toHaveBeenCalledWith("propose_ils_amount", isAr ? "١٣٠٠" : "1300", false));
  fireEvent.change(input, { target: { value: "1315" } });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("420 → 415.202811 USDT")).toBeNull();
});

it("allows a native price offer to choose cash correction or counter-price without losing the fee", () => {
  render(<TradeTermsPanel trade={{ ...base, priceMode: "buyer_offer", usdtAmount: "416.546509", fiatAmount: "1300.00", pricePerUsdt: "3.09" }} isAr={false} disabled={false} onAction={vi.fn()} />);
  expect(screen.getByLabelText("New withdrawal amount (ILS)")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Make a counter-offer" }));
  fireEvent.change(screen.getByLabelText("Counter price ILS"), { target: { value: "3.10" } });
  expect(screen.getByText("416.546509 → 415.202811 USDT")).toBeTruthy();
  expect(screen.getByText("ILS 1300.00")).toBeTruthy();
});

it.each(["Bank Transfer", "Face-to-Face (Meet in Person)"])("calculates native total-payment adjustments for %s", paymentMethod => {
  render(<TradeTermsPanel trade={{ ...base, paymentMethod }} isAr={false} disabled={false} onAction={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Total ILS payment" }));
  fireEvent.change(screen.getByLabelText("Total ILS payment"), { target: { value: "1300" } });
  expect(screen.getByText("420 → 415.202811 USDT")).toBeTruthy();
  expect(screen.getByText("Total includes the buyer’s 1% fee. Do not add it again.")).toBeTruthy();
});

it.each(["Bank Transfer", "Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"])("allows an accepted %s amount proposal independently of cancellation", async paymentMethod => {
  const onAction = vi.fn().mockResolvedValue(undefined);
  render(<TradeTermsPanel trade={{ ...base, status: "accepted", paymentMethod, priceMode: "buyer_offer", actions: { ...base.actions, canCancel: false, canAdjustAmounts: true } }} isAr={false} disabled={false} onAction={onAction} />);
  const cardless = paymentMethod === "Cardless ATM Withdrawal";
  expect(screen.queryByRole("button", { name: "Make a counter-offer" })).toBeNull();
  fireEvent.change(screen.getByLabelText(cardless ? "New withdrawal amount (ILS)" : "Correct USDT amount"), { target: { value: cardless ? "1300" : "300" } });
  fireEvent.click(screen.getByRole("button", { name: "Propose corrected amount" }));
  await waitFor(() => expect(onAction).toHaveBeenCalledWith(cardless ? "propose_ils_amount" : "propose_amount", cardless ? "1300" : "300", false));
});

it.each([false, true])("lets the buyer approve the second accepted amount proposal before payment, Arabic=%s", async isAr => {
  const proposal = { id: "amount-2", kind: "amount_correction" as const, status: "pending" as const, usdtAmount: "300", fiatAmount: "939.30", pricePerUsdt: "3.10", createdAt: "2026-10-28T18:00:00Z" };
  const onAction = vi.fn().mockResolvedValue(undefined);
  render(<TradeTermsPanel trade={{ ...base, side: "buyer", status: "accepted", amountAdjustmentCount: 2, termsProposal: proposal, actions: { ...base.actions, canCancel: false, canAdjustAmounts: true } }} isAr={isAr} disabled={false} onAction={onAction} />);
  const accept = screen.getByRole("button", { name: isAr ? "موافقة على الشروط" : "Accept these terms" }) as HTMLButtonElement;
  expect(accept.disabled).toBe(false);
  fireEvent.click(accept);
  await waitFor(() => expect(onAction).toHaveBeenCalledWith("accept_amount", "", false));
});

it.each(["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const)("honors server irreversible-progress lock at %s even when cancellation differs", status => {
  const onAction = vi.fn();
  render(<TradeTermsPanel trade={{ ...base, status, actions: { ...base.actions, canCancel: true, canAdjustAmounts: false } }} isAr={false} disabled={false} onAction={onAction} />);
  expect(screen.queryByRole("button", { name: "Propose corrected amount" })).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(onAction).not.toHaveBeenCalled();
});

it.each(["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "completed", "cancelled"] as const)("never reopens %s from a stale amount capability", status => {
  render(<TradeTermsPanel trade={{ ...base, status }} isAr={false} disabled={false} onAction={vi.fn()} />);
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("keeps older native payloads without amount eligibility locked", () => {
  const actions = { ...base.actions };
  delete actions.canAdjustAmounts;
  render(<TradeTermsPanel trade={{ ...base, actions }} isAr={false} disabled={false} onAction={vi.fn()} />);
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("does not approve a pending amount proposal after its server payment boundary locks", () => {
  const onAction = vi.fn();
  const termsProposal = { id: "amount-1", kind: "amount_correction" as const, status: "pending" as const, usdtAmount: "300", fiatAmount: "939.30", pricePerUsdt: "3.10", createdAt: "2026-10-28T18:00:00Z" };
  render(<TradeTermsPanel trade={{ ...base, status: "accepted", side: "buyer", termsProposal, actions: { ...base.actions, canAdjustAmounts: false } }} isAr={false} disabled={false} onAction={onAction} />);
  const accept = screen.getByRole("button", { name: "Accept these terms" }) as HTMLButtonElement;
  expect(accept.disabled).toBe(true);
  fireEvent.click(accept);
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByText(/amount is locked/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Decline proposal" }) as HTMLButtonElement).disabled).toBe(false);
});

it("does not reinterpret a pending counter-price draft as an accepted amount", async () => {
  const onAction = vi.fn().mockResolvedValue(undefined);
  const trade = { ...base, paymentMethod: "Bank Transfer", priceMode: "buyer_offer" as const };
  const { rerender } = render(<TradeTermsPanel trade={trade} isAr={false} disabled={false} onAction={onAction} />);
  fireEvent.click(screen.getByRole("button", { name: "Make a counter-offer" }));
  fireEvent.change(screen.getByLabelText("Counter price ILS"), { target: { value: "3.11" } });
  rerender(<TradeTermsPanel trade={{ ...trade, status: "accepted" }} isAr={false} disabled={false} onAction={onAction} />);
  const input = screen.getByLabelText("Correct USDT amount") as HTMLInputElement;
  expect(input.value).toBe("");
  const submit = screen.getByRole("button", { name: "Propose corrected amount" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(input, { target: { value: "300" } });
  expect(input.value).toBe("300");
  fireEvent.click(submit);
  await waitFor(() => expect(onAction).toHaveBeenCalledWith("propose_amount", "300", false));
});

it("keeps counter-offer approval pending-only", () => {
  const termsProposal = { id: "counter-1", kind: "counter_offer" as const, status: "pending" as const, usdtAmount: "300", fiatAmount: "939.30", pricePerUsdt: "3.10", createdAt: "2026-10-28T18:00:00Z" };
  const onAction = vi.fn();
  render(<TradeTermsPanel trade={{ ...base, status: "accepted", side: "buyer", priceMode: "buyer_offer", termsProposal }} isAr={false} disabled={false} onAction={onAction} />);
  const accept = screen.getByRole("button", { name: "Accept these terms" }) as HTMLButtonElement;
  expect(accept.disabled).toBe(true);
  fireEvent.click(accept);
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByText(/Counter-offers are only available before/)).toBeTruthy();
});

it("blocks a third accepted proposal without hiding the amount limit", () => {
  const onAction = vi.fn();
  render(<TradeTermsPanel trade={{ ...base, status: "accepted", amountAdjustmentCount: 2 }} isAr={false} disabled={false} onAction={onAction} />);
  expect(screen.getByText(/Adjustment limit reached \(2\/2\)/)).toBeTruthy();
  expect((screen.getByLabelText("New withdrawal amount (ILS)") as HTMLInputElement).disabled).toBe(true);
  const submit = screen.getByRole("button", { name: "Propose corrected amount" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(submit);
  expect(onAction).not.toHaveBeenCalled();
});


it.each([false, true])("keeps the native seller adjustment control visible and locked after ATM cash collection, Arabic=%s", isAr => {
  const onAction = vi.fn();
  render(<TradeTermsPanel trade={{ ...base, status: "funds_received", actions: { ...base.actions, canAdjustAmounts: false } }} isAr={isAr} disabled={false} onAction={onAction} />);
  const adjust = screen.getByRole("button", { name: isAr ? "تعديل المبلغ" : "Adjust Amount" }) as HTMLButtonElement;
  expect(adjust.disabled).toBe(true);
  expect(screen.getByText(isAr ? /المبلغ مقفل/ : /amount is locked/)).toBeTruthy();
  fireEvent.click(adjust);
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).toBeNull();
});
