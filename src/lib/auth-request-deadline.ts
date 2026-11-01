export const AUTH_PROVIDER_TIMEOUT_MS = 8_000;

/** Bound the whole SDK operation, including its response body, and abort transport. */
export async function withAuthProviderDeadline<T>(
  requestSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  requestSignal.throwIfAborted();
  const controller = new AbortController();
  const cancelRequest = () => controller.abort(requestSignal.reason);
  requestSignal.addEventListener("abort", cancelRequest, { once: true });

  let rejectAborted = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  const timer = setTimeout(() => controller.abort(
    new DOMException("Authentication provider deadline exceeded.", "TimeoutError"),
  ), AUTH_PROVIDER_TIMEOUT_MS);
  try {
    // The rejection is registered before the SDK can handle its abort. A late
    // provider error/success must never resume local session creation.
    const result = await Promise.race([operation(controller.signal), aborted]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", cancelRequest);
    controller.signal.removeEventListener("abort", rejectAborted);
  }
}
