const unavailable = "—";

function decimalParts(value: string | null | undefined) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const [integer, fraction = ""] = value.trim().split(".");
  return { integer: integer.replace(/^0+(?=\d)/, ""), fraction };
}

function groupInteger(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Presentation only: show whole USDT with exact half-up rounding; mark rounded amounts. */
export function formatUsdt(value: string | null | undefined): string {
  const parts = decimalParts(value);
  if (!parts || parts.fraction.length > 6) return unavailable;
  const rounded = BigInt(parts.integer) + BigInt(parts.fraction[0] >= "5" ? 1 : 0);
  const fractional = /[1-9]/.test(parts.fraction);
  if (fractional && rounded === BigInt(0)) return "<1";
  return (fractional ? "≈" : "") + groupInteger(rounded.toString());
}

/** Exact quantity for explicit details; never use a rounded display value in trade math. */
export function formatUsdtExact(value: string | null | undefined): string {
  const parts = decimalParts(value);
  if (!parts || parts.fraction.length > 6) return unavailable;
  const fraction = parts.fraction.replace(/0+$/, "");
  return groupInteger(parts.integer) + (fraction ? `.${fraction}` : "");
}

/** Keep the source quote precision visible so inward-rounded bounds make sense. */
export function formatPriceReference(value: string | null | undefined): string {
  const parts = decimalParts(value);
  if (!parts) return unavailable;
  return `${groupInteger(parts.integer)}.${parts.fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

/** Presentation only: round to cents with decimal half-up arithmetic, never floats. */
export function formatIls(value: string | null | undefined): string {
  const parts = decimalParts(value);
  if (!parts) return unavailable;
  const cents = BigInt(parts.integer) * BigInt(100)
    + BigInt(parts.fraction.slice(0, 2).padEnd(2, "0"))
    + BigInt(parts.fraction.length > 2 && parts.fraction[2] >= "5" ? 1 : 0);
  return `${groupInteger((cents / BigInt(100)).toString())}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}
