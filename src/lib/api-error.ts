import { NextResponse } from "next/server";

/**
 * Represents an expected, user-facing API error that is safe to forward to the client.
 * Throw this from store functions or route handlers for known error conditions.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Converts an unknown caught error into a safe NextResponse.
 * - ApiError: returns its message and status to the client.
 * - Known store Error messages in the allowList: returned as-is (user-facing).
 * - Everything else: logs the real error, returns a generic 500 to the client.
 */
export function toErrorResponse(
  error: unknown,
  fallback = "An unexpected error occurred. Please try again.",
): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    // User-facing store messages that are safe to forward
    if (isSafeStoreMessage(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Unexpected error — log server-side, return generic message
    console.error("[api-error]", error.message, error.stack);
    return NextResponse.json({ error: fallback }, { status: 500 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * Returns true if the error message is a known user-facing message thrown by the store
 * that is safe to surface directly in API responses.
 */
function isSafeStoreMessage(message: string): boolean {
  // Patterns matching intentional user-facing store errors
  const safePatterns = [
    /not found/i,
    /already exists/i,
    /invalid/i,
    /required/i,
    /must be/i,
    /cannot/i,
    /not allowed/i,
    /forbidden/i,
    /unauthorized/i,
    /expired/i,
    /already an approved/i,
    /already pending/i,
    /suspended/i,
    /owner account/i,
    /administrator account/i,
    /approved seller/i,
    /pending.*review/i,
    /incorrect/i,
    /too many/i,
    /at least/i,
    /maximum.*exceeded/i,
  ];
  return safePatterns.some((re) => re.test(message));
}
