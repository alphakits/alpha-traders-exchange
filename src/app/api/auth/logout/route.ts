import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearUserSession, expireAuthCookies, getCurrentSessionToken } from "@/lib/auth";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";

export async function POST(request: NextRequest) {
  const token = await getCurrentSessionToken();
  await clearUserSession(token);
  const cookieStore = await cookies();
  expireAuthCookies(cookieStore, shouldUseSecureAuthCookie(request));
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
