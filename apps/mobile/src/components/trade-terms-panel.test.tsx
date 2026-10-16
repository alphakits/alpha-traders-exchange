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

const base = { id: "trade-1", side: "seller", status: "pending", currency: "ILS", paymentMethod: "Cardless ATM Withdrawal", usdtAmount: "420", fiatAmount: "1315.02", pricePerUsdt: "3.10", priceMode: "listing_price", feePolicyVersion: "buyer_seller_1pct_v1", actions: { canCancel: true } } as MobileTradeDetail;
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
