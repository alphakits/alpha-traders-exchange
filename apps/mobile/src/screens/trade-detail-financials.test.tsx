import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MobileTradeDetail } from "@alpha-traders/contracts";

const fixture = vi.hoisted(() => ({ locale: "en", trade: {} as MobileTradeDetail, submit: vi.fn(), alert: vi.fn() }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RefreshControl: () => null,
  ActivityIndicator: () => <span>Loading</span>,
  Platform: { OS: "ios" },
  Alert: { alert: fixture.alert },
  Pressable: ({ children, onPress, disabled }: { children: ReactNode; onPress?: () => void; disabled?: boolean }) => <button onClick={onPress} disabled={disabled}>{children}</button>,
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: { value: string; onChangeText: (value: string) => void; accessibilityLabel?: string; editable?: boolean }) => <input value={value} onChange={event => onChangeText(event.target.value)} aria-label={accessibilityLabel} disabled={editable === false} />,
  Switch: ({ value, onValueChange, accessibilityLabel }: { value: boolean; onValueChange: (value: boolean) => void; accessibilityLabel?: string }) => <input type="checkbox" checked={value} onChange={event => onValueChange(event.target.checked)} aria-label={accessibilityLabel} />,
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("expo-router", () => ({ useIsFocused: () => false, useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true }) }));
vi.mock("expo-image-manipulator", () => ({}));
vi.mock("expo-image-picker", () => ({}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
vi.mock("../auth/auth-context", () => ({ useAuth: () => ({ user: { id: "synthetic-user", role: "buyer", roles: [] }, requestWithSession: (operation: (tokens: unknown, locale: string) => unknown) => operation({}, fixture.locale) }) }));
vi.mock("../i18n/locale-context", () => ({ useLocale: () => ({ locale: fixture.locale, isRTL: fixture.locale === "ar", t: (key: string) => key }) }));
vi.mock("../components/branded-text", () => ({ BrandedText: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("../components/attention-siren", () => ({ AttentionSiren: () => null }));
vi.mock("../components/trade-cancellation-control", () => ({ TradeCancellationControl: () => null }));
vi.mock("../components/gold-button", () => ({ GoldButton: ({ children, onPress, disabled, loading }: { children: ReactNode; onPress?: () => void; disabled?: boolean; loading?: boolean }) => <button disabled={disabled || loading} onClick={onPress}>{children}</button> }));
vi.mock("../api/mobile-api", () => ({
  getMobileTrade: async () => ({ requestId: fixture.trade.id, trade: fixture.trade }),
  submitMobileCardlessCode: fixture.submit,
  MobileApiError: class extends Error {},
}));

import { TradeDetailScreen } from "./trade-detail-screen";

let client: QueryClient;
beforeEach(() => {
  fixture.locale = "en";
  fixture.alert.mockReset();
  fixture.trade = {
    id: "native-code", updatedAt: "2026-11-05T22:00:00Z", createdAt: "2026-11-05T21:00:00Z", side: "buyer", status: "accepted",
    currency: "ILS", paymentMethod: "Cardless ATM Withdrawal", usdtAmount: "116.482236", fiatAmount: "400.00", pricePerUsdt: "3.40", listingPriceAtRequest: "3.50", priceMode: "buyer_offer",
    feePolicyVersion: "buyer_seller_1pct_v1", commissionCalculationVersion: "usdt_6dp_v2", network: "TRC20", counterpartyDisplayName: "AT-SYNTHETIC",
    termsProposal: { id: "new-counter", kind: "counter_offer", status: "accepted", calculationPolicy: "cardless_selected_cash_v2", usdtAmount: "116.482236", fiatAmount: "400.00", pricePerUsdt: "3.40", createdAt: "2026-11-05T21:59:00Z" },
    messages: [], timeline: [], chatOpen: false, hasBuyerEvidence: false, hasSellerEvidence: false, hasOpenDispute: false, deadlineAt: null, timeRemainingSeconds: null,
    actions: { canMarkPaymentSent: true, canAdjustAmounts: true, canConfirmPreparedCardlessCode: false,
      canAccept: false, canDecline: false, canCancel: false, canViewBankDetails: false, canUploadPaymentEvidence: false,
      canConfirmFunds: false, canBeginRelease: false, canMarkUsdtSent: false, canUploadReleaseEvidence: false,
      canConfirmReceived: false, canCompleteFaceToFace: false, canOpenDispute: false, canSubmitReview: false, canRespondToReview: false },
  };
  fixture.submit.mockReset().mockImplementation(async () => {
    fixture.trade = { ...fixture.trade, status: "payment_sent", updatedAt: "2026-11-05T22:01:00Z", actions: { ...fixture.trade.actions, canMarkPaymentSent: false, canAdjustAmounts: false } };
    return { requestId: fixture.trade.id, trade: fixture.trade, actions: fixture.trade.actions };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); });

function openTrade() {
  render(<QueryClientProvider client={client}><TradeDetailScreen requestId={fixture.trade.id} /></QueryClientProvider>);
}

async function enterCredential() {
  fireEvent.change(await screen.findByLabelText("withdrawalCodeLabel"), { target: { value: "482913" } });
  fireEvent.change(screen.getByLabelText("withdrawalIdNumber"), { target: { value: "123456789" } });
}

async function confirmSubmission() {
  fireEvent.click(screen.getByRole("button", { name: "sendAndConfirmWithdrawalCode" }));
  const buttons = fixture.alert.mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { buttons.find(button => button.text === "confirm")?.onPress?.(); });
  await waitFor(() => expect(screen.queryByRole("button", { name: "sendAndConfirmWithdrawalCode" })).toBeNull());
}

it.each(["en", "ar"])("requires the buyer to type the exact replacement-code ILS amount and sends it, locale=%s", async locale => {
  fixture.locale = locale;
  openTrade();
  const label = locale === "ar" ? "مبلغ رمز السحب الجديد (ILS)" : "New ATM code amount (ILS)";
  const input = await screen.findByLabelText(label) as HTMLInputElement;
  expect(input.value).toBe("");
  expect(screen.getByText(locale === "ar" ? /أنشئ رمز سحب جديدًا بمبلغ ILS 400.00/ : /Generate a new withdrawal code for exactly ILS 400.00/)).toBeTruthy();
  await enterCredential();
  const send = screen.getByRole("button", { name: "sendAndConfirmWithdrawalCode" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(input, { target: { value: "300" } });
  expect(send.disabled).toBe(true);
  fireEvent.click(send);
  expect(fixture.submit).not.toHaveBeenCalled();
  const typedAmount = locale === "ar" ? "٤٠٠" : "400";
  fireEvent.change(input, { target: { value: typedAmount } });
  expect(send.disabled).toBe(false);
  await confirmSubmission();
  await waitFor(() => expect(fixture.submit).toHaveBeenCalledExactlyOnceWith({}, locale, "native-code", {
    withdrawalCode: "482913", verificationKind: "id_number", verificationValue: "123456789", ilsAmount: typedAmount,
  }, "00000000-0000-4000-8000-000000000001"));
  expect(fixture.alert.mock.calls[0]?.[1]).toContain("ILS 400.00");
});

it("preserves legacy manual code submission without adding an amount silently", async () => {
  fixture.trade = { ...fixture.trade, termsProposal: undefined };
  openTrade();
  await enterCredential();
  expect(screen.queryByLabelText("New ATM code amount (ILS)")).toBeNull();
  expect((screen.getByRole("button", { name: "sendAndConfirmWithdrawalCode" }) as HTMLButtonElement).disabled).toBe(false);
  await confirmSubmission();
  expect(fixture.submit.mock.calls[0]?.[3]).toEqual({ withdrawalCode: "482913", verificationKind: "id_number", verificationValue: "123456789" });
});

it("confirms still-valid prepared details through the prepared-details action", async () => {
  fixture.trade = { ...fixture.trade, actions: { ...fixture.trade.actions, canConfirmPreparedCardlessCode: true } };
  openTrade();
  await screen.findByRole("button", { name: "sendAndConfirmWithdrawalCode" });
  expect(screen.queryByLabelText("New ATM code amount (ILS)")).toBeNull();
  expect(screen.queryByLabelText("withdrawalCodeLabel")).toBeNull();
  await confirmSubmission();
  expect(fixture.submit.mock.calls[0]?.[3]).toEqual({ usePreparedDetails: true });
});

it("preserves the live draft through an unrelated refresh and replaces it with accepted server terms", async () => {
  fixture.trade = { ...fixture.trade, side: "seller", status: "pending", paymentMethod: "Bank Transfer", usdtAmount: "100", fiatAmount: "323.20", pricePerUsdt: "3.20", termsProposal: undefined,
    actions: { ...fixture.trade.actions, canMarkPaymentSent: false } };
  openTrade();
  fireEvent.change(await screen.findByLabelText("Counter price ILS"), { target: { value: "3.4" } });
  expect(screen.getByText("Draft total — not sent yet")).toBeTruthy();
  expect(screen.getByText("ILS 343.40")).toBeTruthy();
  expect(screen.queryByText("ILS 323.20")).toBeNull();
  fixture.trade = { ...fixture.trade, updatedAt: "2026-11-05T22:00:30Z" };
  act(() => client.setQueryData(["mobile-trade", "synthetic-user", "native-code", "en"], { requestId: "native-code", trade: fixture.trade }));
  await waitFor(() => expect((screen.getByLabelText("Counter price ILS") as HTMLInputElement).value).toBe("3.4"));
  expect(screen.getByText("Draft total — not sent yet")).toBeTruthy();
  expect(screen.getByText("ILS 343.40")).toBeTruthy();
  fixture.trade = { ...fixture.trade, status: "accepted", updatedAt: "2026-11-05T22:01:00Z", fiatAmount: "343.40", pricePerUsdt: "3.40" };
  act(() => client.setQueryData(["mobile-trade", "synthetic-user", "native-code", "en"], { requestId: "native-code", trade: fixture.trade }));
  await screen.findByText("Agreed payment total");
  expect(screen.queryByText("Draft total — not sent yet")).toBeNull();
  expect(screen.getByText("ILS 343.40")).toBeTruthy();
});
