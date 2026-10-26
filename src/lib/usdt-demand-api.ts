import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { requireApiUser, requireMarketplaceVerificationForTrading } from "./api-auth";
import { checkSharedRateLimit } from "./rate-limit";
import { assertDemandEnabled, DemandError } from "./usdt-demand-policy";
import { queueDemandEmails } from "./usdt-demand-email";
import { logEvent } from "./structured-logging";

const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
// Server-only provenance lets operators correlate concurrent requests to a
// process and verify the actual hosted runtime without logging user data.
const runtimeInstanceId = randomUUID();
export async function demandApi(request: NextRequest, mutation: boolean, run: (userId: string) => Promise<unknown>) {
  const started = performance.now();
  const correlationId = randomUUID();
  const finish = (response: NextResponse, reason: string) => {
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    response.headers.set("X-Request-Id", correlationId);
    const status = response.status;
    // Bounded dimensions only: never log identities, URLs, payloads, payment
    // details, exception messages, or caller-supplied correlation values.
    try {
      logEvent(status >= 500 ? "error" : status >= 400 ? "warn" : "info", {
        event: "usdt_demand_request", outcome: status >= 500 ? "failed" : status >= 400 ? "denied" : "success",
        reason: /^[A-Z_]{1,64}$/.test(reason) ? reason : "DOMAIN_REJECTED",
        metadata: { correlationId, operation: mutation ? "write" : "read", status, durationMs: Math.round(performance.now() - started),
          nodeVersion: process.versions.node, runtimeInstanceId },
      });
    } catch { /* Telemetry availability must never change a financial action's response. */ }
    return response;
  };
  try {
    assertDemandEnabled();
    const { user, unauthorized } = await requireApiUser();
    if (!user) return finish(unauthorized, "UNAUTHENTICATED");
    const denied = requireMarketplaceVerificationForTrading(user);
    if (denied) return finish(denied, "VERIFICATION_REQUIRED");
    if (mutation) {
      const origin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== request.nextUrl.origin)) throw new DemandError("ORIGIN_DENIED", "Refresh this page before continuing.", 403);
      const rate = await checkSharedRateLimit({ headers: request.headers, key: "usdt-demands", identifier: user.id, maxRequests: 20, windowMs: 60_000 });
      if (!rate.allowed) return finish(NextResponse.json({ error: "Too many actions. Try again shortly.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } }), "RATE_LIMITED");
    }
    const result = await run(user.id);
    if (mutation) after(async () => {
      try { await queueDemandEmails(); }
      catch {
        logEvent("error", { event: "usdt_demand_email_queue", outcome: "failed", reason: "PREPARATION_FAILED", metadata: { correlationId } });
      }
    });
    return finish(NextResponse.json(result ?? { ok: true }, { headers }), "OK");
  } catch (error) {
    if (error instanceof ZodError) return finish(NextResponse.json({ error: "Check the request amount, price, network and payment details.", code: "INVALID_INPUT" }, { status: 400, headers }), "INVALID_INPUT");
    if (error instanceof DemandError) return finish(NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers }), error.code);
    // Existing financial eligibility errors contain safe user-facing messages.
    if (error instanceof Error && "code" in error && ["ACTIVE_TRADE_EXISTS", "PENDING_BUYER_FEEDBACK", "SELLER_COMMISSION_DUE"].includes(String(error.code))) return finish(NextResponse.json({ error: error.message, code: error.code }, { status: 409, headers }), String(error.code));
    return finish(NextResponse.json({ error: "The request could not be completed. Refresh and try again.", code: "REQUEST_UNAVAILABLE" }, { status: 503, headers }), "REQUEST_UNAVAILABLE");
  }
}
export async function demandBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new DemandError("INVALID_INPUT", "A request body is required.", 400);
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 16_384) { await reader.cancel(); throw new DemandError("BODY_TOO_LARGE", "The request is too large.", 413); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof DemandError) throw error;
    throw new DemandError("INVALID_INPUT", "Invalid JSON request.", 400);
  } finally { reader.releaseLock(); }
}
