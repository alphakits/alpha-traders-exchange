import type { ReactNode } from "react";
import { splitAccentText } from "@/lib/accent-text";

/** Brand and currency accents render with React, including SSR and live updates. */
export function currencyText(value: ReactNode): ReactNode {
  if (Array.isArray(value)) return value.map(currencyText);
  if (typeof value !== "string") return value;
  const parts = splitAccentText(value);
  if (!parts) return value;
  return parts.map(({ text, tone }, index) => tone
    ? <span className={tone === "brand" ? "brand-alpha-traders" : "currency-usdt"} key={index}>{text}</span>
    : text);
}

export const brandText = currencyText;
