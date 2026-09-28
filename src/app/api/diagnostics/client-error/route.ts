import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CLIENT_ERROR_KINDS, CLIENT_ERROR_PAGES } from "@/lib/client-error-report";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { logEvent } from "@/lib/structured-logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2_048;
const HEADERS = { "Cache-Control": "no-store, max-age=0", Vary: "Origin, Sec-Fetch-Site" };
const reportSchema = z.object({
  reference: z.string().regex(/^cr-[a-p]{16}$/),
  boundary: z.enum(["global", "locale"]),
  kind: z.enum(CLIENT_ERROR_KINDS),
  page: z.enum(CLIENT_ERROR_PAGES),
  digest: z.number().int().min(0).max(0xffff_ffff).optional(),
  deployment: z.string().regex(/^dpl_[A-Za-z0-9]{1,80}$/).optional(),
  frames: z.array(z.object({
    asset: z.string().regex(/^[A-Za-z0-9_-]{1,100}\.js$/),
    line: z.number().int().min(1).max(9_999_999),
    column: z.number().int().min(1).max(9_999_999),
  }).strict()).max(3),
}).strict();

// Diagnostics must also work when PostgreSQL/authentication is unavailable.
// These are explicit per-instance ingestion limits, not an authorization gate.
let windowStart = 0;
let total = 0;
const perAddress = new Map<string, number>();

function allowReport(request: NextRequest) {
  if (Date.now() - windowStart >= 60_000) {
    windowStart = Date.now();
    total = 0;
    perAddress.clear();
  }
  if (total >= 100) return false;
  const address = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const key = createHash("sha256").update(`${windowStart}:${address.slice(0, 128)}`).digest("hex");
  const count = perAddress.get(key) ?? 0;
  if (count >= 5) return false;
  total += 1;
  perAddress.set(key, count + 1);
  return true;
}

async function readBoundedBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 3_000);
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        if (timedOut) throw new Error("Diagnostic body read timed out.");
        return body + decoder.decode();
      }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
}

export async function POST(request: NextRequest) {
  if (!hasTrustedSameOrigin(request)) return new NextResponse(null, { status: 403, headers: HEADERS });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return new NextResponse(null, { status: 415, headers: HEADERS });
  }
  if (!allowReport(request)) return new NextResponse(null, { status: 429, headers: { ...HEADERS, "Retry-After": "60" } });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return new NextResponse(null, { status: 413, headers: HEADERS });
  }
  try {
    const body = await readBoundedBody(request);
    if (body === null) return new NextResponse(null, { status: 413, headers: HEADERS });
    const parsed = reportSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return new NextResponse(null, { status: 400, headers: HEADERS });
    logEvent("error", {
      event: "client_render_error",
      outcome: "failed",
      reason: "browser_error_boundary",
      metadata: {
        ...parsed.data,
        release: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 12),
      },
    });
    return new NextResponse(null, { status: 204, headers: HEADERS });
  } catch {
    return new NextResponse(null, { status: 400, headers: HEADERS });
  }
}
