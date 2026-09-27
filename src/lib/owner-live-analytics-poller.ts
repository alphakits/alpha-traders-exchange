import {
  initialLiveAnalyticsState, LIVE_ANALYTICS_POLL_MS, LIVE_ANALYTICS_TIMEOUT_MS,
  parseLiveAnalytics, type LiveAnalyticsState,
} from "@/lib/owner-live-analytics";

/** Isolated, bounded owner-only reads. Never refreshes the trading dashboard. */
export function startOwnerAnalyticsPolling(options: {
  onChange: (state: LiveAnalyticsState) => void;
  isVisible: () => boolean;
  fetcher: (signal: AbortSignal) => Promise<Response>;
  subscribeVisibility: (listener: () => void) => () => void;
  subscribeSignOut: (listener: () => void) => () => void;
  clock?: () => number;
}) {
  let state = initialLiveAnalyticsState();
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const emit = () => { if (!stopped) options.onChange({ ...state }); };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const deny = () => {
    clearTimer();
    controller?.abort();
    state = { snapshot: null, refreshing: false, failed: false, forbidden: true };
    emit();
  };
  const refresh = async () => {
    if (stopped || state.forbidden || inFlight || !options.isVisible()) return;
    clearTimer();
    inFlight = true;
    state = { ...state, refreshing: true };
    emit();
    const request = new AbortController();
    controller = request;
    let timedOut = false;
    let cancel = () => {};
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => reject(new Error("Analytics read cancelled"));
      request.signal.addEventListener("abort", cancel, { once: true });
    });
    const timeout = setTimeout(() => { timedOut = true; request.abort(); }, LIVE_ANALYTICS_TIMEOUT_MS);
    try {
      const response = await Promise.race([(async () => {
        const result = await options.fetcher(request.signal);
        if (request.signal.aborted) throw new Error("Analytics read cancelled");
        if (result.status === 401 || result.status === 403) return { status: result.status, payload: null };
        if (!result.ok && result.status !== 503) throw new Error("Analytics read failed");
        const payload: unknown = await result.json();
        return { status: result.status, payload };
      })(), deadline]);
      if (stopped || state.forbidden || request.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { deny(); return; }
      const snapshot = parseLiveAnalytics(response.payload, options.clock?.() ?? Date.now());
      if (!snapshot) throw new Error("Invalid analytics response");
      state = { snapshot, refreshing: false, failed: false, forbidden: false };
    } catch {
      if (!stopped && !state.forbidden && (!request.signal.aborted || timedOut)) state = { ...state, refreshing: false, failed: true };
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", cancel);
      inFlight = false;
      controller = undefined;
      if (!stopped && !state.forbidden) {
        // Abort may occur after a fetch resolved, before its body finished.
        if (timedOut) state = { ...state, failed: true };
        state = { ...state, refreshing: false };
        emit();
        if (options.isVisible()) timer = setTimeout(() => { void refresh(); }, request.signal.aborted && !timedOut ? 0 : LIVE_ANALYTICS_POLL_MS);
      }
    }
  };
  const unsubscribeVisibility = options.subscribeVisibility(() => {
    clearTimer();
    if (options.isVisible()) void refresh();
    else controller?.abort();
  });
  const unsubscribeSignOut = options.subscribeSignOut(deny);
  void refresh();
  return {
    refresh: () => { void refresh(); },
    stop: () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      unsubscribeVisibility();
      unsubscribeSignOut();
    },
  };
}
