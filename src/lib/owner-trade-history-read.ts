/** A bounded, cancellable read. It never sends or replays an owner command. */
export async function readOwnerTradeHistory(requestId: string, signal: AbortSignal, fetcher: typeof fetch = globalThis.fetch, timeoutMs = 15_000, ownerHistory = true) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => { reject(new Error("History read cancelled")); controller.abort(); };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => { reject(new Error("History read timed out")); controller.abort(); }, timeoutMs);
  });
  const request = (async () => {
    if (signal.aborted) { cancel(); throw new Error("History read cancelled"); }
    const response = await fetcher(`/api/alpha-exchange/trade-room/${encodeURIComponent(requestId)}${ownerHistory ? "?view=history" : ""}`, {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
    });
    // Revoked access must clear the screen without waiting for an error body.
    if (!response.ok) return { ok: false, status: response.status, payload: null };
    const payload: unknown = await response.json();
    return { ok: true, status: response.status, payload };
  })();
  try { return await Promise.race([request, deadline]); }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
