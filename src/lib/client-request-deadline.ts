export class ClientRequestTimeoutError extends Error {
  constructor() {
    super("The server response could not be confirmed in time.");
    this.name = "ClientRequestTimeoutError";
  }
}

/** Bound the entire operation, including body parsing, even if transport ignores abort. */
export async function runClientRequest<T>(
  controller: AbortController,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
  let timedOut = false;
  let cancel = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    cancel = () => reject(timedOut
      ? new ClientRequestTimeoutError()
      : new DOMException("Request cancelled", "AbortError"));
    controller.signal.addEventListener("abort", cancel, { once: true });
  });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await Promise.race([operation(controller.signal), cancelled]);
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", cancel);
  }
}

/** Read one JSON response without retrying a possibly committed mutation. */
export async function fetchClientJson<T>(input: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await runClientRequest(controller, timeoutMs, async (signal) => {
      const response = await fetch(input, { ...init, signal });
      const payload = await response.json() as T;
      return { response, payload };
    });
  } finally {
    init.signal?.removeEventListener("abort", cancel);
  }
}
