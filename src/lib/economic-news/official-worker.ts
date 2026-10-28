import "server-only";
import snapshot from "./weekly-calendar.json";
import { weeklyCalendarSchema } from "./weekly-schema";
import { newsDayKey, newsWeekRange } from "./model";
import { collectOfficialResults } from "./official-fetch";
import { acquireOfficialNewsLease, readOfficialResults, saveOfficialResults } from "./official-storage";
import { logEvent } from "@/lib/structured-logging";

export async function runOfficialNewsSync(now = Date.now()) {
  const calendar = weeklyCalendarSchema.parse(snapshot);
  if (now < Date.parse(calendar.verifiedAt) || now >= Date.parse(calendar.coverageEnd)) return { status: "unavailable", synced: false, releases: 0, sent: 0, failed: 0 };
  const lease = await acquireOfficialNewsLease(now);
  if (!lease) return { status: "unavailable", synced: false, releases: 0, sent: 0, failed: 0 };
  const current = (await readOfficialResults(calendar, now)).calendar;
  const start = newsWeekRange(now, "Asia/Jerusalem", -1).start;
  const minute = Math.floor(now / 60_000);
  const due = current.events.filter(event => {
    const age = now - Date.parse(event.scheduledAt);
    if (age < 0 || event.timing !== "exact" || newsDayKey(event.scheduledAt, "Asia/Jerusalem") < start) return false;
    // Unpublished reports stay eligible even if the official publisher is late.
    // Check today's published reports each minute, older corrections hourly.
    return (event.actual === null && !event.outcome) || age < 24 * 60 * 60_000 || minute % 60 === 0;
  });
  const collected = await collectOfficialResults(due, now);
  const checkedAt = Date.now();
  const changed = await saveOfficialResults(lease, calendar, collected.results, checkedAt, { checked: collected.checked,
    pending: collected.pending, failed: collected.failed, unsupported: collected.unsupported });
  logEvent(collected.failed.length ? "warn" : "info", { event: "official_news_sync", outcome: collected.failed.length ? "failed" : "success",
    metadata: { checked: collected.checked.length, changed, failed: collected.failed, pending: collected.pending, editorialPending: collected.unsupported.length } });
  return { status: collected.failed.length ? "partial" : "ready", synced: true, releases: changed, sent: 0, failed: collected.failed.length,
    checked: collected.checked.length, pending: collected.pending.length, editorialPending: collected.unsupported.length };
}
