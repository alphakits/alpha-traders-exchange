import { NextRequest } from "next/server";
import { isProductionSecurityRuntime } from "@/lib/runtime-safety";

export function shouldUseSecureAuthCookie(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestIsHttps =
    (typeof forwardedProto === "string" && forwardedProto.toLowerCase().includes("https")) ||
    request.nextUrl.protocol === "https:";

  // A deployed production cookie must never depend on a proxy-supplied header
  // or a mutable environment value. Local production-mode E2E is explicitly
  // excluded by the runtime safety boundary.
  if (isProductionSecurityRuntime()) return true;
  if (process.env.AUTH_COOKIE_SECURE === "true") return requestIsHttps;
  if (process.env.AUTH_COOKIE_SECURE === "false") return false;

  return requestIsHttps;
}
