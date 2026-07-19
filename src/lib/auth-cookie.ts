import { NextRequest } from "next/server";

export function shouldUseSecureAuthCookie(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestIsHttps =
    (typeof forwardedProto === "string" && forwardedProto.toLowerCase().includes("https")) ||
    request.nextUrl.protocol === "https:";

  if (process.env.AUTH_COOKIE_SECURE === "true") return requestIsHttps;
  if (process.env.AUTH_COOKIE_SECURE === "false") return false;

  return requestIsHttps;
}
