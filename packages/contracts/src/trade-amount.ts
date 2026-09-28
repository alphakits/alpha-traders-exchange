export type LocalizedDecimalInputOptions = {
  maximumFractionDigits: number;
  maximumWholeDigits?: number;
};

type ParsedLocalizedDecimal = {
  fractionPart: string | null;
  wholePart: string;
};

const DEFAULT_MAXIMUM_WHOLE_DIGITS = 12;
const TRADE_AMOUNT_OPTIONS = {
  maximumFractionDigits: 6,
  maximumWholeDigits: DEFAULT_MAXIMUM_WHOLE_DIGITS,
} as const;

function normalizeLocalizedDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}

function isValidGroupedInteger(value: string, separator: "," | ".") {
  const groups = value.split(separator);
  const firstGroup = groups[0] ?? "";
  return groups.length > 1
    && /^[1-9]\d{0,2}$/.test(firstGroup)
    && groups.slice(1).every((group) => /^\d{3}$/.test(group));
}

/**
 * Splits a localized decimal without guessing through malformed punctuation.
 * A lone comma followed by a valid three-digit group (`1,000`) is grouping;
 * otherwise a lone comma is a decimal mark (`12,5`). Multiple equal marks are
 * accepted only when they form valid thousands groups.
 */
function parseLocalizedDecimal(value: string | number | null | undefined): ParsedLocalizedDecimal | null {
  const localized = normalizeLocalizedDigits(String(value ?? "").trim());
  if (!localized) return { wholePart: "", fractionPart: null };
  if (!/^[\d.,٫٬]+$/.test(localized)) return null;

  const hasArabicGrouping = localized.includes("٬");
  const hasArabicDecimal = localized.includes("٫");
  const normalized = localized.replace(/٫/g, ".").replace(/٬/g, ",");
  const commaCount = (normalized.match(/,/g) ?? []).length;
  const dotCount = (normalized.match(/\./g) ?? []).length;

  // Arabic thousands marks are not decimal marks. Keep that distinction even
  // when there is no decimal separator to disambiguate the number.
  if (hasArabicGrouping && !hasArabicDecimal && dotCount === 0) {
    if (!isValidGroupedInteger(normalized, ",")) return null;
    return { wholePart: normalized.replace(/,/g, ""), fractionPart: null };
  }

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = normalized.lastIndexOf(",");
    const lastDot = normalized.lastIndexOf(".");
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    const decimalCount = decimalSeparator === "," ? commaCount : dotCount;
    if (decimalCount !== 1) return null;

    const decimalIndex = normalized.lastIndexOf(decimalSeparator);
    const groupedWhole = normalized.slice(0, decimalIndex);
    const fractionPart = normalized.slice(decimalIndex + 1);
    if (!isValidGroupedInteger(groupedWhole, groupingSeparator)) return null;
    if (fractionPart && !/^\d+$/.test(fractionPart)) return null;
    return {
      wholePart: groupedWhole.split(groupingSeparator).join(""),
      fractionPart,
    };
  }

  if (commaCount > 0) {
    if (commaCount > 1) {
      if (!isValidGroupedInteger(normalized, ",")) return null;
      return { wholePart: normalized.replace(/,/g, ""), fractionPart: null };
    }

    const [wholePart = "", fractionPart = ""] = normalized.split(",");
    if (wholePart && fractionPart.length === 3 && /^[1-9]\d{0,2}$/.test(wholePart)) {
      return { wholePart: `${wholePart}${fractionPart}`, fractionPart: null };
    }
    return { wholePart, fractionPart };
  }

  if (dotCount > 1) return null;
  if (dotCount === 1) {
    const [wholePart = "", fractionPart = ""] = normalized.split(".");
    return { wholePart, fractionPart };
  }

  return { wholePart: normalized, fractionPart: null };
}

/** Keeps a localized decimal field editable while enforcing precision limits. */
export function normalizeLocalizedDecimalInput(
  value: string | number | null | undefined,
  options: LocalizedDecimalInputOptions,
) {
  const parsed = parseLocalizedDecimal(value);
  if (!parsed) return "";

  const maximumWholeDigits = options.maximumWholeDigits ?? DEFAULT_MAXIMUM_WHOLE_DIGITS;
  const wholePart = (parsed.wholePart || "0")
    .replace(/^0+(?=\d)/, "")
    .slice(0, maximumWholeDigits);
  if (parsed.fractionPart === null) return parsed.wholePart ? wholePart : "";
  if (options.maximumFractionDigits <= 0) return wholePart;
  return `${wholePart}.${parsed.fractionPart.slice(0, options.maximumFractionDigits)}`;
}

export function normalizeTradeAmountInput(value: string | number | null | undefined) {
  return normalizeLocalizedDecimalInput(value, TRADE_AMOUNT_OPTIONS);
}

function canonicalizeAmount(value: string | number | null | undefined, allowZero: boolean) {
  const parsed = parseLocalizedDecimal(value);
  if (!parsed || (!parsed.wholePart && parsed.fractionPart === null)) return null;
  if (parsed.fractionPart === "") return null;

  const wholePart = parsed.wholePart || "0";
  const fractionPart = parsed.fractionPart ?? "";
  if (wholePart.length > TRADE_AMOUNT_OPTIONS.maximumWholeDigits) return null;
  if (fractionPart.length > TRADE_AMOUNT_OPTIONS.maximumFractionDigits) return null;
  if (!/^\d+$/.test(wholePart) || (fractionPart && !/^\d+$/.test(fractionPart))) return null;
  if (wholePart.length > 1 && wholePart.startsWith("0")) return null;

  const canonicalFraction = fractionPart.replace(/0+$/, "");
  const canonical = canonicalFraction ? `${wholePart}.${canonicalFraction}` : wholePart;
  const isPositive = wholePart !== "0" || /[1-9]/.test(canonicalFraction);
  return isPositive || allowZero ? canonical : null;
}

export function canonicalizeTradeAmount(value: string | number | null | undefined) {
  return canonicalizeAmount(value, false);
}

export function canonicalizeNonNegativeTradeAmount(value: string | number | null | undefined) {
  return canonicalizeAmount(value, true);
}
