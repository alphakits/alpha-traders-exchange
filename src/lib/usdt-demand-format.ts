const unavailable = "—";

function decimalParts(value: string | null | undefined) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const [integer, fraction = ""] = value.trim().split(".");
  return { integer: integer.replace(/^0+(?=\d)/, ""), fraction };
}

function groupInteger(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Display a validated USDT amount without losing any of its six decimal places. */
export function formatUsdt(value: string | null | undefined): string {
  const parts = decimalParts(value);
  if (!parts || parts.fraction.length > 6) return unavailable;
  const fraction = parts.fraction.replace(/0+$/, "");
  return groupInteger(parts.integer) + (fraction ? `.${fraction}` : "");
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
