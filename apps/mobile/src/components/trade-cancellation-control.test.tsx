import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MobileTradeDetail } from "@alpha-traders/contracts";
vi.mock("react-native", () => ({ View: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./branded-text", () => ({ BrandedText: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("./gold-button", () => ({ GoldButton: ({ children, disabled, loading, onPress }: { children: ReactNode; disabled: boolean; loading: boolean; onPress: () => void }) => <button disabled={disabled || loading} onClick={onPress}>{children}</button> }));
import { TradeCancellationControl } from "./trade-cancellation-control";

const base = { id: "trade-1", side: "buyer", status: "accepted", hasOpenDispute: false, actions: { canCancel: true } } as MobileTradeDetail;
afterEach(cleanup);

it.each([false, true])("keeps safe cancellation available in the native room, Arabic=%s", isAr => {
  const onCancel = vi.fn();
  render(<TradeCancellationControl trade={base} isAr={isAr} disabled={false} loading={false} onCancel={onCancel} />);
  fireEvent.click(screen.getByRole("button", { name: isAr ? "إلغاء الصفقة" : "Cancel Trade" }));
  expect(onCancel).toHaveBeenCalledOnce();
});

it.each(["buyer", "seller"] as const)("keeps collected-cash cancellation visible but blocked for the %s, even with a stale capability", side => {
  const onCancel = vi.fn();
  render(<TradeCancellationControl trade={{ ...base, side, status: "funds_received" }} isAr={false} disabled={false} loading={false} onCancel={onCancel} />);
  const cancel = screen.getByRole("button", { name: "Cancel Trade" }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true);
  expect(screen.getByText(/Cancellation is locked/)).toBeTruthy();
  fireEvent.click(cancel);
  expect(onCancel).not.toHaveBeenCalled();
});

it.each([false, true])("honors a server cancellation lock without losing the control, Arabic=%s", isAr => {
  const onCancel = vi.fn();
  render(<TradeCancellationControl trade={{ ...base, actions: { ...base.actions, canCancel: false } }} isAr={isAr} disabled={false} loading={false} onCancel={onCancel} />);
  const cancel = screen.getByRole("button", { name: isAr ? "إلغاء الصفقة" : "Cancel Trade" }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(true);
  fireEvent.click(cancel);
  expect(onCancel).not.toHaveBeenCalled();
});

it("locks cancellation during dispute review even with a stale server capability", () => {
  render(<TradeCancellationControl trade={{ ...base, hasOpenDispute: true }} isAr={false} disabled={false} loading={false} onCancel={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Cancel Trade" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/dispute is under review/)).toBeTruthy();
});

it.each(["completed", "review_open", "locked", "cancelled", "declined"] as const)("does not reopen a terminal %s trade", status => {
  render(<TradeCancellationControl trade={{ ...base, status }} isAr={false} disabled={false} loading={false} onCancel={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("keeps the pending seller's separate decline action as the only cancellation action", () => {
  render(<TradeCancellationControl trade={{ ...base, side: "seller", status: "pending", actions: { ...base.actions, canDecline: true } }} isAr={false} disabled={false} loading={false} onCancel={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
});
