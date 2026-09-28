import "server-only";
import { z } from "zod";
import { arabicEventTitle, type NewsEvent } from "./model";

// No scraping or demo credentials. Activation requires a licensed server-side feed.
export function newsProviderConfigured(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.ECONOMIC_NEWS_PROVIDER === "trading-economics"
    && env.ECONOMIC_NEWS_DATA_LICENSE_CONFIRMED === "true"
    && Boolean(env.TRADING_ECONOMICS_API_KEY?.trim());
}

const value = z.union([z.string(), z.number()]).nullish();
const providerEvent = z.object({
  CalendarId: z.union([z.string(), z.number()]), Date: z.string(), Country: z.string(),
  Currency: z.string().nullish(), Importance: z.union([z.string(), z.number()]),
  Event: z.string().min(1).max(250), Actual: value, Forecast: value, Previous: value,
  Revised: value, Reference: value, Source: z.string().nullish(), SourceURL: z.string().nullish(),
  LastUpdate: z.string(), DateSpan: z.union([z.string(), z.number()]).nullish(),
});

function utcTimestamp(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(raw)) throw new Error("Invalid news timestamp");
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : `${raw}Z`);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid news timestamp");
  return date.toISOString();
}

function resultValue(raw: string | number | null | undefined) {
  const text = raw == null ? "" : String(raw).trim();
  return !text || /^(?:null|n\/a|na|--)$/i.test(text) ? null : text.slice(0, 80);
}

function sourceUrl(raw: string | null | undefined) {
  try {
    const url = new URL(raw ?? "");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export function normalizeEconomicNews(raw: unknown, now = new Date()): NewsEvent[] {
  const rows = z.array(providerEvent).max(1500).parse(raw);
  const events = new Map<string, NewsEvent>();
  for (const row of rows) {
    if (row.Country.toLowerCase() !== "united states" || Number(row.Importance) !== 3) continue;
    const currency = row.Currency?.trim().toUpperCase();
    if (currency && currency !== "USD" && currency !== "$") continue;
    const providerId = String(row.CalendarId);
    if (!/^\d{1,24}$/.test(providerId)) throw new Error("Invalid news event identifier");
    const scheduledAt = utcTimestamp(row.Date);
    const id = `te-${providerId}`;
    const event: NewsEvent = {
      id, providerId, title: row.Event, titleAr: arabicEventTitle(row.Event), scheduledAt,
      currency: "USD", impact: "high", actual: resultValue(row.Actual), forecast: resultValue(row.Forecast),
      previous: resultValue(row.Previous), revised: resultValue(row.Revised), reference: resultValue(row.Reference),
      source: row.Source?.trim().slice(0, 200) || "Trading Economics", sourceUrl: sourceUrl(row.SourceURL),
      providerUpdatedAt: utcTimestamp(row.LastUpdate), syncedAt: now.toISOString(),
      timing: Number(row.DateSpan ?? 0) === 0 ? "exact" : "tentative",
      kind: /speech|speaks|conference|minutes|statement|projections/i.test(row.Event) ? "speech" : "release",
    };
    const prior = events.get(id);
    if (!prior || event.providerUpdatedAt > prior.providerUpdatedAt) events.set(id, event);
  }
  return [...events.values()].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export async function fetchEconomicNews(now = new Date()): Promise<NewsEvent[]> {
  if (!newsProviderConfigured()) throw new Error("News provider is not configured");
  const start = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const url = new URL(`https://api.tradingeconomics.com/calendar/country/united%20states/${start}/${end}`);
  url.searchParams.set("c", process.env.TRADING_ECONOMICS_API_KEY!.trim());
  url.searchParams.set("importance", "3");
  url.searchParams.set("f", "json");
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  // Never include provider URLs, credentials, response bodies, or personal data in errors.
  if (!response.ok) throw new Error("Economic news provider unavailable");
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error("Economic news response too large");
  return normalizeEconomicNews(JSON.parse(body), now).filter((event) => (
    event.scheduledAt.slice(0, 10) >= start && event.scheduledAt.slice(0, 10) <= end
  ));
}
