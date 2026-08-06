import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearUserSession, expireAuthCookies } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;

  // Expire auth cookies immediately — this is everything the browser needs to be
  // logged out. Respond without waiting for the DB session record to be deleted.
  expireAuthCookies(cookieStore, shouldUseSecureAuthCookie(request));

  // Best-effort DB cleanup: delete the server-side session token so it cannot be
  // replayed. We fire-and-forget intentionally — if the DB is slow or the function
  // is killed before the DELETE completes the cookie is already cleared and the
  // token will expire naturally after 14 days.
  void clearUserSession(token);

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
