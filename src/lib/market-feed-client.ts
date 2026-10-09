import type { MarketSnapshot } from "@/types/market";
import { runClientRequest } from "@/lib/client-request-deadline";

export const DEFAULT_MARKET_REFRESH_MS = 45_000;
export const MARKET_FEED_TIMEOUT_MS = 15_000;

type MarketFeedState = {
  snapshot: MarketSnapshot | null;
  isLoading: boolean;
  error: string | null;
};
const INITIAL_STATE: MarketFeedState = { snapshot: null, isLoading: true, error: null };

/** One bounded public feed per document, shared by the page and footer. */
export function createMarketFeedStore() {
  let state = INITIAL_STATE;
  const listeners = new Map<() => void, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { controller: AbortController; promise: Promise<void> } | null = null;
  let completedAt = 0;
  let active = false;

  const available = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  const notify = (next: MarketFeedState) => {
    state = next;
    listeners.forEach((_, listener) => listener());
  };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const cancel = () => {
    clearTimer();
    const previous = pending;
    pending = null;
    previous?.controller.abort();
  };
  const schedule = () => {
    clearTimer();
    if (!listeners.size || !active || pending) return;
    const interval = Math.min(...listeners.values());
    timer = setTimeout(() => { void refresh(); }, Math.max(0, completedAt + interval - Date.now()));
  };

  function refresh(): Promise<void> {
    if (!listeners.size || !available()) return Promise.resolve();
    if (pending) return pending.promise;
    clearTimer();
    const controller = new AbortController();
    const request = { controller, promise: Promise.resolve() };
    pending = request;
    request.promise = runClientRequest(controller, MARKET_FEED_TIMEOUT_MS, async (signal) => {
      const response = await fetch("/api/market/center", { cache: "no-store", signal });
      if (!response.ok) throw new Error("Market feed unavailable");
      const payload = await response.json() as { snapshot?: MarketSnapshot };
      if (!payload.snapshot) throw new Error("Invalid market response");
      return payload.snapshot;
    }).then((snapshot) => {
      if (pending === request) notify({ snapshot, isLoading: false, error: null });
    }).catch(() => {
      // A lifecycle cancellation must not replace a newer response or flash an
      // error on resume. A real timeout retains prices with an unavailable flag.
      if (pending === request) notify({
        snapshot: state.snapshot ? { ...state.snapshot, status: "degraded", stale: true } : null,
        isLoading: false,
        error: "Market feed unavailable",
      });
    }).finally(() => {
      if (pending !== request) return;
      pending = null;
      completedAt = Date.now();
      schedule();
    });
    return request.promise;
  }

  const syncAvailability = () => {
    const next = available();
    if (next === active) return;
    active = next;
    if (active) void refresh();
    else {
      cancel();
      // Paused data is no longer confirmed live. Keep its values/timestamp,
      // but only a successful fresh response may restore the live status.
      if (state.snapshot) notify({
        ...state,
        snapshot: { ...state.snapshot, status: "degraded", stale: true },
      });
    }
  };

  return {
    getSnapshot: () => state,
    getServerSnapshot: () => INITIAL_STATE,
    refresh,
    subscribe(listener: () => void, refreshMs = DEFAULT_MARKET_REFRESH_MS) {
      listeners.set(listener, Number.isFinite(refreshMs) ? Math.max(1_000, refreshMs) : DEFAULT_MARKET_REFRESH_MS);
      if (listeners.size === 1) {
        document.addEventListener("visibilitychange", syncAvailability);
        window.addEventListener("online", syncAvailability);
        window.addEventListener("offline", syncAvailability);
        active = available();
        if (active) void refresh();
      } else schedule();
      return () => {
        listeners.delete(listener);
        if (listeners.size) { schedule(); return; }
        active = false;
        cancel();
        document.removeEventListener("visibilitychange", syncAvailability);
        window.removeEventListener("online", syncAvailability);
        window.removeEventListener("offline", syncAvailability);
        state = INITIAL_STATE;
        completedAt = 0;
      };
    },
  };
}
