import type { MarketPair } from "@/types/market";
import { FX_MAX_CLOSED_AGE_MS, FX_MAX_QUOTE_AGE_MS, isFxPairUsable, USD_ILS_REFERENCE_SYMBOL } from "@/lib/fx-reference-policy";

const WISE_QUOTE_URL = "https://api.wise.com/2026Q4/quotes";

/** Normalized quote shared by provider parsing and all pricing consumers. */
export function parseFxReference(payload: unknown, symbol: string, now = Date.now()): MarketPair | null {
  if (symbol !== USD_ILS_REFERENCE_SYMBOL) return null;
  if (!payload || typeof payload !== "object") return null;
  const quote = payload as Record<string, unknown>;
  if (quote.base !== "USD" || quote.quote !== "ILS" || quote.symbol !== symbol) return null;
  if (typeof quote.price !== "number" || typeof quote.quotedAt !== "string") return null;
  if (quote.marketState !== "open" && quote.marketState !== "closed") return null;
  const quotedAt = Date.parse(quote.quotedAt);
  if (!Number.isFinite(quotedAt)) return null;
  // A closure must come from the provider, with an explicit next-open time.
  // Receipt of a response can never extend the source quote's lifetime.
  const validUntil = quote.marketState === "open"
    ? quotedAt + FX_MAX_QUOTE_AGE_MS
    : typeof quote.nextOpenAt === "string" ? Math.min(Date.parse(quote.nextOpenAt), quotedAt + FX_MAX_CLOSED_AGE_MS) : NaN;
  if (!Number.isFinite(validUntil)) return null;
  const pair: MarketPair = {
    key: "usdtIls", label: "USD / ILS", price: quote.price,
    source: symbol, reference: "USD/ILS benchmark for USDT listings",
    changePercent: typeof quote.changePercent === "number" && Number.isFinite(quote.changePercent) ? quote.changePercent : null,
    quotedAt: new Date(quotedAt).toISOString(), validUntil: new Date(validUntil).toISOString(),
    quoteStatus: quote.marketState === "open" ? "live" : "closed",
  };
  return isFxPairUsable(pair, now) ? pair : null;
}

function zonedParts(time: number, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", weekday: "short",
    hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
  }).formatToParts(time).map(({ type, value }) => [type, value]));
}

function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string) {
  const local = Date.UTC(year, month - 1, day, hour);
  let time = local;
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = zonedParts(time, timeZone);
    const rendered = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    time += local - rendered;
  }
  return time;
}

/** Wise's published weekly closure: Friday 17:00 New York to Monday 09:00 Auckland. */
export function wiseWeekendWindow(now: number): { closedAt: number; opensAt: number } | null {
  const ny = zonedParts(now, "America/New_York");
  if (!(ny.weekday === "Fri" && +ny.hour >= 17) && ny.weekday !== "Sat" && ny.weekday !== "Sun") return null;
  const nz = zonedParts(now, "Pacific/Auckland");
  if (nz.weekday === "Mon" && +nz.hour >= 9) return null;
  const daysFromFriday = ny.weekday === "Fri" ? 0 : ny.weekday === "Sat" ? 1 : 2;
  const daysToMonday = nz.weekday === "Sat" ? 2 : nz.weekday === "Sun" ? 1 : 0;
  return {
    closedAt: zonedTime(+ny.year, +ny.month, +ny.day - daysFromFriday, 17, "America/New_York"),
    opensAt: zonedTime(+nz.year, +nz.month, +nz.day + daysToMonday, 9, "Pacific/Auckland"),
  };
}

/** Read only the mid-market rate, never the amount after Wise's transfer fees. */
export function parseWiseReference(payload: unknown, now = Date.now()): MarketPair | null {
  if (!payload || typeof payload !== "object") return null;
  const quote = payload as Record<string, unknown>;
  if (quote.sourceCurrency !== "USD" || quote.targetCurrency !== "ILS" || quote.status !== "PENDING") return null;
  if (typeof quote.rate !== "number" || typeof quote.rateTimestamp !== "string" || typeof quote.createdTime !== "string") return null;
  const quotedAt = Date.parse(quote.rateTimestamp);
  const createdAt = Date.parse(quote.createdTime);
  const expiresAt = typeof quote.expirationTime === "string" ? Date.parse(quote.expirationTime) : NaN;
  const rateExpiresAt = typeof quote.rateExpirationTime === "string" ? Date.parse(quote.rateExpirationTime) : NaN;
  if (![quotedAt, createdAt, expiresAt, rateExpiresAt].every(Number.isFinite) || createdAt > now + 5_000
    || now - createdAt > FX_MAX_QUOTE_AGE_MS || Math.min(expiresAt, rateExpiresAt) <= now || quotedAt > createdAt + 5_000) return null;
  const weekend = wiseWeekendWindow(now);
  // Even during a scheduled closure, Wise must return a newly created quote
  // and a rate from the actual closing period, not an older weekday outage.
  if (weekend && quotedAt < weekend.closedAt - FX_MAX_QUOTE_AGE_MS) return null;
  const validUntil = Math.min(expiresAt, rateExpiresAt, createdAt + FX_MAX_QUOTE_AGE_MS,
    weekend ? weekend.opensAt : quotedAt + FX_MAX_QUOTE_AGE_MS);
  const pair = parseFxReference({
    base: "USD", quote: "ILS", symbol: USD_ILS_REFERENCE_SYMBOL,
    price: quote.rate, quotedAt: quote.rateTimestamp,
    marketState: weekend ? "closed" : "open",
    nextOpenAt: weekend ? new Date(weekend.opensAt).toISOString() : undefined,
  }, USD_ILS_REFERENCE_SYMBOL, now);
  if (!pair) return null;
  pair.validUntil = new Date(Math.min(Date.parse(pair.validUntil!), validUntil)).toISOString();
  return isFxPairUsable(pair, now) ? pair : null;
}

export async function fetchFxReference(): Promise<MarketPair | null> {
  const customEndpoint = process.env.ALPHA_FX_REFERENCE_URL;
  const endpoint = customEndpoint || WISE_QUOTE_URL;
  const symbol = process.env.ALPHA_FX_REFERENCE_SYMBOL || USD_ILS_REFERENCE_SYMBOL;
  if (symbol !== USD_ILS_REFERENCE_SYMBOL) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error("fx_timeout")); }, customEndpoint ? 3_000 : 8_000);
    });
    const pair = await Promise.race([
      (async () => {
        const token = customEndpoint ? process.env.ALPHA_FX_REFERENCE_TOKEN : undefined;
        const response = await fetch(url.toString(), {
          cache: "no-store", redirect: "error", signal: controller.signal,
          method: customEndpoint ? "GET" : "POST",
          headers: customEndpoint ? (token ? { Authorization: `Bearer ${token}` } : undefined)
            : { "Content-Type": "application/json", Accept: "application/json" },
          // Public illustrative quote only: no account, recipient or transfer.
          body: customEndpoint ? undefined : JSON.stringify({ sourceCurrency: "USD", targetCurrency: "ILS", sourceAmount: 1000 }),
        });
        if (!response.ok) { void response.body?.cancel().catch(() => undefined); return null; }
        const payload: unknown = await response.json();
        return customEndpoint ? parseFxReference(payload, symbol) : parseWiseReference(payload);
      })(), deadline,
    ]);
    return pair;
  } catch {
    // Never expose upstream credentials/URLs or substitute a daily/default rate.
    return null;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
