import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";

const fixture = vi.hoisted(() => ({ focused: true, maximum: "2000", price: "4.00", reads: vi.fn() }));
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
    return { listings: [{ id: "synthetic-listing", availableAmount: fixture.maximum, maximumTrade: fixture.maximum, minimumTrade: "200", currency: "ILS", price: fixture.price, network: "BEP20", paymentMethods: ["Bank Transfer"], seller: { isCurrentUser: false, displayName: "AT-SYNTHETIC" } }] };
  },
}));

import { TradeFormScreen } from "./trade-form-screen";

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers(); fixture.focused = true; fixture.maximum = "2000"; fixture.price = "4.00"; fixture.reads.mockClear();
  focusManager.setFocused(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); focusManager.setFocused(undefined); vi.useRealTimers(); });
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }


it.each([
  { listingPrice: "4.00", usdOffer: "1.1406", expectedIls: "3.65", valid: true },
  { listingPrice: "4.00", usdOffer: "1.2500", expectedIls: "4.00", valid: true },
  { listingPrice: "4.00", usdOffer: "1.3594", expectedIls: "4.35", valid: true },
  { listingPrice: "4.00", usdOffer: "1.1375", expectedIls: "3.64", valid: false },
  { listingPrice: "4.00", usdOffer: "1.3625", expectedIls: "4.36", valid: false },
  { listingPrice: "0.10", usdOffer: "0.0031", expectedIls: "0.01", valid: true },
  { listingPrice: "0.10", usdOffer: "0", expectedIls: "0.00", valid: false },
])("enforces the shared offer boundary: listing ₪$listingPrice, offer ₪$expectedIls", async ({ listingPrice, usdOffer, valid }) => {
  fixture.price = listingPrice;
  render(<QueryClientProvider client={client}><TradeFormScreen listingId="synthetic-listing" mode="offer" /></QueryClientProvider>);
  await advance(1);
  fireEvent.change(screen.getByLabelText("tradeAmount"), { target: { value: "700" } });
  fireEvent.change(screen.getByLabelText("receivingWallet · BEP20"), { target: { value: `0x${"1".repeat(40)}` } });
  fireEvent.change(screen.getByLabelText("offerPrice"), { target: { value: usdOffer } });
  const submit = screen.getByRole("button", { name: "submitOffer" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(!valid);
});
