import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, clearUserSession, getCurrentSessionToken } from "@/lib/auth";

export async function POST() {
  const token = await getCurrentSessionToken();
  await clearUserSession(token);
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
