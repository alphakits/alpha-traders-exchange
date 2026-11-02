import type { ReactNode } from "react";
import { formatMoneyNumber, splitAccentText } from "@/lib/accent-text";

const defaultOptions = { groupQuantities: true } as const;
const numericPrice = /^(?=[^\n]*[0-9٠-٩۰-۹])[+−$₪\s0-9٠-٩۰-۹,.٫٬/–—:=-]*(?:USDT?|ILS|NIS)?[+−$₪\s0-9٠-٩۰-۹,.٫٬/–—:=-]*$/i;

/** Brand and currency accents render with React, including SSR and live updates. */
export function currencyText(value: ReactNode, options: { groupNumbers?: boolean; groupQuantities?: boolean } = defaultOptions): ReactNode {
  if (Array.isArray(value)) {
    // JSX splits a price such as "$" + value across adjacent children.
    const children: ReactNode[] = [];
    let run = "";
    for (const child of value) {
      if (typeof child === "string" || typeof child === "number") run += child;
      else {
        if (run) children.push(currencyText(run, options));
        run = "";
        children.push(Array.isArray(child) ? currencyText(child, options) : child);
      }
    }
    if (run) children.push(currencyText(run, options));
    return children;
  }
  if (typeof value === "number") return options.groupNumbers === false ? value : formatMoneyNumber(value);
  if (typeof value !== "string") return value;
  const parts = splitAccentText(value, options);
  if (!parts) return value;
  return parts.map(({ text, tone }, index) => {
    if (!tone) return text;
    if (tone === "brand") return <span className="brand-alpha-traders" key={index}>{text}</span>;
    return numericPrice.test(text)
      ? <bdi dir="ltr" className="currency-money currency-usdt" key={index}>{text}</bdi>
      : <span className="currency-money currency-usdt" key={index}>{text}</span>;
  });
}

export const brandText = currencyText;

/** Explicit money value when its currency is shown in a separate label. */
export function moneyText(value: string | number): ReactNode {
  return <span className="currency-money">{formatMoneyNumber(value)}</span>;
}
