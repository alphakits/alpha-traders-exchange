// Presentation only: shared by web and native; never use this for payment data.
const brandPattern = String.raw`\balpha\s+traders\b|[أاآ]لفا\s+تريدرز`;
const currencyPattern = String.raw`\b(?:usdt|ils)\b|₪`;
const numberPattern = String.raw`[+-]?\b(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const amountPattern = `${numberPattern}(?:[ \\u00a0]*(?:–|—|-|to)[ \\u00a0]*${numberPattern})?`;
const accentPattern = new RegExp(
  `(${brandPattern}|${amountPattern}[ \\u00a0]*(?:${currencyPattern})|(?:${currencyPattern})[ \\u00a0]*${amountPattern}|${currencyPattern})`,
  "gi",
);
const hasAccent = new RegExp(`${brandPattern}|${currencyPattern}`, "i");
const isBrand = new RegExp(`^(?:${brandPattern})$`, "i");

/** Add grouping without Number conversion, rounding, or dropping trailing zeros. */
export function formatMoneyNumber(value: string | number): string {
  return String(value).replace(/\d[\d,]*(?:\.\d+)?/g, (amount) => {
    const [integer = "", fraction] = amount.split(".");
    const grouped = integer.replace(/,/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fraction === undefined ? grouped : `${grouped}.${fraction}`;
  });
}

export function splitAccentText(value: string) {
  if (!hasAccent.test(value)) return null;
  return value.split(accentPattern).map((text, index) => {
    const tone = index % 2 === 0 ? null : isBrand.test(text) ? "brand" as const : "money" as const;
    return { text: tone === "money" ? formatMoneyNumber(text) : text, tone };
  });
}
