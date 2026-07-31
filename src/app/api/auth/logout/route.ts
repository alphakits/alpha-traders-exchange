import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, clearUserSession, getCurrentSessionToken } from "@/lib/auth";

export async function POST() {
  const token = await getCurrentSessionToken();
  await clearUserSession(token);
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
  cookieStore.delete(AUTH_VERIFIED_COOKIE_NAME);
  cookieStore.delete(AUTH_PHONE_VERIFIED_COOKIE_NAME);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
