const RETRYABLE_QUERY_STATUSES = new Set([0, 408, 425, 500, 502, 503, 504]);

export function shouldRetryMobileQuery(failureCount: number, error: unknown) {
  if (failureCount >= 1 || !error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && RETRYABLE_QUERY_STATUSES.has(status);
}

export function mobileQueryRetryDelay() {
  return 250;
}
