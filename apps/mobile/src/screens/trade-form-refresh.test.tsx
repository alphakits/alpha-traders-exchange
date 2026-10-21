import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";

const fixture = vi.hoisted(() => ({ focused: true, maximum: "500", reads: vi.fn() }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>Loading</span>,
  Pressable: ({ children, onPress, disabled }: { children: ReactNode; onPress?: () => void; disabled?: boolean }) => <button onClick={onPress} disabled={disabled}>{children}</button>,
  TextInput: ({ value, onChangeText, accessibilityLabel }: { value: string; onChangeText: (value: string) => void; accessibilityLabel?: string }) => <input value={value} onChange={event => onChangeText(event.target.value)} aria-label={accessibilityLabel} />,
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("expo-router", () => ({ useIsFocused: () => fixture.focused, useRouter: () => ({ replace: vi.fn(), back: vi.fn(), canGoBack: () => true }) }));
vi.mock("../auth/auth-context", () => ({ useAuth: () => ({ user: { id: "synthetic-buyer" }, requestWithSession: (operation: (tokens: unknown, locale: string) => unknown) => operation({}, "en") }) }));
vi.mock("../i18n/locale-context", () => ({ useLocale: () => ({ locale: "en", isRTL: false, t: (key: string) => key }) }));
vi.mock("../finance/use-usd-display-rate", () => ({ useUsdDisplayRate: () => 3.2 }));
vi.mock("../components/branded-text", () => ({ BrandedText: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("../components/gold-button", () => ({ GoldButton: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock("../api/mobile-api", () => ({
  createMobileTrade: vi.fn(), MobileApiError: class extends Error {},
  getMobileMarketplaceListing: async () => {
    fixture.reads();
    return { listings: [{ id: "synthetic-listing", availableAmount: fixture.maximum, maximumTrade: fixture.maximum, minimumTrade: "200", currency: "USD", price: "1", network: "BEP20", paymentMethods: ["Bank Transfer"], seller: { isCurrentUser: false, displayName: "AT-SYNTHETIC" } }] };
  },
}));

import { TradeFormScreen } from "./trade-form-screen";

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers(); fixture.focused = true; fixture.maximum = "500"; fixture.reads.mockClear();
  focusManager.setFocused(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); focusManager.setFocused(undefined); vi.useRealTimers(); });
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

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
