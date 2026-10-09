import { newsEventStatus, type NewsEvent, type NewsLocale } from "./model";

export type NewsResultTone = "positive" | "negative" | "neutral";
type ResultMeaning = { tone: NewsResultTone; label: string };
const scales: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

// Parse the whole value: ranges, text, missing data and incompatible units must
// never produce a misleading red/green result. Source strings stay unchanged.
function numericResult(raw: string | null) {
  if (raw === null) return null;
  const text = raw.trim().replace(/\u2212/g, "-").replace(/^([+-])\$/, "$$$1");
  const match = /^(\$?)([+-]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)([%KMBT]?)$/i.exec(text);
  if (!match) return null;
  const suffix = match[4].toUpperCase();
  const scale = scales[suffix] ?? 1;
  const value = Number(`${match[2]}${match[3].replaceAll(",", "")}`) * scale;
  return Number.isFinite(value) ? { value, unit: `${match[1]}${suffix === "%" ? "%" : "number"}`, sign: match[2] } : null;
}

// These are comparisons of the reported economic measure, not a prediction for
// USD, crypto or equities. Inflation, wages, rates and Fed remarks can have mixed
// implications, so an unsigned reading for those series stays neutral.
function comparisonDirection(title: string) {
  if (/unemployment rate|(?:initial|continuing).*claims|jobless claims|unemployment claims/i.test(title)) return -1;
  if (/non[ -]?farm.*(?:payroll|employment)|adp.*employment|gdp|gross domestic product|retail sales|durable goods|industrial production|consumer confidence|trade balance/i.test(title)) return 1;
  return 0;
}

export function newsResultMeaning(event: NewsEvent, locale: NewsLocale, now: number): ResultMeaning {
  const isAr = locale === "ar";
  const neutral = { tone: "neutral" as const, label: isAr ? "يعتمد على السياق" : "Context dependent" };
  if (event.kind !== "release" || newsEventStatus(event, now) !== "released"
    || (event.publishedAt && Date.parse(event.publishedAt) > now)) return neutral;
  const actual = numericResult(event.actual);
  if (!actual) return neutral;

  // An explicit minus/plus keeps its literal meaning. A deficit must not look
  // like a positive number just because it is smaller than a previous deficit.
  if (actual.value < 0) return { tone: "negative", label: isAr ? "قيمة سالبة" : "Negative value" };
  if (actual.sign === "+" && actual.value > 0) return { tone: "positive", label: isAr ? "قيمة موجبة" : "Positive value" };

  const direction = comparisonDirection(event.title);
  if (!direction) return actual.value === 0 ? { tone: "neutral", label: isAr ? "صفر" : "Zero" } : neutral;
  const candidates = [
    { raw: event.forecast, above: isAr ? "أعلى من المتوقع" : "Above forecast", below: isAr ? "أقل من المتوقع" : "Below forecast", equal: isAr ? "مطابق للتوقعات" : "In line with forecast" },
    { raw: event.revised, above: isAr ? "أعلى من السابق المعدّل" : "Above revised previous", below: isAr ? "أقل من السابق المعدّل" : "Below revised previous", equal: isAr ? "دون تغيير عن السابق المعدّل" : "Unchanged vs revised previous" },
    { raw: event.previous, above: isAr ? "أعلى من السابق" : "Above previous", below: isAr ? "أقل من السابق" : "Below previous", equal: isAr ? "دون تغيير عن السابق" : "Unchanged vs previous" },
  ];
  for (const candidate of candidates) {
    const baseline = numericResult(candidate.raw);
    if (!baseline || baseline.unit !== actual.unit) continue;
    const change = Math.sign(actual.value - baseline.value);
    return { tone: change === 0 ? "neutral" : change * direction > 0 ? "positive" : "negative",
      label: change === 0 ? candidate.equal : change > 0 ? candidate.above : candidate.below };
  }
  if (actual.value === 0) return { tone: "neutral", label: isAr ? "صفر" : "Zero" };
  return direction === 1 ? { tone: "positive", label: isAr ? "قيمة موجبة" : "Positive value" }
    : { tone: "neutral", label: isAr ? "لا توجد مقارنة" : "No comparison" };
}
