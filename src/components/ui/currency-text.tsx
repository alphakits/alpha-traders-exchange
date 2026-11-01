import type { ReactNode } from "react";
import { formatMoneyNumber, splitAccentText } from "@/lib/accent-text";

/** Brand and currency accents render with React, including SSR and live updates. */
export function currencyText(value: ReactNode): ReactNode {
  if (Array.isArray(value)) return value.map(currencyText);
  if (typeof value !== "string") return value;
  const parts = splitAccentText(value);
  if (!parts) return value;
  return parts.map(({ text, tone }, index) => tone
    ? <span className={tone === "brand" ? "brand-alpha-traders" : "currency-money currency-usdt"} key={index}>{text}</span>
    : text);
}

export const brandText = currencyText;

/** Explicit money value when its currency is shown in a separate label. */
export function moneyText(value: string | number): ReactNode {
  return <span className="currency-money">{formatMoneyNumber(value)}</span>;
}
