import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, getCurrentSessionToken } from "@/lib/auth";
import { getSessionByToken, findUserById } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";

// Dev-only debug endpoint — returns current session user with role diagnostics.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const cookieStore = await cookies();
  const rawToken = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
  const allCookieNames = cookieStore.getAll().map((c) => c.name);

  if (!rawToken) {
    return NextResponse.json({
      authenticated: false,
      user: null,
      step: "no_cookie",
      cookieNameLookedUp: AUTH_COOKIE_NAME,
      allCookiesPresent: allCookieNames,
      diagnostics: { isApprovedSeller: false, isAdmin: false, reason: "No session cookie found." },
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const session = await getSessionByToken(rawToken);
  if (!session) {
    return NextResponse.json({
      authenticated: false,
      user: null,
      step: "no_session",
      cookiePresent: true,
      tokenLength: rawToken.length,
      diagnostics: { isApprovedSeller: false, isAdmin: false, reason: "Token not found in DB or session expired." },
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const user = await findUserById(session.userId);
  if (!user) {
    return NextResponse.json({
      authenticated: false,
      user: null,
      step: "no_user",
      cookiePresent: true,
      sessionUserId: session.userId,
      sessionExpiresAt: session.expiresAt,
      diagnostics: { isApprovedSeller: false, isAdmin: false, reason: "Session exists but user not found in DB." },
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({
    authenticated: true,
    step: "ok",
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      roles: user.roles ?? [],
      sellerStatus: user.sellerStatus,
      emailVerified: user.emailVerified,
    },
    diagnostics: {
      isApprovedSeller: hasRole(user, "approved_seller"),
      isAdmin: hasRole(user, "admin"),
      roleCheck: user.role === "approved_seller",
      sellerStatusCheck: user.sellerStatus === "approved_seller",
      rolesArrayCheck: (user.roles ?? []).includes("approved_seller"),
      strictAndCheck: user.role === "approved_seller" && user.sellerStatus === "approved_seller",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
