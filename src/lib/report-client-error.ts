import { CLIENT_ERROR_KINDS, classifyErrorPage, getSafeErrorDigest, getSafeErrorFrames, type ClientErrorReport } from "./client-error-report";

const references = new WeakMap<Error, string>();
let budgetStartedAt = 0;
let sentCount = 0;

/** Best effort only: diagnostics must never throw from an error boundary. */
export function reportClientError(error: Error, boundary: ClientErrorReport["boundary"]) {
  try {
    const previous = references.get(error);
    if (previous) return previous;
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    // Letters-only encoding keeps diagnostic IDs out of phone-number redaction.
    const reference = `cr-${Array.from(bytes, (byte) =>
      String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join("")}`;
    references.set(error, reference);
    if (Date.now() - budgetStartedAt >= 60_000) {
      budgetStartedAt = Date.now();
      sentCount = 0;
    }
    if (sentCount >= 3) return reference;
    sentCount += 1;

    const script = document.querySelector<HTMLScriptElement>('script[src*="/_next/static/"]');
    const deployment = script ? new URL(script.src, window.location.origin).searchParams.get("dpl") : null;
    const report: ClientErrorReport = {
      reference,
      boundary,
      kind: CLIENT_ERROR_KINDS.find((kind) => kind === error.name) ?? "Other",
      page: classifyErrorPage(window.location.pathname),
      digest: getSafeErrorDigest(error),
      ...(deployment && /^dpl_[A-Za-z0-9]{1,80}$/.test(deployment) ? { deployment } : {}),
      frames: getSafeErrorFrames(error.stack),
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      void fetch("/api/diagnostics/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        keepalive: true,
        signal: controller.signal,
      }).catch(() => undefined).finally(() => clearTimeout(timeout));
    } catch {
      clearTimeout(timeout);
    }
    return reference;
  } catch {
    return undefined;
  }
}
