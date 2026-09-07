import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearUserSession, expireAuthCookies } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/auth-constants";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;

  // Revoke the server session before acknowledging logout. Native push
  // subscriptions are joined against this session, so awaiting revocation
  // prevents a signed-out phone from receiving another account update.
  await clearUserSession(token);
  expireAuthCookies(cookieStore, shouldUseSecureAuthCookie(request));

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
