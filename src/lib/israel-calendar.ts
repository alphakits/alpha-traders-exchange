export const ISRAEL_TIME_ZONE = "Asia/Jerusalem";

export function formatIsraelCalendarDateKey(value: string | number | Date) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function israelCalendarDayNumber(value: string | number | Date) {
  const key = formatIsraelCalendarDateKey(value);
  if (!key) return Number.NaN;
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / (24 * 60 * 60 * 1000);
}
