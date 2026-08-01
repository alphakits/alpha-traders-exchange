const TRADE_ROOM_CACHE_PREFIX = "alpha.trade-room.cache.";
const TRADE_ROOM_CACHE_TTL_MS = 90_000;

type CachedTradeRoomPayload<T> = {
  cachedAt: number;
  data: T;
};

export function buildTradeRoomHref(requestId: string) {
  return `/trade-room/${encodeURIComponent(requestId)}`;
}

export function writeTradeRoomCache<T>(requestId: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    const payload: CachedTradeRoomPayload<T> = { cachedAt: Date.now(), data };
    window.sessionStorage.setItem(`${TRADE_ROOM_CACHE_PREFIX}${requestId}`, JSON.stringify(payload));
  } catch {
    // Best-effort cache only.
  }
}

export function readTradeRoomCache<T>(requestId: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${TRADE_ROOM_CACHE_PREFIX}${requestId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedTradeRoomPayload<T>;
    if (!parsed || typeof parsed.cachedAt !== "number") return null;
    if (Date.now() - parsed.cachedAt > TRADE_ROOM_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(`${TRADE_ROOM_CACHE_PREFIX}${requestId}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function prefetchTradeRoom(router: { prefetch?: (href: string) => Promise<void> | void }, requestId: string) {
  const href = buildTradeRoomHref(requestId);
  if (router.prefetch) {
    void router.prefetch(href);
  }
  void fetch(`/api/alpha-exchange/trade-room/${encodeURIComponent(requestId)}`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json();
      writeTradeRoomCache(requestId, payload);
    })
    .catch(() => {
      // Ignore prefetch failures; navigation will still fetch live data.
    });
}

