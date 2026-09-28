import type { NextRequest } from "next/server";

export function hasTrustedSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}
