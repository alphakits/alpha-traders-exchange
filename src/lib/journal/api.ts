import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import { readLimitedRequestText, RequestBodyTooLargeError } from "@/lib/request-body";
import { JournalConflict, JournalLimit, JournalNotFound } from "./repository";
import { journalEnabled } from "./feature";
export { journalEnabled } from "./feature";

export const journalHeaders = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie" };
export const journalJson = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: journalHeaders });
export async function journalAccess(request: NextRequest, write = false) {
  if (!journalEnabled()) return { user: null, response: journalJson({ error: "Journal is not available yet." }, 404) };
  const { user, unauthorized } = await requireApiUser();
  if (!user) {
    const response = unauthorized ?? journalJson({ error: "Sign in to open your journal." }, 401);
    Object.entries(journalHeaders).forEach(([key,value]) => response.headers.set(key,value));
    return { user: null, response };
  }
  if (write && !hasTrustedSameOrigin(request)) return { user: null, response: journalJson({ error: "Please reopen your journal and try again." }, 403) };
  const rate = await checkSharedRateLimit({ headers: request.headers, key: `journal:${write ? 'write' : 'read'}`, identifier: user.id, maxRequests: write ? 60 : 180, windowMs: 60_000 });
  if (!rate.allowed) return { user: null, response: createRateLimitResponse(rate.retryAfterSeconds) };
  return { user, response: null };
}
export async function journalBody<T>(request: NextRequest, schema: z.ZodType<T>) {
  return schema.parse(JSON.parse(await readLimitedRequestText(request, 64000)));
}
export function journalError(error: unknown) {
  if (error instanceof JournalConflict) return journalJson({ code: "CONFLICT", error: "This record changed on another device. Reload the journal before editing it again." }, 409);
  if (error instanceof JournalNotFound) return journalJson({ error: "Record not found." }, 404);
  if (error instanceof JournalLimit) return journalJson({ error: "Each trade can have up to 3 charts." }, 400);
  if (error instanceof RequestBodyTooLargeError) return journalJson({ error: "File or note is too large." }, 413);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return journalJson({ error: "Check the trade details and try again." }, 400);
  console.error("[journal] Request failed", { name: error instanceof Error ? error.name : "Unknown" });
  return journalJson({ error: "Your journal is temporarily unavailable. Your existing records are safe; please try again." }, 503);
}
