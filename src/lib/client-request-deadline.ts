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
