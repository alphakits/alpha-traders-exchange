import { fetchFxReference } from "@/lib/fx-reference-provider";
import { FxReferenceUnavailableError, isFxPairUsable, isFxReferenceUsable } from "@/lib/fx-reference-policy";
import type { MarketPairKey, MarketSnapshot } from "@/types/market";

const DEFAULT_USD_ILS_RATE = 3.05;
const DEFAULT_BTC_USDT_RATE = 118200;
const DEFAULT_ETH_USDT_RATE = 3800;
const MIN_BTC_USDT_RATE = 1000;
const MAX_BTC_USDT_RATE = 1_000_000;
const MIN_ETH_USDT_RATE = 100;
const MAX_ETH_USDT_RATE = 100_000;
const MIN_CACHE_TTL_MS = 1_000;
const MAX_CACHE_TTL_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 5_000;
const MARKET_PROVIDER_TIMEOUT_MS = 3_000;

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
  if (configuredSeconds >= 1 && configuredSeconds <= 10) return configuredSeconds * 1000;
  return DEFAULT_CACHE_TTL_MS;
}

async function fetchMarketProviderJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("market_provider_timeout"));
    }, MARKET_PROVIDER_TIMEOUT_MS);
  });

  try {
    // Bound the complete response, including its body. A stalled provider
    // must not leave the shared inFlight refresh pending for every caller.
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new Error("market_provider_unavailable");
        }
        return await response.json() as T;
      })(),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
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
      const payload = await fetchMarketProviderJson<{ price?: unknown; data?: { amount?: unknown } }>(endpoint.url);
      const value = endpoint.parse(payload);
      if (isInRange(value, MIN_BTC_USDT_RATE, MAX_BTC_USDT_RATE)) {
        return { value, source: endpoint.name, success: true as const };
      }
    } catch {
      continue;
    }
  }

  return { value: DEFAULT_BTC_USDT_RATE, source: "fallback:default", success: false as const };
}

async function fetchEthUsdtRate() {
  const configured = toNumber(process.env.ALPHA_MARKET_ETH_USDT_RATE);
  if (configured > 0) {
    return { value: configured, source: "env:ALPHA_MARKET_ETH_USDT_RATE", success: true as const };
  }

  const endpoints = [
    {
      name: "binance",
      url: "https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT",
      parse: (payload: { price?: unknown }) => toNumber(payload.price),
    },
    {
      name: "coinbase-spot",
      url: "https://api.coinbase.com/v2/prices/ETH-USD/spot",
      parse: (payload: { data?: { amount?: unknown } }) => toNumber(payload.data?.amount),
    },
  ];

  for (const endpoint of endpoints) {
    try {
      const payload = await fetchMarketProviderJson<{ price?: unknown; data?: { amount?: unknown } }>(endpoint.url);
      const value = endpoint.parse(payload);
      if (isInRange(value, MIN_ETH_USDT_RATE, MAX_ETH_USDT_RATE)) {
        return { value, source: endpoint.name, success: true as const };
      }
    } catch {
      continue;
    }
  }

  return { value: DEFAULT_ETH_USDT_RATE, source: "fallback:default", success: false as const };
}

function calculateChangePercent(current: number, previous: number | null) {
  if (!previous || !Number.isFinite(previous) || previous <= 0) return null;
  const delta = ((current - previous) / previous) * 100;
  return Number.isFinite(delta) ? Number(delta.toFixed(2)) : null;
}

async function refreshMarketSnapshot() {
  const [usdIlsResult, btcUsdtResult, ethUsdtResult] = await Promise.all([fetchFxReference(), fetchBtcUsdtRate(), fetchEthUsdtRate()]);
  // A quote can expire while another provider is still responding.
  const usableFxResult = usdIlsResult && isFxPairUsable(usdIlsResult) ? usdIlsResult : null;
  const nowIso = new Date().toISOString();
  const unavailablePairs: MarketPairKey[] = [];
  if (!usableFxResult) unavailablePairs.push("usdtIls");
  if (!btcUsdtResult.success) unavailablePairs.push("btcUsdt");
  if (!ethUsdtResult.success) unavailablePairs.push("ethUsdt");

  const btcUsdtPrice = btcUsdtResult.value;
  const ethUsdtPrice = ethUsdtResult.value;
  const previous = lastLiveSnapshot?.pairs;
  const snapshot: MarketSnapshot = {
    status: unavailablePairs.length === 0 && usableFxResult?.quoteStatus === "live" ? "live" : "degraded",
    updatedAt: nowIso,
    stale: unavailablePairs.length > 0,
    unavailablePairs,
    pairs: {
      ethUsdt: {
        key: "ethUsdt",
        label: "ETH / USDT",
        price: ethUsdtPrice,
        changePercent: calculateChangePercent(ethUsdtPrice, previous?.ethUsdt?.price ?? null),
        source: ethUsdtResult.source,
      },
      btcUsdt: {
        key: "btcUsdt",
        label: "BTC / USDT",
        price: btcUsdtPrice,
        changePercent: calculateChangePercent(btcUsdtPrice, previous?.btcUsdt?.price ?? null),
        source: btcUsdtResult.source,
      },
      usdtIls: usableFxResult ?? unavailableFxPair(),
    },
  };

  if (snapshot.status === "live") {
    lastLiveSnapshot = snapshot;
  }

  return snapshot;
}

function unavailableFxPair() {
  const previous = cachedSnapshot?.pairs.usdtIls;
  return {
    key: "usdtIls" as const, label: "USD / ILS", price: previous?.price ?? 0,
    changePercent: null, source: previous?.source ?? "unavailable",
    reference: "USD/ILS benchmark for USDT listings",
    quotedAt: previous?.quotedAt, validUntil: previous?.validUntil,
    quoteStatus: previous?.price ? "stale" as const : "unavailable" as const,
  };
}

function getFallbackSnapshot(): MarketSnapshot {
  return {
    status: "degraded", updatedAt: cachedSnapshot?.updatedAt ?? new Date().toISOString(),
    stale: true, unavailablePairs: ["ethUsdt", "btcUsdt", "usdtIls"],
    pairs: {
      ethUsdt: cachedSnapshot?.pairs.ethUsdt ?? { key: "ethUsdt", label: "ETH / USDT", price: DEFAULT_ETH_USDT_RATE, changePercent: null, source: "fallback:default" },
      btcUsdt: cachedSnapshot?.pairs.btcUsdt ?? { key: "btcUsdt", label: "BTC / USDT", price: DEFAULT_BTC_USDT_RATE, changePercent: null, source: "fallback:default" },
      usdtIls: unavailableFxPair(),
    },
  };
}

export async function getMarketSnapshot(options?: { forceRefresh?: boolean }): Promise<MarketSnapshot> {
  const shouldUseCache = !options?.forceRefresh;
  const now = Date.now();
  const ttlMs = getCacheTtlMs();

  if (shouldUseCache && cachedSnapshot && now - cachedAt < ttlMs) {
    if (isFxReferenceUsable(cachedSnapshot) || cachedSnapshot.unavailablePairs.includes("usdtIls")) return cachedSnapshot;
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
  if (!isFxReferenceUsable(snapshot)) throw new FxReferenceUnavailableError();
  return snapshot.pairs.usdtIls.price;
}

export { DEFAULT_USD_ILS_RATE };
