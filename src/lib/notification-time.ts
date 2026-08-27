import type { AppLocale } from "@/i18n/routing";
import { ISRAEL_TIME_ZONE, israelCalendarDayNumber } from "@/lib/israel-calendar";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function toLocaleCode(locale: AppLocale) {
  return locale === "ar" ? "ar-IL-u-nu-latn" : "en-IL";
}

export function formatNotificationRelativeTime(value: string, locale: AppLocale) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  if (diffMs < 45 * SECOND_MS) {
    return locale === "ar" ? "الآن" : "Just now";
  }

  const calendarDayDifference = israelCalendarDayNumber(now) - israelCalendarDayNumber(timestamp);
  if (calendarDayDifference === 1) {
    return locale === "ar" ? "أمس" : "Yesterday";
  }

  const rtf = new Intl.RelativeTimeFormat(toLocaleCode(locale), { numeric: "auto" });
  if (diffMs < HOUR_MS) {
    return rtf.format(-Math.max(1, Math.floor(diffMs / MINUTE_MS)), "minute");
  }
  if (diffMs < DAY_MS) {
    return rtf.format(-Math.max(1, Math.floor(diffMs / HOUR_MS)), "hour");
  }
  if (calendarDayDifference > 0 && calendarDayDifference < 7) {
    return rtf.format(-calendarDayDifference, "day");
  }

  const date = new Date(timestamp);
  const sameYear = new Intl.DateTimeFormat("en", { timeZone: ISRAEL_TIME_ZONE, year: "numeric" }).format(date)
    === new Intl.DateTimeFormat("en", { timeZone: ISRAEL_TIME_ZONE, year: "numeric" }).format(now);
  return date.toLocaleDateString(toLocaleCode(locale), sameYear
    ? { timeZone: ISRAEL_TIME_ZONE, month: "short", day: "numeric" }
    : { timeZone: ISRAEL_TIME_ZONE, year: "numeric", month: "short", day: "numeric" });
}
