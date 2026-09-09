const TRADE_ROOM_CACHE_PREFIX = "alpha.trade-room.cache.";
const TRADE_ROOM_CACHE_TTL_MS = 90_000;
const inFlightTradeRoomPrefetches = new Map<string, Promise<void>>();

type CachedTradeRoomPayload<T> = {
  cachedAt: number;
  data: T;
};

function tradeRoomCacheKey(requestId: string, actorUserId: string) {
  return `${TRADE_ROOM_CACHE_PREFIX}${encodeURIComponent(actorUserId)}.${encodeURIComponent(requestId)}`;
}

export function buildTradeRoomHref(requestId: string) {
  return `/trade-room/${encodeURIComponent(requestId)}`;
}

export function writeTradeRoomCache<T>(requestId: string, actorUserId: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedTradeRoomPayload<T> = { cachedAt: Date.now(), data };
    window.sessionStorage.setItem(tradeRoomCacheKey(requestId, actorUserId), JSON.stringify(payload));
  } catch {
    // Best-effort cache only.
  }
}

export function readTradeRoomCache<T>(requestId: string, actorUserId: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const key = tradeRoomCacheKey(requestId, actorUserId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedTradeRoomPayload<T>;
    if (!parsed || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > TRADE_ROOM_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function clearTradeRoomCache(requestId: string, actorUserId: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(tradeRoomCacheKey(requestId, actorUserId));
  } catch {
    // Best-effort cache only.
  }
}

export function prefetchTradeRoom(
  router: { prefetch?: (href: string) => Promise<void> | void },
  requestId: string,
  actorUserId?: string | null,
) {
  const prefetchKey = `${actorUserId ?? "anonymous"}:${requestId}`;
  const existingPrefetch = inFlightTradeRoomPrefetches.get(prefetchKey);
  if (existingPrefetch) return existingPrefetch;

  const href = buildTradeRoomHref(requestId);
  const routePrefetch = Promise.resolve()
    .then(() => router.prefetch?.(href))
    .catch(() => {
      // Navigation remains authoritative when a framework prefetch fails.
    });
  const dataPrefetch = Promise.resolve()
    .then(async () => {
      if (!actorUserId || readTradeRoomCache(requestId, actorUserId)) return;
      const response = await fetch(`/api/alpha-exchange/trade-room/${encodeURIComponent(requestId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      writeTradeRoomCache(requestId, actorUserId, payload);
    })
    .catch(() => {
      // Ignore prefetch failures; navigation will still fetch live data.
    });
  const prefetch = Promise.all([routePrefetch, dataPrefetch])
    .then(() => undefined)
    .finally(() => {
      if (inFlightTradeRoomPrefetches.get(prefetchKey) === prefetch) {
        inFlightTradeRoomPrefetches.delete(prefetchKey);
      }
    });

  inFlightTradeRoomPrefetches.set(prefetchKey, prefetch);
  return prefetch;
}
