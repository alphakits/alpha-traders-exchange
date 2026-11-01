/** Read-only transport for the owner dashboard. Never submits or replays a command. */
export type OwnerDashboardReadPath =
  | "/api/alpha-exchange/admin-prep"
  | "/api/alpha-exchange/admin/sms-deliveries"
  | "/api/admin/system-health";

export type OwnerDashboardJsonRead = {
  ok: boolean;
  status: number;
  payload: unknown;
};

export async function readOwnerDashboardJson(
  path: OwnerDashboardReadPath,
  fetcher: typeof fetch = globalThis.fetch,
  timeoutMs = 15_000,
): Promise<OwnerDashboardJsonRead> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid read deadline");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Racing the entire operation also bounds a stalled body reader or a transport
  // that fails to reject its promise when AbortSignal fires. No retry is made.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Dashboard read timed out"));
      controller.abort();
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetcher(path, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    // Do not wait for or display a diagnostic body on an HTTP error.
    if (!response.ok) return { ok: false, status: response.status, payload: null };
    const payload: unknown = await response.json();
    return { ok: true, status: response.status, payload };
  })();
  try { return await Promise.race([request, deadline]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
