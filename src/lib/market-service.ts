import type { MarketPairKey, MarketSnapshot } from "@/types/market";

const DEFAULT_USD_ILS_RATE = 3.05;
const DEFAULT_BTC_USDT_RATE = 118200;
const MIN_USD_ILS_RATE = 2;
const MAX_USD_ILS_RATE = 10;
const MIN_BTC_USDT_RATE = 1000;
const MAX_BTC_USDT_RATE = 1_000_000;
const MIN_CACHE_TTL_MS = 30_000;
const MAX_CACHE_TTL_MS = 60_000;
const DEFAULT_CACHE_TTL_MS = 45_000;

let cachedSnapshot: MarketSnapshot | null = null;
let lastLiveSnapshot: MarketSnapshot | null = null;
let cachedAt = 0;
let inFlight: Promise<MarketSnapshot> | null = null;

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isInRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function getCacheTtlMs() {
  const configured = toNumber(process.env.ALPHA_MARKET_CACHE_TTL_MS);
  if (configured >= MIN_CACHE_TTL_MS && configured <= MAX_CACHE_TTL_MS) return configured;
  const configuredSeconds = toNumber(process.env.ALPHA_MARKET_CACHE_TTL_SECONDS);
  if (configuredSeconds >= 30 && configuredSeconds <= 60) return configuredSeconds * 1000;
  return DEFAULT_CACHE_TTL_MS;
}

async function fetchUsdIlsRate() {
  const configured = toNumber(process.env.ALPHA_EXCHANGE_USD_ILS_RATE);
  if (configured > 0) {
    return { value: configured, source: "env:ALPHA_EXCHANGE_USD_ILS_RATE", success: true as const };
  }

  const endpoints = [
    {
      name: "open.er-api",
      url: "https://open.er-api.com/v6/latest/USD",
      parse: (payload: { rates?: Record<string, unknown> }) => toNumber(payload.rates?.ILS),
    },
    {
      name: "frankfurter",
      url: "https://api.frankfurter.app/latest?from=USD&to=ILS",
      parse: (payload: { rates?: Record<string, unknown> }) => toNumber(payload.rates?.ILS),
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json() as Record<string, unknown>;
      const value = endpoint.parse(payload);
      if (isInRange(value, MIN_USD_ILS_RATE, MAX_USD_ILS_RATE)) {
        return { value, source: endpoint.name, success: true as const };
      }
    } catch {
      continue;
    }
  }

  return { value: DEFAULT_USD_ILS_RATE, source: "fallback:default", success: false as const };
}

async function fetchBtcUsdtRate() {
  const configured = toNumber(process.env.ALPHA_MARKET_BTC_USDT_RATE);
  if (configured > 0) {
    return { value: configured, source: "env:ALPHA_MARKET_BTC_USDT_RATE", success: true as const };
  }

  const endpoints = [
    {
      name: "binance",
      url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      parse: (payload: { price?: unknown }) => toNumber(payload.price),
    },
    {
      name: "coinbase-spot",
      url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
      parse: (payload: { data?: { amount?: unknown } }) => toNumber(payload.data?.amount),
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json();
      const value = endpoint.parse(payload as { price?: unknown; data?: { amount?: unknown } });
      if (isInRange(value, MIN_BTC_USDT_RATE, MAX_BTC_USDT_RATE)) {
        return { value, source: endpoint.name, success: true as const };
      }
    } catch {
      continue;
    }
  }

  return { value: DEFAULT_BTC_USDT_RATE, source: "fallback:default", success: false as const };
}

function calculateChangePercent(current: number, previous: number | null) {
  if (!previous || !Number.isFinite(previous) || previous <= 0) return null;
  const delta = ((current - previous) / previous) * 100;
  return Number.isFinite(delta) ? Number(delta.toFixed(2)) : null;
}

async function refreshMarketSnapshot() {
  const [usdIlsResult, btcUsdtResult] = await Promise.all([fetchUsdIlsRate(), fetchBtcUsdtRate()]);
  const nowIso = new Date().toISOString();
  const unavailablePairs: MarketPairKey[] = [];
  if (!usdIlsResult.success) unavailablePairs.push("usdIls");
  if (!btcUsdtResult.success) unavailablePairs.push("btcUsdt");

  const usdIlsPrice = usdIlsResult.value;
  const usdtIlsPrice = usdIlsPrice;
  const btcUsdtPrice = btcUsdtResult.value;
  const previous = lastLiveSnapshot?.pairs;
  const snapshot: MarketSnapshot = {
    status: unavailablePairs.length === 0 ? "live" : "degraded",
    updatedAt: nowIso,
    stale: unavailablePairs.length > 0,
    unavailablePairs,
    pairs: {
      usdIls: {
        key: "usdIls",
        label: "USD / ILS",
        price: usdIlsPrice,
        changePercent: calculateChangePercent(usdIlsPrice, previous?.usdIls?.price ?? null),
        source: usdIlsResult.source,
      },
      btcUsdt: {
        key: "btcUsdt",
        label: "BTC / USDT",
        price: btcUsdtPrice,
        changePercent: calculateChangePercent(btcUsdtPrice, previous?.btcUsdt?.price ?? null),
        source: btcUsdtResult.source,
      },
      usdtIls: {
        key: "usdtIls",
        label: "USDT / ILS",
        price: usdtIlsPrice,
        changePercent: calculateChangePercent(usdtIlsPrice, previous?.usdtIls?.price ?? null),
        source: "derived",
        reference: "Marketplace reference",
      },
    },
  };

  if (snapshot.status === "live") {
    lastLiveSnapshot = snapshot;
  }

  return snapshot;
}

function getFallbackSnapshot() {
  if (cachedSnapshot) {
    return {
      ...cachedSnapshot,
      status: "degraded" as const,
      stale: true,
      unavailablePairs: cachedSnapshot.unavailablePairs.length
        ? cachedSnapshot.unavailablePairs
        : ["usdIls", "btcUsdt"] as MarketPairKey[],
    };
  }

  const nowIso = new Date().toISOString();
  return {
    status: "degraded" as const,
    updatedAt: nowIso,
    stale: true,
    unavailablePairs: ["usdIls", "btcUsdt"] as MarketPairKey[],
    pairs: {
      usdIls: {
        key: "usdIls",
        label: "USD / ILS",
        price: DEFAULT_USD_ILS_RATE,
        changePercent: null,
        source: "fallback:default",
      },
      btcUsdt: {
        key: "btcUsdt",
        label: "BTC / USDT",
        price: DEFAULT_BTC_USDT_RATE,
        changePercent: null,
        source: "fallback:default",
      },
      usdtIls: {
        key: "usdtIls",
        label: "USDT / ILS",
        price: DEFAULT_USD_ILS_RATE,
        changePercent: null,
        source: "derived",
        reference: "Marketplace reference",
      },
    },
  } satisfies MarketSnapshot;
}

export async function getMarketSnapshot(options?: { forceRefresh?: boolean }): Promise<MarketSnapshot> {
  const shouldUseCache = !options?.forceRefresh;
  const now = Date.now();
  const ttlMs = getCacheTtlMs();

  if (shouldUseCache && cachedSnapshot && now - cachedAt < ttlMs) {
    return cachedSnapshot;
  }

  if (inFlight) return inFlight;

  inFlight = refreshMarketSnapshot()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      cachedAt = Date.now();
      return snapshot;
    })
    .catch(() => {
      const fallback = getFallbackSnapshot();
      cachedSnapshot = fallback;
      cachedAt = Date.now();
      return fallback;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight ?? getFallbackSnapshot();
}

export async function getUsdtIlsReferenceRate() {
  const snapshot = await getMarketSnapshot();
  return snapshot.pairs.usdtIls.price;
}

export { DEFAULT_USD_ILS_RATE };
