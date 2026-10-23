import { after, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireApiUser, requireMarketplaceVerificationForTrading } from "./api-auth";
import { checkSharedRateLimit } from "./rate-limit";
import { assertDemandEnabled, DemandError } from "./usdt-demand-policy";
import { queueDemandEmails } from "./usdt-demand-email";

const headers = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };
export async function demandApi(request: NextRequest, mutation: boolean, run: (userId: string) => Promise<unknown>) {
  try {
    assertDemandEnabled();
    const { user, unauthorized } = await requireApiUser();
    if (!user) return unauthorized;
    const denied = requireMarketplaceVerificationForTrading(user);
    if (denied) return denied;
    if (mutation) {
      const origin = request.headers.get("origin");
      if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== request.nextUrl.origin)) throw new DemandError("ORIGIN_DENIED", "Refresh this page before continuing.", 403);
      const rate = await checkSharedRateLimit({ headers: request.headers, key: "usdt-demands", identifier: user.id, maxRequests: 20, windowMs: 60_000 });
      if (!rate.allowed) return NextResponse.json({ error: "Too many actions. Try again shortly.", code: "RATE_LIMITED" }, { status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) } });
    }
    const result = await run(user.id);
    if (mutation) after(async () => { await queueDemandEmails().catch(() => undefined); });
    return NextResponse.json(result ?? { ok: true }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: "Check the request amount, price, network and payment details.", code: "INVALID_INPUT" }, { status: 400, headers });
    if (error instanceof DemandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
    // Existing financial eligibility errors contain safe user-facing messages.
    if (error instanceof Error && "code" in error && ["ACTIVE_TRADE_EXISTS", "PENDING_BUYER_FEEDBACK", "SELLER_COMMISSION_DUE"].includes(String(error.code))) return NextResponse.json({ error: error.message, code: error.code }, { status: 409, headers });
    return NextResponse.json({ error: "The request could not be completed. Refresh and try again.", code: "REQUEST_UNAVAILABLE" }, { status: 503, headers });
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
