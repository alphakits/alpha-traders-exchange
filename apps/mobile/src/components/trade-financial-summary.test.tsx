import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { MobileTradeDetail } from "@alpha-traders/contracts";

vi.mock("react-native", () => ({ View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./branded-text", () => ({ BrandedText: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
import { TradeFinancialSummary } from "./trade-financial-summary";

const trade = {
  id: "native-financial-trade", updatedAt: "2026-11-05T22:00:00Z", side: "seller", status: "pending",
  currency: "ILS", paymentMethod: "Bank Transfer", usdtAmount: "100", fiatAmount: "323.20", pricePerUsdt: "3.20",
  feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2",
  actions: { canAdjustAmounts: true },
} as MobileTradeDetail;
const terms = { usdtAmount: "100", fiatAmount: "343.40", pricePerUsdt: "3.40" };
afterEach(cleanup);

it.each([false, true])("shows the unsent total and itemized fees immediately without making the old total payable, Arabic=%s", isAr => {
  render(<TradeFinancialSummary trade={trade} isAr={isAr} preview={{ requestId: trade.id, updatedAt: trade.updatedAt, terms }} />);
  expect(screen.getByText(isAr ? "إجمالي المسودة — لم يُرسل بعد" : "Draft total — not sent yet")).toBeTruthy();
  for (const value of ["100 USDT", "ILS 340.00", "ILS 3.40", "ILS 343.40", "2 USDT"]) expect(screen.getByText(value)).toBeTruthy();
  expect(screen.getAllByText("1 USDT")).toHaveLength(2);
  expect(screen.queryByText("ILS 323.20")).toBeNull();
  expect(screen.getByText(isAr ? /لا تدفع أو ترسل USDT/ : /Do not pay or send USDT/)).toBeTruthy();
  expect(trade).toMatchObject({ usdtAmount: "100", fiatAmount: "323.20", pricePerUsdt: "3.20" });
});

it.each(["buyer", "seller"] as const)("prioritizes the persisted proposal over a local draft for the %s", side => {
  const pending = { ...trade, side, termsProposal: { ...terms, id: "proposal", kind: "counter_offer" as const, status: "pending" as const, createdAt: trade.updatedAt } };
  render(<TradeFinancialSummary trade={pending} isAr={false} preview={{ requestId: trade.id, updatedAt: trade.updatedAt, terms: { ...terms, pricePerUsdt: "3.30", fiatAmount: "333.30" } }} />);
  expect(screen.getByText("Proposed total — awaiting buyer approval")).toBeTruthy();
  expect(screen.getByText("ILS 343.40")).toBeTruthy();
  expect(screen.queryByText("ILS 323.20")).toBeNull();
  expect(screen.queryByText("ILS 333.30")).toBeNull();
  expect(Boolean(screen.queryByText("Your seller fee"))).toBe(side === "seller");
});

it("shows accepted canonical amounts and drops a draft from the previous revision", () => {
  const accepted = { ...trade, ...terms, status: "accepted" as const, updatedAt: "2026-11-05T22:01:00Z" };
  render(<TradeFinancialSummary trade={accepted} isAr={false} preview={{ requestId: trade.id, updatedAt: trade.updatedAt, terms: trade }} />);
  expect(screen.getByText("Agreed payment total")).toBeTruthy();
  expect(screen.getByText("ILS 343.40")).toBeTruthy();
  expect(screen.queryByText("ILS 323.20")).toBeNull();
  expect(screen.queryByText("Draft total — not sent yet")).toBeNull();
});

it.each(["request", "revision", "payment"])("ignores a draft after the %s changes", changed => {
  const current = { ...trade, ...(changed === "request" ? { id: "other-trade" } : changed === "revision" ? { updatedAt: "new-revision" } : { status: "payment_sent" as const }) };
  render(<TradeFinancialSummary trade={current} isAr={false} preview={{ requestId: trade.id, updatedAt: trade.updatedAt, terms }} />);
  expect(screen.getByText("ILS 323.20")).toBeTruthy();
  expect(screen.queryByText("ILS 343.40")).toBeNull();
  expect(screen.queryByText("Draft total — not sent yet")).toBeNull();
});

it("does not present the old payment amount while the new price draft is incomplete", () => {
  render(<TradeFinancialSummary trade={trade} isAr={false} preview={{ requestId: trade.id, updatedAt: trade.updatedAt, terms: null }} />);
  expect(screen.getByText("Draft total — not sent yet")).toBeTruthy();
  expect(screen.getByText("Enter a valid price to preview the total and fees.")).toBeTruthy();
  expect(screen.queryByText("ILS 323.20")).toBeNull();
});

it("keeps the exact ATM total visible while explaining why it cannot yet be sent", () => {
  const atm = { ...trade, paymentMethod: "Cardless ATM Withdrawal", usdtAmount: "92.821782", fiatAmount: "300.00" };
  render(<TradeFinancialSummary trade={atm} isAr={false} preview={{ requestId: trade.id, updatedAt: trade.updatedAt, terms: { usdtAmount: "92.821782", fiatAmount: "318.75", pricePerUsdt: "3.40" } }} />);
  expect(screen.getByText("92.821782 USDT")).toBeTruthy();
  expect(screen.getByText("ILS 318.75")).toBeTruthy();
  expect(screen.getByText(/ATM cash must be/)).toBeTruthy();
  expect(screen.queryByText("ILS 300.00")).toBeNull();
});

it.each([
  [undefined, "1.74 USDT"],
  ["usdt_6dp_v2", "1.747234 USDT"],
] as const)("retains the trade's commission rounding policy: %s", (commissionCalculationVersion, totalDue) => {
  render(<TradeFinancialSummary trade={{ ...trade, status: "accepted", commissionCalculationVersion, paymentMethod: "Cardless ATM Withdrawal", usdtAmount: "87.361677", fiatAmount: "300.00", pricePerUsdt: "3.40" }} isAr={false} />);
  expect(screen.getByText(totalDue)).toBeTruthy();
  expect(screen.getByText("ILS 300.00")).toBeTruthy();
});
