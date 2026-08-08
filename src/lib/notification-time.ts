import type { AppLocale } from "@/i18n/routing";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function toLocaleCode(locale: AppLocale) {
  return locale === "ar" ? "ar-EG" : "en-IL";
}

export function formatNotificationRelativeTime(value: string, locale: AppLocale) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  if (diffMs < 45 * SECOND_MS) {
    return locale === "ar" ? "الآن" : "Just now";
  }

  const todayStart = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
  const yesterdayStart = todayStart - DAY_MS;
  if (timestamp >= yesterdayStart && timestamp < todayStart) {
    return locale === "ar" ? "أمس" : "Yesterday";
  }

  const rtf = new Intl.RelativeTimeFormat(toLocaleCode(locale), { numeric: "auto" });
  if (diffMs < HOUR_MS) {
    return rtf.format(-Math.max(1, Math.floor(diffMs / MINUTE_MS)), "minute");
  }
  if (diffMs < DAY_MS) {
    return rtf.format(-Math.max(1, Math.floor(diffMs / HOUR_MS)), "hour");
  }
  if (diffMs < 7 * DAY_MS) {
    return rtf.format(-Math.max(1, Math.floor(diffMs / DAY_MS)), "day");
  }

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(toLocaleCode(locale), sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" });
}
