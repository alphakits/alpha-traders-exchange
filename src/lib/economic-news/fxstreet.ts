import "server-only";
import { z } from "zod";
import { NEWS_CALENDAR_WINDOW_MS, arabicEventTitle, type NewsEvent } from "./model";

// Contract: https://calendar-api.fxstreet.com/swagger/v1/openapi.json
// OAuth: https://docs.fxstreet.com/api/authentication/oauth2/v2/
const numeric = z.number().finite().nullish();
const occurrence = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(250),
  dateUtc: z.string().datetime({ offset: true }),
  periodDateUtc: z.string().datetime({ offset: true }).nullish(),
  countryCode: z.string(), currencyCode: z.string(),
  volatility: z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]).nullish(),
  actual: numeric, consensus: numeric, previous: numeric, revised: numeric,
  unit: z.string().trim().max(40).nullish(), potency: z.enum(["ZERO", "K", "M", "B", "T"]).nullish(),
  isAllDay: z.boolean(), isTentative: z.boolean(), isSpeech: z.boolean().nullish(),
  lastUpdated: z.number().int().positive().max(253402300799).nullish(),
});

export function normalizeFxStreetNews(raw: unknown, now = new Date()): NewsEvent[] {
  const rows = z.array(occurrence).max(1500).parse(raw);
  const events = new Map<string, NewsEvent>();
  for (const row of rows) {
    if (row.countryCode.toUpperCase() !== "US" || row.currencyCode.toUpperCase() !== "USD" || row.volatility !== "HIGH") continue;
    const potency = row.potency && row.potency !== "ZERO" ? row.potency : "";
    const unit = row.unit || "";
    const formatValue = (value: number | null | undefined) => value == null ? null
      : `${value}${potency}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
    const providerId = row.id.toLowerCase();
    const event: NewsEvent = {
      id: `fxs-${providerId}`, providerId, title: row.name, titleAr: arabicEventTitle(row.name),
      scheduledAt: new Date(row.dateUtc).toISOString(), currency: "USD", impact: "high",
      actual: formatValue(row.actual), forecast: formatValue(row.consensus), previous: formatValue(row.previous),
      revised: formatValue(row.revised), reference: row.periodDateUtc?.slice(0, 10) ?? null,
      // The list endpoint does not include a publisher. Do not invent one.
      source: "", sourceUrl: null,
      providerUpdatedAt: row.lastUpdated == null ? null : new Date(row.lastUpdated * 1000).toISOString(),
      syncedAt: now.toISOString(), timing: row.isAllDay || row.isTentative ? "tentative" : "exact",
      kind: row.isSpeech || /speech|speaks|conference|minutes|statement|projections/i.test(row.name) ? "speech" : "release",
    };
    const prior = events.get(event.id);
    if (!prior || (event.providerUpdatedAt ?? "") > (prior.providerUpdatedAt ?? "")) events.set(event.id, event);
  }
  return [...events.values()].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

type Credentials = { clientId: string; clientSecret: string };
type Token = Credentials & { value: string; expiresAt: number };
let token: Token | undefined;
let pendingToken: { credentials: Credentials; promise: Promise<Token> } | undefined;
const sameCredentials = (a: Credentials, b: Credentials) => a.clientId === b.clientId && a.clientSecret === b.clientSecret;

async function readJson(response: Response, maxLength: number) {
  if (!response.ok || Number(response.headers.get("content-length") || 0) > maxLength) throw new Error("Economic news provider unavailable");
  const body = await response.text();
  if (body.length > maxLength) throw new Error("Economic news response too large");
  return JSON.parse(body) as unknown;
}

async function accessToken(credentials: Credentials) {
  if (token && sameCredentials(token, credentials) && token.expiresAt > Date.now() + 60_000) return token.value;
  if (pendingToken && sameCredentials(pendingToken.credentials, credentials)) return (await pendingToken.promise).value;
  const promise = (async (): Promise<Token> => {
    const response = await fetch("https://authorization.fxstreet.com/v2/token", {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: credentials.clientId,
        client_secret: credentials.clientSecret, scope: "calendar" }),
    });
    const data = z.object({ access_token: z.string().min(1).max(16_000), token_type: z.literal("Bearer"),
      expires_in: z.number().positive().max(86_400) }).parse(await readJson(response, 32_000));
    token = { ...credentials, value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return token;
  })();
  const pending = { credentials, promise };
  pendingToken = pending;
  try { return (await promise).value; }
  finally { if (pendingToken === pending) pendingToken = undefined; }
}

export async function fetchFxStreetNews(now: Date, credentials: Credentials): Promise<NewsEvent[]> {
  try {
    const start = new Date(now.getTime() - NEWS_CALENDAR_WINDOW_MS).toISOString().slice(0, 10);
    const end = new Date(now.getTime() + NEWS_CALENDAR_WINDOW_MS).toISOString().slice(0, 10);
    const url = new URL(`https://calendar-api.fxstreet.com/en/api/v1/eventDates/${start}T00:00:00.000Z/${end}T23:59:59.999Z`);
    url.searchParams.set("countries", "US");
    url.searchParams.set("volatilities", "HIGH");
    const request = async () => {
      const bearer = await accessToken(credentials);
      return fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
        headers: { Authorization: `Bearer ${bearer}` } });
    };
    let response = await request();
    if (response.status === 401) {
      // One refresh for an expired/revoked token; never loop on a denied licence.
      token = undefined;
      response = await request();
    }
    return normalizeFxStreetNews(await readJson(response, 2_000_000), now).filter((event) => (
      event.scheduledAt.slice(0, 10) >= start && event.scheduledAt.slice(0, 10) <= end
    ));
  } catch {
    // Never leak credentials, URLs, tokens or provider payloads to logs/API errors.
    throw new Error("Economic news provider unavailable");
  }
}
