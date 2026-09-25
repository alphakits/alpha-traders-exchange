/** Reporting boundaries only. Never changes the database or server timezone. */
export const OWNER_ANALYTICS_TIME_ZONE = "Asia/Jerusalem";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: OWNER_ANALYTICS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A sortable Israel-local date key, also used by the development memory store. */
export function ownerAnalyticsDateKey(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new RangeError("Invalid analytics date.");
  const parts = dateFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
