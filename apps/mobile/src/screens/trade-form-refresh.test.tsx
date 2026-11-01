import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";

const fixture = vi.hoisted(() => ({ focused: true, maximum: "500", locale: "en", userId: "synthetic-buyer", reads: vi.fn(), methods: ["Bank Transfer"], create: vi.fn(), replace: vi.fn(), submit: undefined as undefined | (() => void) }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress, disabled }: { children: ReactNode; onPress?: () => void; disabled?: boolean }) => <button onClick={onPress} disabled={disabled}>{children}</button>,
  TextInput: ({ value, onChangeText, accessibilityLabel }: { value: string; onChangeText: (value: string) => void; accessibilityLabel?: string }) => <input value={value} onChange={event => onChangeText(event.target.value)} aria-label={accessibilityLabel} />,
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("expo-router", () => ({ useIsFocused: () => fixture.focused, useRouter: () => ({ replace: fixture.replace, back: vi.fn(), canGoBack: () => true }) }));
vi.mock("../auth/auth-context", () => ({ useAuth: () => ({ user: { id: fixture.userId }, requestWithSession: (operation: (tokens: unknown, locale: string) => unknown) => operation({}, fixture.locale) }) }));
vi.mock("../i18n/locale-context", () => ({ useLocale: () => ({ locale: fixture.locale, isRTL: fixture.locale === "ar", t: (key: string) => key }) }));
vi.mock("../finance/use-usd-display-rate", () => ({ useUsdDisplayRate: () => 3.2 }));
vi.mock("../components/branded-text", () => ({ BrandedText: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("../components/gold-button", () => ({ GoldButton: ({ children, onPress, disabled, loading }: { children: ReactNode; onPress: () => void; disabled?: boolean; loading?: boolean }) => {
  if (children === "submitBuy") fixture.submit = onPress;
  return <button disabled={disabled || loading} onClick={onPress}>{children}</button>;
} }));
vi.mock("../api/mobile-api", () => ({
  createMobileTrade: fixture.create, MobileApiError: class extends Error {},
  getMobileMarketplaceListing: async (listingId: string) => {
    fixture.reads();
    return { listings: [{ id: listingId, availableAmount: fixture.maximum, maximumTrade: fixture.maximum, minimumTrade: "200", currency: "USD", price: "1", network: "BEP20", paymentMethods: fixture.methods, seller: { isCurrentUser: false, displayName: "AT-SYNTHETIC" } }] };
  },
}));

import { TradeFormScreen } from "./trade-form-screen";

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers(); fixture.focused = true; fixture.maximum = "500"; fixture.reads.mockClear();
  fixture.methods = ["Bank Transfer"]; fixture.create.mockReset(); fixture.replace.mockReset(); fixture.submit = undefined;
  fixture.locale = "en"; fixture.userId = "synthetic-buyer";
  focusManager.setFocused(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); focusManager.setFocused(undefined); vi.useRealTimers(); });
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

async function fillValidBuyerForm() {
  await advance(1);
  fireEvent.change(screen.getByLabelText("tradeAmount"), { target: { value: "300" } });
  fireEvent.change(screen.getByLabelText("receivingWallet · BEP20"), { target: { value: `0x${"1".repeat(40)}` } });
  expect((screen.getByRole("button", { name: "submitBuy" }) as HTMLButtonElement).disabled).toBe(false);
}

it.each(["en", "ar"])("blocks a removed payment method while preserving the buyer's amount and wallet in %s", async (locale) => {
  fixture.locale = locale;
  render(<QueryClientProvider client={client}><TradeFormScreen listingId="synthetic-listing" mode="buy" /></QueryClientProvider>);
  await fillValidBuyerForm();
  fixture.methods = ["Face-to-Face (Meet in Person)"];
  await advance(15_001);
  expect((screen.getByRole("button", { name: "submitBuy" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("tradeAmount") as HTMLInputElement).value).toBe("300");
  expect((screen.getByLabelText("receivingWallet · BEP20") as HTMLInputElement).value).toBe(`0x${"1".repeat(40)}`);
  act(() => fixture.submit!());
  expect(fixture.create).not.toHaveBeenCalled();
  expect(screen.getByText(locale === "ar" ? /غيّر البائع طرق الدفع/ : /The seller changed the available payment methods/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "لقاء مباشر وجهًا لوجه" : /^Face-to-Face/ }));
  fireEvent.click(screen.getByRole("button", { name: /acknowledgeSafety/ }));
  expect((screen.getByRole("button", { name: "submitBuy" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps a still-supported payment method valid when the seller adds another method", async () => {
  render(<QueryClientProvider client={client}><TradeFormScreen listingId="synthetic-listing" mode="buy" /></QueryClientProvider>);
  await fillValidBuyerForm();
  fixture.methods = ["Face-to-Face (Meet in Person)", "Bank Transfer"];
  await advance(15_001);
  expect((screen.getByRole("button", { name: "submitBuy" }) as HTMLButtonElement).disabled).toBe(false);
});

it("submits once when two native press callbacks arrive before the pending render, then permits retry after failure", async () => {
  let reject!: (error: Error) => void;
  fixture.create.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<QueryClientProvider client={client}><TradeFormScreen listingId="synthetic-listing" mode="buy" /></QueryClientProvider>);
  await fillValidBuyerForm();
  const press = fixture.submit!;
  act(() => { press(); press(); });
  expect(fixture.create).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("synthetic failure")));
  expect((screen.getByRole("button", { name: "submitBuy" }) as HTMLButtonElement).disabled).toBe(false);
  act(() => fixture.submit!());
  expect(fixture.create).toHaveBeenCalledTimes(2);
});

it.each(["listing", "account", "mode"])("keeps an old response from taking over a newer purchase after changing %s and returning", async (changedScope) => {
  const responses: Array<(response: unknown) => void> = [];
  fixture.create.mockImplementation(() => new Promise(done => { responses.push(done); }));
  const ui = (listingId: string, mode: "buy" | "offer" = "buy") => <QueryClientProvider client={client}><TradeFormScreen listingId={listingId} mode={mode} /></QueryClientProvider>;
  const view = render(ui("synthetic-listing"));
  await fillValidBuyerForm();
  act(() => fixture.submit!());
  if (changedScope === "account") fixture.userId = "other-buyer";
  view.rerender(ui(changedScope === "listing" ? "other-listing" : "synthetic-listing", changedScope === "mode" ? "offer" : "buy"));
  await advance(1);
  fixture.userId = "synthetic-buyer";
  view.rerender(ui("synthetic-listing"));
  await fillValidBuyerForm();
  act(() => fixture.submit!());
  expect(fixture.create).toHaveBeenCalledTimes(2);
  await act(async () => responses[0]!({ requestId: "old-request", trade: { id: "old-request", createdAt: "2026-10-23T00:00:00Z" } }));
  expect(fixture.replace).not.toHaveBeenCalled();
  expect(client.getQueryData(["mobile-trade", "synthetic-buyer", "old-request", "en"])).toBeUndefined();
  expect((screen.getByRole("button", { name: "submitBuy" }) as HTMLButtonElement).disabled).toBe(true);
  act(() => fixture.submit!());
  expect(fixture.create).toHaveBeenCalledTimes(2);
  await act(async () => responses[1]!({ requestId: "new-request", trade: { id: "new-request", createdAt: "2026-10-23T00:00:00Z" } }));
  expect(fixture.replace).toHaveBeenCalledExactlyOnceWith({ pathname: "/trade/[requestId]", params: { requestId: "new-request" } });
  expect(client.getQueryData(["mobile-trade", "synthetic-buyer", "new-request", "en"])).toMatchObject({ requestId: "new-request" });
});

it("ignores a queued submit callback from a form that has been replaced", async () => {
  fixture.create.mockImplementation(() => new Promise(() => {}));
  const ui = (listingId: string) => <QueryClientProvider client={client}><TradeFormScreen listingId={listingId} mode="buy" /></QueryClientProvider>;
  const view = render(ui("synthetic-listing"));
  await fillValidBuyerForm();
  const oldPress = fixture.submit!;
  view.rerender(ui("other-listing"));
  await advance(1);
  act(() => oldPress());
  expect(fixture.create).not.toHaveBeenCalled();
});

it.each(["success", "failure"])("ignores late %s after the purchase screen unmounts", async (outcome) => {
  let resolve!: (response: unknown) => void;
  let reject!: (error: Error) => void;
  fixture.create.mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
  const view = render(<QueryClientProvider client={client}><TradeFormScreen listingId="synthetic-listing" mode="buy" /></QueryClientProvider>);
  await fillValidBuyerForm();
  const press = fixture.submit!;
  act(() => press());
  view.unmount();
  await act(async () => {
    if (outcome === "success") resolve({ requestId: "unmounted-request", trade: { id: "unmounted-request", createdAt: "2026-10-23T00:00:00Z" } });
    else reject(new Error("late synthetic failure"));
  });
  expect(fixture.replace).not.toHaveBeenCalled();
  expect(client.getQueryData(["mobile-trade", "synthetic-buyer", "unmounted-request", "en"])).toBeUndefined();
  act(() => press());
  expect(fixture.create).toHaveBeenCalledTimes(1);
});

it("refreshes open native purchase terms, retains buyer input, and stops polling off screen", async () => {
  const ui = () => <QueryClientProvider client={client}><TradeFormScreen listingId="synthetic-listing" mode="buy" /></QueryClientProvider>;
  const view = render(ui());
  await advance(1);
  const amount = screen.getByLabelText("tradeAmount") as HTMLInputElement;
  fireEvent.change(amount, { target: { value: "700" } });
  fireEvent.change(screen.getByLabelText("receivingWallet · BEP20"), { target: { value: `0x${"1".repeat(40)}` } });
  const submit = screen.getByRole("button", { name: "submitBuy" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fixture.maximum = "2000";
  await advance(15_001);
  expect(screen.getByText("amountHint: 200–2,000 USDT")).toBeTruthy();
  expect(amount.value).toBe("700");
  expect(submit.disabled).toBe(false);
  fixture.focused = false;
  view.rerender(ui());
  const readCount = fixture.reads.mock.calls.length;
  fixture.maximum = "600";
  await advance(60_000);
  expect(fixture.reads).toHaveBeenCalledTimes(readCount);
  fixture.focused = true;
  view.rerender(ui());
  await advance(1);
  expect(screen.getByText("amountHint: 200–600 USDT")).toBeTruthy();
  expect(amount.value).toBe("700");
  expect(submit.disabled).toBe(true);
});
