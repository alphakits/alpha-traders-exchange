import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { moneyColors } from "@alpha-traders/design-tokens";
import { BrandedText } from "./branded-text";
import { MoneyInput } from "./money-input";
import { SellerRankIdentity } from "./seller-rank-identity";
import type { MobileAccountStats } from "@alpha-traders/contracts";
import { formatUsdt } from "../finance/financial-display";

vi.mock("../i18n/locale-context", () => ({ useLocale: () => ({ isRTL: false, t: (key: string) => key }) }));
vi.mock("react-native", () => {
  const color = (style: unknown) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean)).color as string | undefined;
  return {
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    StyleSheet: { create: (value: unknown) => value },
    Text: ({ style, children }: { style?: unknown; children: ReactNode }) => <span data-color={color(style)}>{children}</span>,
    TextInput: ({ value, onChangeText, onFocus, onBlur, style }: {
      value: string; onChangeText: (text: string) => void; onFocus: () => void; onBlur: () => void; style: unknown;
    }) => <input value={value} data-color={color(style)} onChange={e => onChangeText(e.target.value)} onFocus={onFocus} onBlur={onBlur} />,
  };
});
afterEach(cleanup);

it("shows the final micro-USDT remaining below a rank threshold", () => {
  const summary = { lifetimeCompletedVolumeUsdt: 14999.999999, amountToNextLevelUsdt: 0.000001,
    nextLevel: "silver", progressToNextLevelPercent: 99.99999 } as Extract<MobileAccountStats, { kind: "seller" }>;
  render(<SellerRankIdentity rank="bronze" summary={summary} />);
  expect(screen.getByText("14,999.999999 USDT")).toBeTruthy();
  expect(screen.getByText("0.000001 USDT")).toBeTruthy();
  expect(screen.getByText("99%")).toBeTruthy();
});

it("styles an amount across JSX boundaries, keeps counts distinct, and preserves an account ID", () => {
  const { container } = render(<BrandedText>AT-123456 · {1000} trades · {1234}{" USDT"}</BrandedText>);
  expect(container.textContent).toBe("AT-123456 · 1,000 trades · 1,234 USDT");
  expect(screen.getByText("1,234 USDT").dataset.color).toBe(moneyColors.onDark);
});

it("preserves the stored precision and localized digits for a receipt amount on gold", () => {
  render(<BrandedText monetary accentTone="onGold">١٢٣٤٥٫٠٠٠٠٥٠ USDT</BrandedText>);
  expect(screen.getByText("١٢,٣٤٥٫٠٠٠٠٥٠ USDT").dataset.color).toBe(moneyColors.onGold);
  expect(formatUsdt("12345.000050")).toBe("12,345.000050 USDT");
});

it("preserves digits in copied messages and protected details", () => {
  const message = "Withdrawal code 0501234567. ID 123456789. Agreed amount: 12500 USDT";
  const { container } = render(<BrandedText preserveNumbers>{message}</BrandedText>);
  expect(container.textContent).toBe(message);
});

it("groups a green monetary input for display while preserving the draft sent by its change handler", () => {
  const changed = vi.fn();
  function Form() {
    const [value, setValue] = useState("1000.000050");
    return <MoneyInput value={value} onChangeText={next => { changed(next); setValue(next); }} />;
  }
  render(<Form />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  expect(input.value).toBe("1,000.000050");
  expect(input.dataset.color).toBe(moneyColors.onDark);
  fireEvent.focus(input);
  expect(input.value).toBe("1000.000050");
  fireEvent.change(input, { target: { value: "12345.6000" } });
  fireEvent.blur(input);
  expect(input.value).toBe("12,345.6000");
  expect(changed.mock.calls).toEqual([["12345.6000"]]);
});
