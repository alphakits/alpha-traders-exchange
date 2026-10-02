import { z } from "zod";
import { newsEventId } from "./model";

const officialHosts = {
  bls: ["bls.gov", "www.bls.gov"],
  bea: ["bea.gov", "www.bea.gov"],
  dol: ["dol.gov", "www.dol.gov"],
  fed: ["federalreserve.gov", "www.federalreserve.gov"],
  census: ["census.gov", "www.census.gov"],
};
const utc = z.iso.datetime({ precision: 0 });
const value = z.string().min(1).max(60).nullable();
const eventSchema = z.object({
  id: z.string().refine((id) => Boolean(newsEventId(id)) && id.startsWith("official-")),
  agency: z.enum(["bls", "bea", "dol", "fed", "census"]),
  title: z.string().trim().min(1).max(120),
  titleAr: z.string().trim().min(1).max(160),
  scheduledAt: utc,
  timing: z.enum(["exact", "tentative"]),
  kind: z.enum(["release", "speech"]),
  actual: value,
  previous: value,
  revised: value,
  reference: z.string().min(1).max(80).nullable(),
  publishedAt: utc.nullable(),
  sourceUrl: z.url(),
}).strict();

// Shared by the server and the build gate. Weekly updates change only the JSON;
// no arbitrary URLs, consensus forecasts or future actuals can enter the feed.
export const weeklyCalendarSchema = z.object({
  version: z.literal(1),
  verifiedAt: utc,
  coverageStart: utc,
  coverageEnd: utc,
  events: z.array(eventSchema).min(1).max(150),
}).strict().superRefine((calendar, ctx) => {
  const start = Date.parse(calendar.coverageStart);
  const end = Date.parse(calendar.coverageEnd);
  const verified = Date.parse(calendar.verifiedAt);
  const day = 86_400_000;
  if (start > verified || end <= verified || end - start > 45 * day) {
    ctx.addIssue({ code: "custom", message: "Invalid snapshot coverage" });
  }
  const ids = new Set<string>();
  calendar.events.forEach((event, index) => {
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message, path: ["events", index] });
    if (ids.has(event.id)) invalid("Duplicate event ID");
    ids.add(event.id);
    if (!event.id.startsWith(`official-${event.agency}-`)) invalid("Event agency mismatch");
    try {
      const url = new URL(event.sourceUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !officialHosts[event.agency].includes(url.hostname)) {
        invalid("Unapproved source URL");
      }
    } catch { invalid("Invalid source URL"); }
    const scheduled = Date.parse(event.scheduledAt);
    if (scheduled < start || scheduled >= end) invalid("Event outside snapshot coverage");
    if (event.actual !== null && (!event.publishedAt || Date.parse(event.publishedAt) > verified
      || Date.parse(event.publishedAt) < scheduled || event.timing !== "exact")) {
      invalid("Actual needs a confirmed publication at or after release and before verification");
    }
    if (event.actual === null && event.publishedAt !== null) invalid("Publication time requires a confirmed numeric result");
  });
});

export type WeeklyCalendar = z.infer<typeof weeklyCalendarSchema>;
