import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { updateUserPreferredLocale } from "@/lib/alpha-exchange-store";
import { isPreferredLocale } from "@/lib/preferred-locale";
import { checkSharedRateLimit } from "@/lib/rate-limit";

const RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "auth:preferred-locale",
    identifier: user.id,
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { code: "PREFERRED_LOCALE_RATE_LIMITED" },
      { status: 429, headers: { ...RESPONSE_HEADERS, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_PREFERRED_LOCALE" }, { status: 400, headers: RESPONSE_HEADERS });
  }
  const preferredLocale = body && typeof body === "object"
    ? (body as { preferredLocale?: unknown }).preferredLocale
    : undefined;
  if (!isPreferredLocale(preferredLocale)) {
    return NextResponse.json({ code: "INVALID_PREFERRED_LOCALE" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  const updatedUser = await updateUserPreferredLocale({ userId: user.id, preferredLocale });
  return NextResponse.json(
    { preferredLocale: updatedUser.preferredLocale },
    { headers: RESPONSE_HEADERS },
  );
}
