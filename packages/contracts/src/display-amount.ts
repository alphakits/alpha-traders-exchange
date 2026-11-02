import { canonicalizeNonNegativeTradeAmount } from "./trade-amount";

// Presentation only. Never pass formatted output to payment or identity APIs.
const digit = "[0-9٠-٩۰-۹]";
const integer = digit + "+(?:[,٬]" + digit + "{3})*";
const numeric = "[+−-]?" + integer + "(?:[.٫]" + digit + "+)?";
const gap = "[ \\t\\u00a0\\u202f]*";
const range = numeric + "(?:" + gap + "(?:[–—-]|\\bto\\b|إلى)" + gap + numeric + ")?";
const arabicPrefix = "(?:[وف]?(?:بال|كال|لل|ال|ب|ك|ل)?)";
const arabicEnding = "(?:[\\u064b-\\u065f\\u0670]+ا?|ا[\\u064b-\\u065f\\u0670]*)?";
const currency = "(?:USDT|USD|ILS|NIS|\\$|₪|" + arabicPrefix + "(?:دولار(?:ات)?|شي[كق]ل|شاقل)" + arabicEnding + ")";
const moneyWord = "(?:amounts?|prices?|" + arabicPrefix + "(?:مبلغ|مبالغ|سعر|أسعار|اسعار|كمية|كميات|مقدار)" + arabicEnding + ")";
const brand = "\\balpha\\s+traders\\b|[أاآ]لفا\\s+تريدرز";
const identifierPart = /[\p{L}\p{N}_]/u;
const currencyEnd = "(?![\\p{L}_])";
const boundedLabel = moneyWord + "(?![\\p{L}\\p{N}_])";
const monetaryNumber = "(?:" + range + gap + currency + currencyEnd + "|" + currency + currencyEnd + gap + range + ")";
const amountToken = "(?:" + monetaryNumber + "|" + currency + currencyEnd + "|[$₪])";
const labelSeparator = "(?:" + gap + "[:：=]" + gap + "|[ \\t]+(?:(?:is|of|to|from|هو|إلى|من)[ \\t]+)?)";
const labelledValue = boundedLabel + "(?:" + labelSeparator + "(?:" + monetaryNumber + "|" + range + "))?";
const quantityWord = "(?:trades?|listings?|users?|members?|lessons?|students?|views?|visits?|reviews?|requests?|messages?|orders?|items?|days?|hours?|minutes?|points?|results?|bytes?|KB|MB|GB|" + arabicPrefix + "(?:صفقات|صفقة|إعلان(?:ات)?|مستخدم(?:ين|ون)?|أعضاء|عضو|طلاب|طالب|دروس|درس|مشاهد(?:ة|ات)|طلبات|طلب|رسائل|رسالة|نقطة|نقاط))";
const quantityUnit = new RegExp("^\\+?\\s*" + quantityWord + "(?![\\p{L}\\p{N}_])", "iu");
const quantityLabel = new RegExp("(?:^|[^\\p{L}\\p{N}_])" + quantityWord + "\\s*[:：=]\\s*$", "iu");
const trailingWord = /[\p{L}\p{N}_]$/u;

// Consume URLs, addresses and opaque words as single tokens so neither their text nor their
// punctuation acquires number grouping. A trailing percentage/date/code is never a price.
// Match maximal local parts in one pass (without lookbehind, for native JS engines).
const opaqueCandidate = /(?:https?:\/\/|www\.)[^\s<>]+|[\p{L}\p{N}._%+-]+(?:@[\p{L}\p{N}.-]+\.[\p{L}]{2,})?/giu;
const plainWord = "[\\p{L}_][\\p{L}\\p{N}_]*";
const tokens = new RegExp(
  "(" + brand + ")|(" + amountToken + "|" + labelledValue + ")|(" + numeric + ")|" + plainWord, "giu",
);
const emphasisHint = /alpha|[أاآ]لفا|usdt?|ils|nis|[$₪]|دولار|شي[كق]ل|شاقل|amount|price|مبلغ|مبالغ|سعر|[أا]سعار|كمية|كميات|مقدار/i;
const displayNumber = /[0-9٠-٩۰-۹]+(?:[,٬][0-9٠-٩۰-۹]{3})*(?:[.٫][0-9٠-٩۰-۹]+)?/g;

const listingCardNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Two-decimal presentation for USDT quantities on listing cards. */
export function formatListingCardUsdt(value: string | number | null | undefined): string {
  const amount = canonicalizeNonNegativeTradeAmount(value);
  return amount === null ? "—" : listingCardNumber.format(amount as `${number}`);
}

/** Group the integer part of a monetary display without rounding or numeric conversion. */
export function formatMoneyNumber(value: string | number): string {
  return String(value).replace(displayNumber, raw => {
    const separator = raw.search(/[.٫]/);
    const whole = (separator === -1 ? raw : raw.slice(0, separator)).replace(/[,٬]/g, "");
    if (whole.length <= 3) return raw;
    const lead = whole.length % 3 || 3;
    const groups = [whole.slice(0, lead)];
    for (let index = lead; index < whole.length; index += 3) groups.push(whole.slice(index, index + 3));
    return groups.join(",") + (separator === -1 ? "" : raw.slice(separator));
  });
}

export type AccentPart = { text: string; tone: "money" | "brand" | null };
export type AccentOptions = { groupNumbers?: boolean; groupQuantities?: boolean };

export function splitAccentText(value: string, options: AccentOptions = {}): AccentPart[] | null {
  if (!emphasisHint.test(value) && !(options.groupQuantities && /[0-9٠-٩۰-۹]{4}/.test(value))) return null;
  const parts: AccentPart[] = [];
  const protectedRanges: { start: number; end: number }[] = [];
  if (/@|https?:\/\/|www\./i.test(value)) {
    for (const match of value.matchAll(opaqueCandidate)) {
      if (match[0].includes("@") || /^(?:https?:\/\/|www\.)/i.test(match[0])) {
        protectedRanges.push({ start: match.index!, end: match.index! + match[0].length });
      }
    }
  }
  let rangeIndex = 0;
  let offset = 0;
  for (const match of value.matchAll(tokens)) {
    const [raw, branded, monetary, number] = match;
    if (!branded && !monetary && !(options.groupQuantities && number)) continue;
    const start = match.index!;
    const end = start + raw.length;
    while (rangeIndex < protectedRanges.length && protectedRanges[rangeIndex]!.end <= start) rangeIndex++;
    if (rangeIndex < protectedRanges.length && protectedRanges[rangeIndex]!.start < end) continue;
    if ((identifierPart.test(raw[0] ?? "") && identifierPart.test(value[start - 1] ?? "")) ||
        (trailingWord.test(raw) && identifierPart.test(value[end] ?? ""))) continue;
    if (number) {
      const afterLabel = quantityLabel.test(value.slice(Math.max(0, start - 40), start));
      if ((!afterLabel && !quantityUnit.test(value.slice(end, end + 34))) || /^[0٠۰]/.test(raw) ||
          (!afterLabel && /[-/+:.#\d]/.test(value[start - 1] ?? ""))) continue;
    }
    const tone = branded ? "brand" : monetary ? "money" : null;
    const text = !branded && options.groupNumbers !== false ? formatMoneyNumber(raw) : raw;
    if (!tone && text === raw) continue;
    if (start > offset) parts.push({ text: value.slice(offset, start), tone: null });
    parts.push({ text, tone });
    offset = end;
  }
  if (!parts.length) return null;
  if (offset < value.length) parts.push({ text: value.slice(offset), tone: null });
  return parts;
}

