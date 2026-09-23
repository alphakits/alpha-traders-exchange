const TRADE_ROOM_CACHE_PREFIX = "alpha.trade-room.cache.v2.";
const TRADE_ROOM_CACHE_TTL_MS = 90_000;
const inFlightTradeRoomPrefetches = new Map<string, Promise<void>>();

type CachedTradeRoomPayload<T> = {
  cachedAt: number;
  data: T;
};

function tradeRoomCacheKey(requestId: string, actorUserId: string) {
  return `${TRADE_ROOM_CACHE_PREFIX}${encodeURIComponent(actorUserId)}.${encodeURIComponent(requestId)}`;
}

function sanitizeTradeRoomCacheData<T>(data: T): T {
  if (!data || typeof data !== "object") return data;
  let copy: T;
  try {
    copy = JSON.parse(JSON.stringify(data)) as T;
  } catch {
    return data;
  }

  const room = copy as Record<string, unknown>;
  const sanitizeMessages = (value: unknown) => Array.isArray(value)
    ? value
        .filter((entry) => !entry || typeof entry !== "object" || (entry as { credentialKind?: unknown }).credentialKind !== "cardless_code")
        .map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const sanitized = { ...(entry as Record<string, unknown>) };
          delete sanitized.payloadHash;
          return sanitized;
        })
    : value;

  room.messages = sanitizeMessages(room.messages);
  if (room.request && typeof room.request === "object") {
    const request = room.request as Record<string, unknown>;
    request.messages = sanitizeMessages(request.messages);
    delete request.sellerBankAccountSnapshot;
  }
  return copy;
}

export function buildTradeRoomHref(requestId: string) {
  return `/trade-room/${encodeURIComponent(requestId)}`;
}

export function writeTradeRoomCache<T>(requestId: string, actorUserId: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    // Never persist a decrypted Cardless ATM credential in browser storage.
    // The live response remains available in component memory and every room
    // navigation immediately reconciles with a private/no-store API response.
    const payload: CachedTradeRoomPayload<T> = { cachedAt: Date.now(), data: sanitizeTradeRoomCacheData(data) };
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
    const safeData = sanitizeTradeRoomCacheData(parsed.data);
    // Rewrite defensively in case a pre-hardening caller stored an unsafe
    // shape under the current namespace.
    window.sessionStorage.setItem(key, JSON.stringify({ ...parsed, data: safeData }));
    return safeData;
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

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve();
    }, 8_000);
  });

  const href = buildTradeRoomHref(requestId);
  const routePrefetch = Promise.resolve()
    .then(() => router.prefetch?.(href))
    .catch(() => {
      // Navigation remains authoritative when a framework prefetch fails.
    });
  const dataPrefetch = Promise.resolve()
    .then(async () => {
      if (!actorUserId || readTradeRoomCache(requestId, actorUserId)) return;
      const response = await fetch(`/api/alpha-exchange/trade-room/${encodeURIComponent(requestId)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) return;
      const payload = await response.json();
      if (!controller.signal.aborted) writeTradeRoomCache(requestId, actorUserId, payload);
    })
    .catch(() => {
      // Ignore prefetch failures; navigation will still fetch live data.
    });
  const prefetch = Promise.race([Promise.all([routePrefetch, dataPrefetch]), deadline])
    .then(() => undefined)
    .finally(() => {
      clearTimeout(timeout);
      if (inFlightTradeRoomPrefetches.get(prefetchKey) === prefetch) {
        inFlightTradeRoomPrefetches.delete(prefetchKey);
      }
    });

  inFlightTradeRoomPrefetches.set(prefetchKey, prefetch);
  return prefetch;
}
