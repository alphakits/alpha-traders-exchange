import type { ReactNode } from "react";

/** Keep currency styling in React so it works during SSR, navigation and live updates. */
export function currencyText(value: ReactNode): ReactNode {
  if (Array.isArray(value)) return value.map(currencyText);
  if (typeof value !== "string" || !/\busdt\b/i.test(value)) return value;
  return value.split(/(\busdt\b)/gi).map((part, index) =>
    /^usdt$/i.test(part)
      ? <span className="currency-usdt" key={index}>{part}</span>
      : part,
  );
}
