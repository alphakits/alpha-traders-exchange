import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Dev-only cookie diagnostic.
 *
 * GET /api/debug/cookie-test        – read all cookies the server sees in this request
 * POST /api/debug/cookie-test       – set a test cookie, then return all cookies visible
 *
 * Returns 404 in production.
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll().map((c) => ({ name: c.name, valueLength: c.value.length }));

  return NextResponse.json({
    step: "read",
    cookieCount: allCookies.length,
    cookies: allCookies,
    requestHeaders: {
      cookie: request.headers.get("cookie") ?? null,
      host: request.headers.get("host") ?? null,
      origin: request.headers.get("origin") ?? null,
      "x-forwarded-proto": request.headers.get("x-forwarded-proto") ?? null,
      "x-forwarded-host": request.headers.get("x-forwarded-host") ?? null,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const isHttps =
    (request.headers.get("x-forwarded-proto") ?? "").includes("https")
    || request.nextUrl.protocol === "https:";

  const cookieStore = await cookies();

  // Set one cookie with Secure and one without, to test which the browser keeps.
  const expires = new Date(Date.now() + 60 * 1000); // 60-second test cookie
  cookieStore.set("alpha_debug_secure", "yes", {
    httpOnly: false, secure: true, sameSite: "lax", path: "/", expires,
  });
  cookieStore.set("alpha_debug_insecure", "yes", {
    httpOnly: false, secure: false, sameSite: "lax", path: "/", expires,
  });
  cookieStore.set("alpha_debug_httponly", "yes", {
    httpOnly: true, secure: false, sameSite: "lax", path: "/", expires,
  });

  const allBefore = cookieStore.getAll().map((c) => ({ name: c.name, valueLength: c.value.length }));

  return NextResponse.json({
    step: "write",
    requestIsHttps: isHttps,
    requestProtocol: request.nextUrl.protocol,
    xForwardedProto: request.headers.get("x-forwarded-proto") ?? null,
    cookiesBefore: allBefore,
    message: "Three test cookies set. Now GET /api/debug/cookie-test to see which ones the browser sent back.",
  }, { headers: { "Cache-Control": "no-store" } });
}
