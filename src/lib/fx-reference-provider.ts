import type { MarketPair } from "@/types/market";
import { FX_MAX_CLOSED_AGE_MS, FX_MAX_QUOTE_AGE_MS, isFxPairUsable } from "@/lib/fx-reference-policy";

/** Adapter contract for an authorized feed; not a TradingView widget/scraper. */
export function parseFxReference(payload: unknown, symbol: string, now = Date.now()): MarketPair | null {
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

export async function fetchFxReference(): Promise<MarketPair | null> {
  const endpoint = process.env.ALPHA_FX_REFERENCE_URL;
  const symbol = process.env.ALPHA_FX_REFERENCE_SYMBOL;
  if (!endpoint || !symbol) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error("fx_timeout")); }, 3_000);
    });
    const pair = await Promise.race([
      (async () => {
        const token = process.env.ALPHA_FX_REFERENCE_TOKEN;
        const response = await fetch(url.toString(), {
          cache: "no-store", redirect: "error", signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!response.ok) { void response.body?.cancel().catch(() => undefined); return null; }
        return parseFxReference(await response.json(), symbol);
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
